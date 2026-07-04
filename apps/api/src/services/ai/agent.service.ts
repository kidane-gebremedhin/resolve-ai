import type { Server as IoServer } from "socket.io";
import type { HydratedDocument } from "mongoose";
import {
  Agent,
  Conversation,
  ContactSession,
  Message,
  Organization,
  ToolCallLog,
  type ConversationDocType,
} from "../../models/index.js";
import { env } from "../../config/env.js";
import { buildSystemPrompt } from "./prompts.js";
import { AGENT_TOOLS, buildAgentTools, REQUEST_FORM_TOOL, FINAL_REPLY_SCHEMA, META_PASS_SCHEMA, type ToolCall } from "./tools.js";
import type { ConversationControls } from "./prompts.js";
import { searchKb, type KbHit } from "../kb/search.service.js";
import { logger } from "../../config/logger.js";
import { recordConversationUsage } from "../openrouter-usage.service.js";
import { ToolDefinition, KnowledgeGap } from "../../models/index.js";
import { dispatchToolCall, resultToBlocks } from "../integrations/dispatcher.js";
import { fetchOgPreview, extractUrls } from "../og/preview.service.js";
import { getAttachmentBuffer } from "../attachments.service.js";
import type { MessageBlock } from "../../types/messageBlocks.js";
import { maskPii } from "../integrations/piiMask.js";

type ConvoDoc = HydratedDocument<ConversationDocType>;

// OpenAI/OpenRouter reject the ENTIRE tools array if any single function's
// `parameters` isn't a valid JSON Schema of type "object" — one malformed
// integration tool (e.g. a custom webhook where the operator pasted a sample
// response instead of a schema) would then 400 every reply, forcing a toolless
// fallback where the model hallucinates actions it can't perform. Coerce each
// tool's schema to a safe object schema so a bad definition can never poison the
// whole request; the worst case is that one tool accepts loosely-typed args.
function safeToolParameters(schema: unknown): Record<string, unknown> {
  const s = schema as { type?: unknown; properties?: unknown } | null | undefined;
  if (s && typeof s === "object" && s.type === "object" && typeof s.properties === "object" && s.properties !== null) {
    return s as Record<string, unknown>;
  }
  return { type: "object", properties: {}, required: [] };
}

// "orderId" → "Order Id", "order_number" → "Order Number".
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// Build an inline FormBlock from an integration tool's JSON schema so the widget
// can collect all its inputs at once (request_form). Fields the system injects
// server-side (email, timezone, internal keys) are skipped — the customer only
// sees the inputs they actually need to provide.
// Fields the system fills server-side, or that flow through another UI (booking
// slot cards) — never surfaced in a form.
const FORM_SKIP_FIELDS = new Set([
  "email", "contactEmail", "organizationId", "timeZone", "_transcript",
  "_enforceProjectKey", "projectKey", "eventTypeId", "startTime", "name",
  "attendeeName", "currentPlan",
]);
function buildFormBlock(toolKey: string, schema: unknown, title?: unknown, onlyKeys?: string[]): MessageBlock | null {
  const s = schema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  if (!s || typeof s.properties !== "object" || s.properties === null) return null;
  const required = new Set(s.required ?? []);
  const onlySet = onlyKeys ? new Set(onlyKeys) : null;
  const fields = Object.entries(s.properties)
    .filter(([key]) => !FORM_SKIP_FIELDS.has(key) && (!onlySet || onlySet.has(key)))
    .map(([key, raw]) => {
      const p = (raw ?? {}) as { description?: string; enum?: unknown[]; format?: string; type?: string };
      const isSelect = Array.isArray(p.enum) && p.enum.length > 0;
      const fieldType: "text" | "email" | "tel" | "select" | "textarea" =
        isSelect ? "select" : p.format === "email" || p.type === "email" ? "email" : "text";
      return {
        key,
        label: humanizeKey(key),
        type: fieldType,
        placeholder: p.description,
        required: required.has(key),
        ...(isSelect ? { options: p.enum!.map((v) => ({ label: String(v), value: String(v) })) } : {}),
      };
    });
  if (fields.length === 0) return null;
  return { type: "form", title: title ? String(title) : "Please provide a few details", fields, submitLabel: "Submit", toolKey };
}

// Required fields the customer still needs to provide for a tool — i.e. required,
// absent from the args, and not a field the system injects or collects elsewhere
// (email, booking slot/eventType, etc.). Used to auto-show a form instead of
// dispatching with missing/guessed values.
function missingCustomerFields(schema: unknown, args: Record<string, unknown>): string[] {
  const s = schema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  if (!s || !Array.isArray(s.required) || typeof s.properties !== "object" || s.properties === null) return [];
  return s.required.filter((key) => {
    if (FORM_SKIP_FIELDS.has(key)) return false;
    if (!(key in s.properties!)) return false;
    const v = args[key];
    if (v === undefined || v === null) return true;
    const str = String(v).trim();
    return str === "" || /^\[[A-Z_]+\]$/.test(str); // empty or a "[PLACEHOLDER]"
  });
}

