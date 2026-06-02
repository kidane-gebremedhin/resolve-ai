import type { Server as IoServer } from "socket.io";
import type { HydratedDocument } from "mongoose";
import {
  Agent,
  Conversation,
  Message,
  Organization,
  type ConversationDocType,
} from "../../models/index.js";
import { env } from "../../config/env.js";
import { buildSystemPrompt } from "./prompts.js";
import { AGENT_TOOLS, FINAL_REPLY_SCHEMA, type ToolCall } from "./tools.js";
import { searchKb } from "../kb/search.service.js";
import { logger } from "../../config/logger.js";

type ConvoDoc = HydratedDocument<ConversationDocType>;

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
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

type LlmResponse = { choices?: LlmChoice[] };

type ToolMode = "auto" | "none";

const OPENROUTER_URL =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
// 6 turns gives the model room to: (1) initial search, (2) reformulated
// retry, (3) optional second retry on a related sub-question, plus headroom
// for escalate/resolve tool calls without exhausting the budget on KB.
const MAX_TOOL_TURNS = 6;
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
  model: string;
  temperature: number;
}): Promise<LlmChoice> {
  if (!process.env.OPENROUTER_API_KEY) {
    return {
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
    };
  }

  const body: Record<string, unknown> = {
    model: args.model,
    messages: args.messages,
    temperature: args.temperature,
  };
  if (args.toolMode === "auto") {
    body.tools = AGENT_TOOLS;
    body.tool_choice = "auto";
  }
  if (args.requireJson) {
    body.response_format = FINAL_REPLY_SCHEMA;
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
      return choice;
    } catch (err) {
      lastErr = err;
      if (attempt === LLM_MAX_ATTEMPTS || !isTransientLlmError(err)) break;
      const wait = LLM_BASE_BACKOFF_MS * 2 ** (attempt - 1);
      logger.warn(
        `[ai] LLM call failed (attempt ${attempt}/${LLM_MAX_ATTEMPTS}), retrying in ${wait}ms: ${(err as Error).message}`,
      );
      await sleep(wait);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function executeTool(
  call: ToolCall,
  ctx: { organizationId: string; agentId: string },
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

export async function generateAiReply(
  conversation: ConvoDoc,
  customerMessage: string,
  io: IoServer | null,
): Promise<void> {
  // Guaranteed reply: start from a safe fallback so that even a catastrophic
  // failure below still persists + emits *something* to the customer. This is
  // a fire-and-forget task (see widget.routes) — an uncaught throw here would
  // otherwise mean the customer never hears back at all.
  let reply: {
    reply: string;
    confidence: number;
    action: "reply" | "escalate" | "resolve";
  } = {
    reply:
      "Sorry, I'm having trouble responding right now — let me connect you with a teammate.",
    confidence: 0.1,
    action: "escalate",
  };
  const toolCallLog: { name: string; args: unknown; result: unknown }[] = [];

  try {
    const agent = await Agent.findById(conversation.agentId);
    if (!agent) throw new Error(`agent not found: ${conversation.agentId.toString()}`);
    const organization = await Organization.findById(conversation.organizationId);

    const history = await Message.find({ conversationId: conversation._id })
      .sort({ createdAt: 1 })
      .limit(20)
      .lean();

    const systemPrompt = buildSystemPrompt({
      agent,
      organization,
      conversation,
    });

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...history.map<ChatMessage>((m) =>
        m.role === "ai"
          ? { role: "assistant", content: m.content }
          : { role: "user", content: m.content },
      ),
      { role: "user", content: customerMessage },
    ];

    const model = agent.model ?? env.ai.model;
    // No hardcoded fallback — `agent.temperature` may be undefined for fresh
    // agents; the env var (`AI_TEMPERATURE`) is the only sanctioned default.
    const temperature = agent.temperature ?? env.ai.temperature;

    // Tool-calling loop: let the model search KB / signal escalate-resolve.
    // A failure inside the loop must not abort the whole reply — we break out
    // and still attempt a final answer, so the customer always gets a response.
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      let choice: LlmChoice;
      try {
        choice = await callLlm({
          messages,
          toolMode: "auto",
          requireJson: false,
          model,
          temperature,
        });
      } catch (err) {
        logger.error("[ai] tool-loop LLM call failed, proceeding to final", {
          turn,
          err: (err as Error).message,
        });
        break;
      }
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
        try {
          result = await executeTool(call, {
            organizationId: conversation.organizationId.toString(),
            agentId: conversation.agentId.toString(),
          });
        } catch (err) {
          logger.error("[ai] tool execution failed", {
            tool: call.name,
            err: (err as Error).message,
          });
          result = JSON.stringify({ error: "tool temporarily unavailable" });
        }
        toolCallLog.push({ name: call.name, args: call.arguments, result });
        messages.push({
          role: "tool",
          tool_call_id: raw.id,
          content: result,
        });
      }
    }

    // Final pass: structured reply.
    let final: LlmChoice;
    try {
      final = await callLlm({
        messages,
        toolMode: "none",
        requireJson: true,
        model,
        temperature,
      });
    } catch (err) {
      logger.error("[ai] final LLM call failed", { err: (err as Error).message });
      final = {
        message: {
          role: "assistant",
          content: JSON.stringify({
            reply: "Sorry, I hit a glitch — connecting you to a teammate.",
            confidence: 0.1,
            action: "escalate",
          }),
        },
      };
    }

    const parsed = parseFinalReply(final.message?.content);

    // NOTE: We deliberately do NOT auto-escalate on low confidence. Instead the
    // agent is prompted (see prompts.ts) to ASK the customer "Do you want to
    // connect with a human operator?" when it lacks confidence, and to only
    // emit action="escalate" once the customer confirms (or explicitly asks for
    // a human). So we honour the model's own action here. `confidenceThreshold`
    // is kept on the agent for analytics/telemetry but no longer forces a handoff.
    reply = { reply: parsed.reply, confidence: parsed.confidence, action: parsed.action };
  } catch (err) {
    logger.error("[ai] reply generation failed, sending fallback escalation", {
      conversationId: conversation._id.toString(),
      err: (err as Error).message,
    });
    // `reply` keeps the safe fallback initialized above.
  }

  const action = reply.action;
  const aiMessage = await Message.create({
    conversationId: conversation._id,
    organizationId: conversation.organizationId,
    role: "ai",
    senderType: "ai",
    content: reply.reply,
    confidence: reply.confidence,
    toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined,
  });

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
  conversation.lastMessageAt = aiMessage.createdAt as Date;
  conversation.lastMessagePreview = reply.reply.slice(0, 140);
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