type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "auto" } };

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | VisionContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: RawToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type RawToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type LlmChoice = {
  message?: {
    role?: string;
    content?: string | null;
    tool_calls?: RawToolCall[];
  };
  finish_reason?: string;
};

type LlmResponse = {
  id?: string;
  choices?: LlmChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

type ToolMode = "auto" | "none";

type LlmCallResult = { choice: LlmChoice; generationId: string | null };

const OPENROUTER_URL =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
// 6 turns gives the model room to: (1) initial search, (2) reformulated
// retry, (3) optional second retry on a related sub-question, plus headroom
// for escalate/resolve tool calls without exhausting the budget on KB.
const MAX_TOOL_TURNS = 10;
// Upstream calls must never hang the (fire-and-forget) reply indefinitely.
const LLM_TIMEOUT_MS = Number(process.env.AI_LLM_TIMEOUT_MS ?? 30_000);
const LLM_MAX_ATTEMPTS = 3;
const LLM_BASE_BACKOFF_MS = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A transient upstream failure (429 rate limit, 5xx, network reset, timeout)
// is worth retrying; a 4xx (bad request, auth) is not.
function isTransientLlmError(err: unknown): boolean {
  const message = (err as Error)?.message ?? "";
  if (/OpenRouter (429|5\d\d)/.test(message)) return true;
  return /aborted|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|fetch failed|network/i.test(
    message,
  );
}

async function callLlm(args: {
  messages: ChatMessage[];
  toolMode: ToolMode;
  requireJson: boolean;
  responseFormat?: Record<string, unknown>;
  model: string;
  temperature: number;
  tools?: unknown[];
}): Promise<LlmCallResult> {
  if (!process.env.OPENROUTER_API_KEY) {
    return {
      choice: {
        message: {
          role: "assistant",
          content: JSON.stringify({
            reply:
              "Thanks for reaching out — a human teammate will follow up shortly.",
            confidence: 0.3,
            action: "escalate",
          }),
        },
        finish_reason: "stop",
      },
      generationId: null,
    };
  }

  const body: Record<string, unknown> = {
    model: args.model,
    messages: args.messages,
    temperature: args.temperature,
  };
  if (args.toolMode === "auto") {
    body.tools = args.tools ?? AGENT_TOOLS;
    body.tool_choice = "auto";
  }
  if (args.requireJson) {
    body.response_format = FINAL_REPLY_SCHEMA;
  } else if (args.responseFormat) {
    body.response_format = args.responseFormat;
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    try {
      const res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
      }
      const json = (await res.json()) as LlmResponse;
      const choice = json.choices?.[0];
      if (!choice) throw new Error("OpenRouter returned no choices");
      return { choice, generationId: json.id ?? null };
    } catch (err) {
      lastErr = err;
      if (attempt === LLM_MAX_ATTEMPTS || !isTransientLlmError(err)) break;
      const wait = LLM_BASE_BACKOFF_MS * 2 ** (attempt - 1);
      const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
      logger.warn(
        `[ai] LLM call failed (attempt ${attempt}/${LLM_MAX_ATTEMPTS}), retrying in ${wait}ms: ${(err as Error).message}`,
        { cause: cause?.code ?? cause?.message ?? String(cause) },
      );
      await sleep(wait);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// Streaming generator — yields text delta strings as they arrive from OpenRouter.
// Falls back to empty string on parse errors so the caller always gets something.
async function* callLlmStream(args: {
  messages: ChatMessage[];
  model: string;
  temperature: number;
}): AsyncGenerator<string, void, unknown> {
  if (!process.env.OPENROUTER_API_KEY) {
    yield "Thanks for reaching out — a human teammate will follow up shortly.";
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: args.model,
        messages: args.messages,
        temperature: args.temperature,
        stream: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    }
    if (!res.body) throw new Error("No response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const chunk = JSON.parse(data) as { choices?: [{ delta?: { content?: string | null } }] };
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          if (delta) yield delta;
        } catch {
          // malformed SSE chunk — skip
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

async function executeTool(
  call: ToolCall,
  ctx: { organizationId: string; agentId: string },
  onKbHits?: (hits: KbHit[]) => void,
): Promise<string> {
  switch (call.name) {
    case "search_kb": {
      const query = String(call.arguments.query ?? "").trim();
      if (!query) return JSON.stringify({ hits: [] });
      // Knowledge is per-agent — search only this conversation's agent KB.
      // topK / minScore default to env.ai.kbSearchTopK / env.ai.kbSearchMinScore.
      // If the env-driven threshold filters everything out, retry once with a
      // looser floor so the model gets *something* to work with — "no hits"
      // tends to push the model into a premature escalation.
      let hits = await searchKb({
        query,
        organizationId: ctx.organizationId,
        agentId: ctx.agentId,
      });
      if (hits.length === 0) {
        hits = await searchKb({
          query,
          organizationId: ctx.organizationId,
          agentId: ctx.agentId,
          minScore: 0,
        });
      }
      logger.info("[ai] search_kb", {
        query,
        hits: hits.length,
        topScore: hits[0]?.score,
      });
      if (onKbHits && hits.length > 0) onKbHits(hits);
      return JSON.stringify({
        hits: hits.map((h) => ({
          source: h.sourceTitle,
          text: h.text,
          score: Number(h.score.toFixed(3)),
        })),
      });
    }
    case "escalate_conversation":
      return JSON.stringify({
        ok: true,
        note: "Escalation will be applied after the final reply.",
      });
    case "resolve_conversation":
      return JSON.stringify({
        ok: true,
        note: "Resolution will be applied after the final reply.",
      });
    default:
      // request_form is handled inline in the tool loop, not here.
      return JSON.stringify({ ok: true });
  }
}

function parseFinalReply(content: string | null | undefined): {
  reply: string;
  confidence: number;
  action: "reply" | "escalate" | "resolve";
} {
  if (!content) {
    return {
      reply: "Sorry — I couldn't generate a reply. Let me get a teammate.",
      confidence: 0.1,
      action: "escalate",
    };
  }
  try {
    const parsed = JSON.parse(content) as {
      reply?: string;
      confidence?: number;
      action?: string;
    };
    const action: "reply" | "escalate" | "resolve" =
      parsed.action === "escalate" || parsed.action === "resolve"
        ? parsed.action
        : "reply";
    return {
      reply: String(parsed.reply ?? "").trim() || "I'm here — what can I help with?",
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      action,
    };
  } catch {
    // Model didn't emit valid JSON — treat the raw text as the reply.
    return {
      reply: content.trim(),
      confidence: 0.4,
      action: "reply",
    };
  }
}

// Resize an image buffer to fit within the vision API byte budget.
// Returns a base64 data URI (JPEG) ready to embed in a content block.
async function toVisionDataUrl(
  buffer: Buffer,
  contentType: string,
  maxBytes: number,
): Promise<string> {
  let out = buffer;
  if (buffer.length > maxBytes) {
    try {
      const { default: sharp } = await import("sharp");
      out = await sharp(buffer)
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch {
      // sharp unavailable or unsupported format — use original, capped at limit
      out = buffer.length > maxBytes ? buffer.subarray(0, maxBytes) : buffer;
    }
  }
  const mime = out === buffer ? contentType : "image/jpeg";
  return `data:${mime};base64,${out.toString("base64")}`;
}

// Append extracted attachment text to a customer turn so the model can answer
// from the file contents (PDFs, docs, sheets). Images carry no extracted text.
function withAttachmentText(
  content: string,
  attachments?: { fileName?: string | null; extractedText?: string | null }[] | null,
): string {
  if (!attachments || attachments.length === 0) return content;
  const blocks = attachments
    .filter((a) => a.extractedText && a.extractedText.trim().length > 0)
    .map((a) => `\n\n[Attachment: ${a.fileName ?? "file"}]\n${a.extractedText}`);
  return blocks.length ? content + blocks.join("") : content;
}

// Org-level conversation controls (escalation toggle, ask-before-resolve) live
// in the freeform Organization.settings.conversation block. Human escalation is
// OFF by default (must be explicitly enabled); confirm-before-resolve stays on.
function readConversationControls(org: { settings?: unknown } | null): ConversationControls {
  const c =
    (org?.settings && typeof org.settings === "object"
      ? (org.settings as Record<string, unknown>).conversation
      : undefined) as Record<string, unknown> | undefined;
  return {
    allowHumanEscalation: c?.allowHumanEscalation === true,
    requireResolveConfirmation: c?.requireResolveConfirmation !== false,
  };
}

// Lightweight affirmation check used to gate AI-driven resolution when
// ask-before-resolve is on: the resolve only goes through if the customer's
// latest message reads as a confirmation.
const AFFIRMATION_RE =
  /\b(yes|yep|yeah|yup|sure|ok|okay|correct|confirmed?|please do|go ahead|that('s| is)? (right|correct)|(it|that) (worked|works|helped|fixed|solved)|all good|sounds good|perfect|great|thanks|thank you|done)\b/i;
function isAffirmation(text: string): boolean {
  return AFFIRMATION_RE.test(text.trim());
}

export type CurrentAttachment = {
  fileName?: string;
  fileUrl?: string;
  mimeType?: string;
  size?: number;
  extractedText?: string;
};

export async function generateAiReply(
  conversation: ConvoDoc,
  customerMessage: string,
  io: IoServer | null,
  currentAttachments?: CurrentAttachment[],
): Promise<void> {
  // Guaranteed reply: start from a safe fallback so that even a catastrophic
  // failure below still persists + emits *something* to the customer. This is
  // a fire-and-forget task (see widget.routes) — an uncaught throw here would
  // otherwise mean the customer never hears back at all.
  let reply: {
    reply: string;
    confidence: number;
    action: "reply" | "escalate" | "resolve";
    quickReplies?: string[];
    sources?: { sourceId: string; sourceTitle: string; url?: string; score: number }[];
  } = {
    reply:
      "Sorry, I'm having trouble responding right now — let me connect you with a teammate.",
    confidence: 0.1,
    action: "escalate",
  };
  const toolCallLog: { name: string; args: unknown; result: unknown }[] = [];
  const generationIds: string[] = [];
  // Accumulated rich-UI blocks (tool result cards, link previews) for the AI message.
  const accumulatedBlocks: MessageBlock[] = [];
  // Deduplicated KB sources: best score per sourceId, collected across all search_kb calls.
  const usedSourcesMap = new Map<string, { sourceId: string; sourceTitle: string; url?: string; score: number }>();
  let usageModel = env.ai.model;
  // Default controls (used if the try below throws before org is loaded).
  // Human escalation defaults OFF; confirm-before-resolve stays on.
  let controls: ConversationControls = {
    allowHumanEscalation: false,
    requireResolveConfirmation: true,
  };
  // Streaming placeholder — created inside try, used outside for final update.
  let streamPlaceholder: { _id: { toString(): string }; createdAt?: unknown } | null = null;

  try {
    const agent = await Agent.findById(conversation.agentId);
    if (!agent) throw new Error(`agent not found: ${conversation.agentId.toString()}`);
    const organization = await Organization.findById(conversation.organizationId);

    const history = await Message.find({ conversationId: conversation._id })
      .sort({ createdAt: 1 })
      .limit(20)
      .lean();

    controls = readConversationControls(organization);
    const orgSettings = organization?.settings as Record<string, unknown> | null | undefined;
    const piiRedact = orgSettings?.piiRedaction !== false;
    const agentTools = buildAgentTools({ allowEscalation: controls.allowHumanEscalation });

    // Append active integration tools for this agent
    const integrationToolDefs = await ToolDefinition.find({
      organizationId: conversation.organizationId,
      enabledAgentIds: conversation.agentId,
      isActive: true,
    }).lean();
    const integrationSchemaByKey = new Map<string, unknown>();
    for (const td of integrationToolDefs) {
      integrationSchemaByKey.set(td.key, td.jsonSchema);
      (agentTools as unknown[]).push({
        type: "function" as const,
        function: {
          name: td.key,
          description: td.description,
          parameters: safeToolParameters(td.jsonSchema),
        },
      });
    }
    // Offer the inline-form tool only when there's an integration tool to collect
    // inputs for.
    if (integrationToolDefs.length > 0) {
      (agentTools as unknown[]).push(REQUEST_FORM_TOOL);
    }
    const builtInToolNames = new Set(["search_kb", "escalate_conversation", "resolve_conversation", "request_form"]);

    // Whether the visitor's email/name are already captured (contact form fills
    // these after the first message). When present, the prompt tells the model it
    // already HAS the email so it never re-asks for it in this session — tools get
    // the real value injected by the dispatcher regardless.
    const contactSession = await ContactSession.findById(conversation.contactSessionId)
      .select("email name metadata")
      .lean();
    const contact = {
      hasEmail: Boolean((contactSession as { email?: string } | null)?.email),
      name: (contactSession as { name?: string } | null)?.name || undefined,
      timeZone: (contactSession as { metadata?: { timeZone?: string } } | null)?.metadata?.timeZone || undefined,
    };

    const systemPrompt = buildSystemPrompt({
      agent,
      organization,
      conversation,
      controls,
      activeToolKeys: integrationToolDefs.map((td) => td.key),
      integrationTools: integrationToolDefs.map((td) => ({ key: td.key, description: td.description })),
      contact,
    });

    // Build vision content blocks for image attachments on the current turn.
    // We fetch the buffer from storage, optionally resize, and base64-encode.
    const imageBlocks: VisionContentPart[] = [];
    if (currentAttachments && currentAttachments.length > 0) {
      const orgId = conversation.organizationId.toString();
      for (const att of currentAttachments) {
        if (!(att.mimeType ?? "").startsWith("image/")) continue;
        const urlStr = att.fileUrl ?? "";
        // Extract sha from the URL: /widget/attachments/<sha>
        const shaMatch = /\/attachments\/([a-f0-9]{64})/i.exec(urlStr);
        if (!shaMatch) continue;
        try {
          const bufResult = await getAttachmentBuffer(orgId, shaMatch[1]);
          if (!bufResult) continue;
          const dataUrl = await toVisionDataUrl(
            bufResult.buffer,
            bufResult.contentType,
            env.ai.visionMaxImageBytes,
          );
          imageBlocks.push({ type: "image_url", image_url: { url: dataUrl, detail: "auto" } });
        } catch (err) {
          logger.warn("[ai] vision attachment load failed", { err: (err as Error).message });
        }
      }
    }

    // Apply PII masking to the customer message and chat history before sending
    // to the LLM. Stored Messages are intentionally left unmasked — operators
    // need to read the original conversation in the inbox. Tool dispatcher
    // always reads session email from ContactSession, not from message text.
    const safeCustomerMessage = piiRedact ? maskPii(customerMessage) : customerMessage;

    const currentUserContent: string | VisionContentPart[] =
      imageBlocks.length > 0
        ? [{ type: "text", text: withAttachmentText(safeCustomerMessage, currentAttachments) }, ...imageBlocks]
        : withAttachmentText(safeCustomerMessage, currentAttachments);

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...history.map<ChatMessage>((m) =>
        m.role === "ai"
          ? { role: "assistant", content: m.content }
          : {
              role: "user",
              content: piiRedact
                ? maskPii(withAttachmentText(m.content, m.attachments))
                : withAttachmentText(m.content, m.attachments),
            },
      ),
      { role: "user", content: currentUserContent },
    ];

    const model = agent.model ?? env.ai.model;
    usageModel = model;
    // No hardcoded fallback — `agent.temperature` may be undefined for fresh
    // agents; the env var (`AI_TEMPERATURE`) is the only sanctioned default.
    const temperature = agent.temperature ?? env.ai.temperature;

    // Tool-calling loop: let the model search KB / signal escalate-resolve.
    // A failure inside the loop must not abort the whole reply — we break out
    // and still attempt a final answer, so the customer always gets a response.
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      let loopResult: LlmCallResult;
      try {
        loopResult = await callLlm({
          messages,
          toolMode: "auto",
          requireJson: false,
          model,
          temperature,
          tools: agentTools,
        });
      } catch (err) {
        logger.error("[ai] tool-loop LLM call failed, proceeding to final", {
          turn,
          err: (err as Error).message,
        });
        break;
      }
      if (loopResult.generationId) generationIds.push(loopResult.generationId);
      const choice = loopResult.choice;
      const toolCalls = choice.message?.tool_calls ?? [];
      if (toolCalls.length === 0) break;

      messages.push({
        role: "assistant",
        content: choice.message?.content ?? null,
        tool_calls: toolCalls,
      });

      for (const raw of toolCalls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(raw.function.arguments) as Record<string, unknown>;
        } catch {
          parsedArgs = {};
        }
        const call: ToolCall = {
          id: raw.id,
          name: raw.function.name as ToolCall["name"],
          arguments: parsedArgs,
        };
        // A tool that throws (e.g. KB search) returns an error result to the
        // model rather than crashing the reply — the model can still answer.
        let result: string;
        let toolStatus: "success" | "error" = "success";
        const toolStart = Date.now();
        try {
          if (call.name === "request_form") {
            // Render an inline form for the requested integration tool's inputs.
            const targetKey = String(call.arguments.toolKey ?? "");
            const formBlock = buildFormBlock(
              targetKey,
              integrationSchemaByKey.get(targetKey),
              call.arguments.title,
            );
            if (formBlock) {
              accumulatedBlocks.push(formBlock);
              result = JSON.stringify({ shown: true, note: "Form displayed. Wait for the customer to submit it — do not ask for the same fields in chat." });
            } else {
              result = JSON.stringify({ error: `No integration tool "${targetKey}" with fillable fields.` });
              toolStatus = "error";
            }
          } else if (builtInToolNames.has(call.name)) {
            result = await executeTool(
              call,
              {
                organizationId: conversation.organizationId.toString(),
                agentId: conversation.agentId.toString(),
              },
              (hits) => {
                for (const h of hits) {
                  // Key by source + exact page URL so different pages of the same
                  // website source surface as distinct citations (not collapsed
                  // to one). Falls back to sourceId when a chunk has no URL.
                  const key = `${h.sourceId}|${h.url ?? ""}`;
                  const existing = usedSourcesMap.get(key);
                  if (!existing || h.score > existing.score) {
                    usedSourcesMap.set(key, {
                      sourceId: h.sourceId,
                      sourceTitle: h.sourceTitle,
                      url: h.url,
                      score: h.score,
                    });
                  }
                }
              },
            );
            // After a KB search, check if scores are below the gap threshold.
            // If so, log a KnowledgeGap for analytics. Fire-and-forget.
            if (call.name === "search_kb") {
              try {
                const kbResult = JSON.parse(result) as { hits: { score: number }[] };
                const maxScore = kbResult.hits.length > 0
                  ? Math.max(...kbResult.hits.map((h) => h.score))
                  : 0;
                if (maxScore < env.ai.kbGapScoreThreshold) {
                  const query = String(call.arguments.query ?? "").trim();
                  KnowledgeGap.findOneAndUpdate(
                    {
                      organizationId: conversation.organizationId,
                      agentId: conversation.agentId,
                      queryUsed: query,
                    },
                    {
                      $set: { question: customerMessage, maxKbScore: maxScore },
                      $inc: { occurrenceCount: 1 },
                      $setOnInsert: { status: "open" },
                    },
                    { upsert: true },
                  ).catch((err) =>
                    logger.warn("[ai] knowledge-gap upsert failed", { err: (err as Error).message }),
                  );
                }
              } catch { /* ignore JSON parse errors */ }
            }
          } else {
            // Auto-form: if the customer still needs to supply required inputs for
            // this tool, show an inline form to collect them all at once instead of
            // dispatching with missing/guessed values. Reliable — doesn't depend on
            // the model choosing request_form.
            const schema = integrationSchemaByKey.get(call.name);
            const missing = missingCustomerFields(schema, call.arguments);
            const autoForm = missing.length > 0 ? buildFormBlock(call.name, schema, undefined, missing) : null;
            if (autoForm) {
              accumulatedBlocks.push(autoForm);
              result = JSON.stringify({
                formShown: true,
                note: `The customer needs to provide: ${missing.join(", ")}. An inline form is now shown — STOP and wait for them to submit it. Do NOT call ${call.name} again or ask for these fields in chat.`,
              });
            } else {
            // Integration tool — dispatch through guardrails + audit log
            const dispatch = await dispatchToolCall(
              call.name,
              call.arguments,
              {
                organizationId: conversation.organizationId,
                agentId: conversation.agentId,
                conversationId: conversation._id,
                contactSessionId: conversation.contactSessionId,
              },
            );
            if (dispatch.ok) {
              result = JSON.stringify(dispatch.result);
              // Convert tool results to rich UI blocks when available
              const toolBlocks = resultToBlocks(call.name, dispatch.result);
              if (toolBlocks) accumulatedBlocks.push(...toolBlocks);
            } else if (dispatch.status === "guardrail_blocked") {
              result = JSON.stringify({ blocked: true, reason: dispatch.reason });
            } else if (dispatch.status === "otp_pending") {
              result = JSON.stringify({ otpRequired: true, message: "Identity verification required. Please check your email for a 6-digit code and submit it to continue." });
            } else if (dispatch.status === "error") {
              result = JSON.stringify({ error: dispatch.error });
            } else {
              result = JSON.stringify({ error: "rate limited" });
            }
            }
          }
        } catch (err) {
          logger.error("[ai] tool execution failed", {
            tool: call.name,
            err: (err as Error).message,
          });
          result = JSON.stringify({ error: "tool temporarily unavailable" });
          toolStatus = "error";
        }
        toolCallLog.push({ name: call.name, args: call.arguments, result });
        // Write an audit record for built-in tool calls (integration tools are
        // logged inside dispatchToolCall/dispatcher.ts).
        if (builtInToolNames.has(call.name)) {
          const argsMasked = piiRedact
            ? JSON.parse(maskPii(JSON.stringify(call.arguments))) as unknown
            : call.arguments;
          ToolCallLog.create({
            organizationId: conversation.organizationId,
            agentId: conversation.agentId,
            conversationId: conversation._id,
            contactSessionId: conversation.contactSessionId,
            toolKey: call.name,
            argsMasked,
            resultSummary: result.slice(0, 500),
            status: toolStatus,
            durationMs: Date.now() - toolStart,
          }).catch((e: Error) => logger.warn("[ai] ToolCallLog create failed", { err: e.message }));
        }
        messages.push({
          role: "tool",
          tool_call_id: raw.id,
          content: result,
        });
      }
    }

    // Final pass: stream prose to the customer while running a concurrent
    // lightweight meta-call (non-streaming) for structured {confidence, action}.
    // This keeps response latency low — the customer sees tokens within ~300ms.
    const streamMessages: ChatMessage[] = [
      ...messages,
      {
        role: "system" as const,
        content:
          "Now write your final reply to the customer. Be concise and helpful. Do NOT include JSON. Use markdown when it improves clarity — bullet lists for multi-step answers or lists of items, **bold** for key terms — plain prose otherwise.",
      },
    ];
    const metaMessages: ChatMessage[] = [
      ...messages,
      {
        role: "system" as const,
        content:
          'Evaluate this conversation and output a JSON object with: "confidence" (0.0-1.0 how well the reply addresses the need), "action" ("reply"|"escalate"|"resolve"), and "quickReplies" (null, or an array of up to 3 short follow-up chip labels (3-7 words each) the customer would likely tap next — include when there are natural follow-ups, null when not applicable).',
      },
    ];

    // Persist placeholder message; the ID is sent to clients via delta events.
    // Use a single space so Mongoose's required:true validator (which rejects "")
    // doesn't throw. The real content is written via updateOne after streaming.
    streamPlaceholder = await Message.create({
      conversationId: conversation._id,
      organizationId: conversation.organizationId,
      role: "ai",
      senderType: "ai",
      content: " ",
      confidence: 0.5,
      toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined,
    });
    const placeholderId = streamPlaceholder._id.toString();
    const sessionRoom = `contact:${conversation.contactSessionId.toString()}`;

    // Stream prose tokens to the widget in real time.
    let streamedText = "";
    try {
      const stream = callLlmStream({ messages: streamMessages, model, temperature });
      for await (const delta of stream) {
        streamedText += delta;
        if (io) {
          io.to(sessionRoom).emit("message:delta", {
            conversationId: conversation._id.toString(),
            messageId: placeholderId,
            delta,
          });
        }
      }
    } catch (err) {
      logger.error("[ai] streaming final call failed", { err: (err as Error).message });
      streamedText = "Sorry, I hit a glitch — connecting you to a teammate.";
    }

    // Concurrent meta-pass for confidence + action.
    let metaResult: LlmCallResult | null = null;
    try {
      metaResult = await callLlm({
        messages: metaMessages,
        toolMode: "none",
        requireJson: false,
        responseFormat: META_PASS_SCHEMA as Record<string, unknown>,
        model,
        temperature: 0,
      });
      if (metaResult.generationId) generationIds.push(metaResult.generationId);
    } catch (err) {
      logger.warn("[ai] meta-pass failed", { err: (err as Error).message });
    }

    // Parse the meta result for action/confidence/quickReplies; use streamed text as reply.
    let metaAction: "reply" | "escalate" | "resolve" = "reply";
    let metaConfidence = 0.5;
    let metaQuickReplies: string[] | undefined;
    if (metaResult?.choice.message?.content) {
      try {
        const m = JSON.parse(metaResult.choice.message.content) as {
          confidence?: number;
          action?: string;
          quickReplies?: unknown;
        };
        metaAction =
          m.action === "escalate" || m.action === "resolve" ? m.action : "reply";
        metaConfidence =
          typeof m.confidence === "number"
            ? Math.max(0, Math.min(1, m.confidence))
            : 0.5;
        if (Array.isArray(m.quickReplies)) {
          metaQuickReplies = (m.quickReplies as unknown[])
            .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
            .slice(0, 3);
          if (metaQuickReplies.length === 0) metaQuickReplies = undefined;
        }
      } catch {
        /* keep defaults */
      }
    }

    const finalReplyText = streamedText.trim() || "I'm here — what can I help with?";

    // OG link previews — extract up to 2 HTTPS URLs from the reply and fetch
    // Open Graph metadata in parallel. Results are appended to accumulatedBlocks.
    try {
      const urls = extractUrls(finalReplyText);
      if (urls.length > 0) {
        const previews = await Promise.all(urls.map((u) => fetchOgPreview(u).catch(() => null)));
        for (const og of previews) {
          if (og) accumulatedBlocks.push({ type: "link_preview", ...og });
        }
      }
    } catch {
      /* never crash the reply for OG preview errors */
    }

    // Emit done event so clients promote the streaming bubble to a final message.
    if (io) {
      io.to(sessionRoom).emit("message:done", {
        conversationId: conversation._id.toString(),
        messageId: placeholderId,
        content: finalReplyText,
      });
    }

    // Top-5 KB sources by score, for the citations panel.
    const topSources = Array.from(usedSourcesMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // For the rest of the function's action/reply handling, synthesize a parsed result.
    const parsed = {
      reply: finalReplyText,
      confidence: metaConfidence,
      action: metaAction,
      quickReplies: metaQuickReplies,
      sources: topSources.length > 0 ? topSources : undefined,
    };

    // NOTE: We deliberately do NOT auto-escalate on low confidence. Instead the
    // agent is prompted (see prompts.ts) to ASK the customer "Do you want to
    // connect with a human operator?" when it lacks confidence, and to only
    // emit action="escalate" once the customer confirms (or explicitly asks for
    // a human). So we honour the model's own action here. `confidenceThreshold`
    // is kept on the agent for analytics/telemetry but no longer forces a handoff.
    reply = { reply: parsed.reply, confidence: parsed.confidence, action: parsed.action, quickReplies: parsed.quickReplies, sources: parsed.sources };
  } catch (err) {
    logger.error("[ai] reply generation failed, sending fallback escalation", {
      conversationId: conversation._id.toString(),
      err: (err as Error).message,
    });
    // `reply` keeps the safe fallback initialized above.
  }

  // Enforce org conversation controls (defense-in-depth beyond the prompt + tool
  // gating). Escalation: never hand off when disabled. Resolution: a strict
  // TWO-STEP confirmation when ask-before-resolve is on — the AI must first ask
  // ("shall I close this?") and only resolve after the visitor affirmatively
  // replies on the NEXT turn. This stops it auto-resolving on pleasantries.
  let action = reply.action;
  let replyText = reply.reply;
  if (action === "escalate" && !controls.allowHumanEscalation) {
    action = "reply";
  }

  const wasPendingResolve = Boolean(conversation.pendingResolveConfirmation);
  let nextPendingResolve = wasPendingResolve;
  if (controls.requireResolveConfirmation) {
    if (action === "resolve") {
      if (wasPendingResolve && isAffirmation(customerMessage)) {
        // Visitor confirmed on the turn after we asked → resolve for real.
        nextPendingResolve = false;
      } else {
        // First resolve attempt (or not-yet-confirmed): ask instead of resolving.
        action = "reply";
        nextPendingResolve = true;
        if (!replyText.includes("?")) {
          replyText =
            replyText.replace(/[.!\s]+$/, "") + " — shall I close this conversation now?";
        }
      }
    } else {
      // Conversation moved on without resolving — drop any pending confirmation.
      nextPendingResolve = false;
    }
  }
  conversation.pendingResolveConfirmation = nextPendingResolve;

  const finalBlocks = accumulatedBlocks.length > 0 ? accumulatedBlocks : undefined;

  // Update the streaming placeholder with final content, or create a new message
  // if streaming failed before the placeholder was persisted.
  let aiMessage: { _id: { toString(): string }; createdAt?: unknown };
  if (streamPlaceholder) {
    await Message.updateOne(
      { _id: streamPlaceholder._id },
      {
        content: replyText,
        confidence: reply.confidence,
        toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined,
        sources: reply.sources?.length ? reply.sources : undefined,
        quickReplies: reply.quickReplies?.length ? reply.quickReplies : undefined,
        blocks: finalBlocks,
      },
    );
    aiMessage = streamPlaceholder;
  } else {
    aiMessage = await Message.create({
      conversationId: conversation._id,
      organizationId: conversation.organizationId,
      role: "ai",
      senderType: "ai",
      content: replyText,
      confidence: reply.confidence,
      toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined,
      sources: reply.sources?.length ? reply.sources : undefined,
      quickReplies: reply.quickReplies?.length ? reply.quickReplies : undefined,
      blocks: finalBlocks,
    });
  }

  // Fire-and-forget: fetch OpenRouter cost and store UsageRecord.
  if (generationIds.length > 0) {
    recordConversationUsage({
      generationIds,
      organizationId: conversation.organizationId,
      websiteId: (conversation as unknown as { websiteId?: string | null }).websiteId ?? null,
      conversationId: conversation._id,
      model: usageModel,
    }).catch((err) => {
      logger.warn("[ai] usage recording failed", { err: (err as Error).message });
    });
  }

  let conversationChanged = false;
  if (action === "escalate" && conversation.status === "active") {
    conversation.status = "escalated";
    conversation.escalatedAt = new Date();
    conversationChanged = true;
  } else if (action === "resolve" && conversation.status !== "resolved") {
    conversation.status = "resolved";
    conversation.resolvedAt = new Date();
    conversation.resolvedBy = "ai";
    conversationChanged = true;
  }
  conversation.lastMessageAt = (aiMessage.createdAt as Date | undefined) ?? new Date();
  conversation.lastMessagePreview = replyText.slice(0, 140);
  conversation.messageCount = (conversation.messageCount ?? 0) + 1;
  await conversation.save();

  if (!io) return;
  const orgRoom = `org:${conversation.organizationId.toString()}`;
  const convoRoom = `conversation:${conversation._id.toString()}`;
  const sessionRoom = `contact:${conversation.contactSessionId.toString()}`;
  const payload = {
    conversationId: conversation._id.toString(),
    messageId: aiMessage._id.toString(),
  };
  io.to(orgRoom).emit("message:new", payload);
  io.to(convoRoom).emit("message:new", payload);
  io.to(sessionRoom).emit("message:new", payload);
  if (conversationChanged) {
    io.to(orgRoom).emit("conversation:updated", {
      conversationId: conversation._id.toString(),
      status: conversation.status,
    });
  }
}

export { Conversation };
