// Drives one customer turn end to end: assemble context, run the graph, stream
// tokens to the widget as they arrive, then persist and broadcast the result.
//
// This is a fire-and-forget task (see widget.routes), so it is written to always
// produce SOMETHING. Every failure path below degrades to a reply the customer
// actually receives rather than throwing into a void.

import type { Server as IoServer } from "socket.io";
import type { HydratedDocument } from "mongoose";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { AIMessageChunk } from "@langchain/core/messages";
import {
  Agent,
  ContactSession,
  Conversation,
  Message,
  KnowledgeSource,
  Organization,
  type ConversationDocType,
} from "../../../models/index.js";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { maskPii } from "../../integrations/piiMask.js";
import { resultToBlocks } from "../../integrations/dispatcher.js";
import { recordConversationUsage, type UsageTotals } from "../../openrouter-usage.service.js";
import { recordRagTurn } from "../telemetry/rag-telemetry.service.js";
import { buildSystemPrompt, type ConversationControls } from "../prompts.js";
import { contentToText } from "../llm/chat-model.js";
import { traceMetadata } from "../llm/tracing.js";
import { buildToolRegistry } from "../tools/registry.js";
import {
  buildImageParts,
  withAttachmentText,
  type CurrentAttachment,
  type VisionContentPart,
} from "../shared/attachments.js";
import { applyConversationControls, readConversationControls } from "../shared/controls.js";
import { FINAL_REPLY_TAG, TURN_CONTEXT_KEY, type TurnContext } from "./context.js";
import { GRAPH_NAME, getReplyGraph } from "./agent.graph.js";
import type {
  AgentState,
  GenerationStats,
  QueryRewriteRecord,
  ReplyAction,
  ToolCallRecord,
} from "./state.js";
import type { RetrievalStats } from "../retrieval/kb-retriever.js";
import type { MessageBlock } from "../../../types/messageBlocks.js";
import type { KbHit } from "../../kb/search.service.js";

type ConvoDoc = HydratedDocument<ConversationDocType>;

export type { CurrentAttachment };

type KbSource = { sourceId: string; sourceTitle: string; url?: string; score: number };

/** The minimal shape of a persisted AI message this module needs back. */
type PlaceholderMessage = { _id: { toString(): string }; createdAt?: unknown };

/**
 * Top KB citations for the turn: best score per (source, page), so different
 * pages of the same crawled website surface as distinct citations rather than
 * collapsing into one.
 */
function topSources(hits: KbHit[]): KbSource[] {
  const best = new Map<string, KbSource>();
  for (const h of hits) {
    const key = `${h.sourceId}|${h.url ?? ""}`;
    const existing = best.get(key);
    if (!existing || h.score > existing.score) {
      best.set(key, {
        sourceId: h.sourceId,
        sourceTitle: h.sourceTitle,
        url: h.url,
        score: h.score,
      });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 5);
}

/** The LLM-facing conversation: system prompt, recent history, then this turn. */
function buildInitialMessages(args: {
  systemPrompt: string;
  history: { role: string; content: string; attachments?: unknown }[];
  customerMessage: string;
  imageParts: VisionContentPart[];
  currentAttachments?: CurrentAttachment[];
  piiRedact: boolean;
}): BaseMessage[] {
  const mask = (text: string) => (args.piiRedact ? maskPii(text) : text);

  const history = args.history.map<BaseMessage>((m) =>
    m.role === "ai"
      ? new AIMessage(m.content)
      : new HumanMessage(
          mask(
            withAttachmentText(
              m.content,
              m.attachments as { fileName?: string | null; extractedText?: string | null }[] | undefined,
            ),
          ),
        ),
  );

  const currentText = withAttachmentText(mask(args.customerMessage), args.currentAttachments);
  const current =
    args.imageParts.length > 0
      ? new HumanMessage({ content: [{ type: "text", text: currentText }, ...args.imageParts] })
      : new HumanMessage(currentText);

  return [new SystemMessage(args.systemPrompt), ...history, current];
}

export async function generateAiReplyWithGraph(
  conversation: ConvoDoc,
  customerMessage: string,
  io: IoServer | null,
  currentAttachments?: CurrentAttachment[],
  // Set when an inline-form / OTP submission ALREADY executed a tool (in
  // widget.routes): present THAT result and skip the agent loop entirely.
  presentToolResult?: { toolKey: string; result: unknown },
): Promise<void> {
  // Started before anything is loaded, so `durationMs` covers the whole turn as
  // the customer experienced it rather than just the model calls.
  const turnStarted = Date.now();
  const conversationId = conversation._id.toString();
  const organizationId = conversation.organizationId.toString();
  const agentId = conversation.agentId.toString();
  const sessionRoom = `contact:${conversation.contactSessionId.toString()}`;

  // Guaranteed reply: start from a safe fallback so that even a catastrophic
  // failure below still persists + emits *something* to the customer.
  let replyText =
    "Sorry, I'm having trouble responding right now — let me connect you with a teammate.";
  let confidence = 0.1;
  let action: ReplyAction = "escalate";
  let quickReplies: string[] | undefined;
  let blocks: MessageBlock[] = [];
  let sources: KbSource[] = [];
  let toolCallLog: ToolCallRecord[] = [];
  let citations: { marker: number; sourceId: string; sourceTitle: string; chunkId?: string; headingPath?: string[]; url?: string; score: number }[] = [];
  let generationIds: string[] = [];
  let usageModel = env.ai.model;
  let kbHits: KbHit[] = [];
  let queryRewrites: QueryRewriteRecord[] = [];
  let retrievalStats: RetrievalStats[] = [];
  let generationStats: GenerationStats | undefined;
  let toolTurns = 0;
  let conflicted = false;
  // `fallback` until the graph hands back a real state: a turn that ends on the
  // safe reply above is a different thing from one the agent actually answered,
  // and averaging the two would hide an outage behind a healthy confidence mean.
  let telemetryStatus: "ok" | "fallback" = "fallback";

  // Default controls (used if the try below throws before the org is loaded).
  // Human escalation defaults OFF; confirm-before-resolve stays on.
  let controls: ConversationControls = {
    allowHumanEscalation: false,
    requireResolveConfirmation: true,
  };

  // The streaming bubble the widget promotes to a real message. Created lazily
  // on the first token so a turn that fails before generating anything doesn't
  // leave an empty message behind.
  //
  // Held in an object rather than a bare `let` because it is only ever assigned
  // inside the closure below, and TypeScript's control-flow analysis would then
  // keep narrowing the variable to `null` at every later use.
  const streaming: { placeholder: PlaceholderMessage | null } = { placeholder: null };
  const ensurePlaceholder = async (): Promise<string> => {
    // A single space: Mongoose's required:true validator rejects "". The real
    // content is written by the update at the end of the turn.
    streaming.placeholder ??= await Message.create({
      conversationId: conversation._id,
      organizationId: conversation.organizationId,
      role: "ai",
      senderType: "ai",
      content: " ",
      confidence: 0.5,
    });
    return streaming.placeholder._id.toString();
  };

  try {
    const agent = await Agent.findById(conversation.agentId);
    if (!agent) throw new Error(`agent not found: ${agentId}`);
    const organization = await Organization.findById(conversation.organizationId);

    const history = await Message.find({ conversationId: conversation._id })
      .sort({ createdAt: 1 })
      .limit(20)
      .lean();

    controls = readConversationControls(organization);
    const orgSettings = organization?.settings as Record<string, unknown> | null | undefined;
    const piiRedact = orgSettings?.piiRedaction !== false;

    // Whether the visitor's email/name are already captured (the contact form
    // fills these after the first message). When present, the prompt tells the
    // model it already HAS the email so it never re-asks for it in this session;
    // tools get the real value injected by the dispatcher regardless.
    const contactSession = await ContactSession.findById(conversation.contactSessionId)
      .select("email name metadata")
      .lean();
    const contact = {
      hasEmail: Boolean((contactSession as { email?: string } | null)?.email),
      name: (contactSession as { name?: string } | null)?.name || undefined,
      timeZone:
        (contactSession as { metadata?: { timeZone?: string } } | null)?.metadata?.timeZone ||
        undefined,
    };

    // The org's own words, for query rewriting: KB document titles are the
    // cheapest available source of product names and acronyms, and they are the
    // exact spellings the documents use.
    const kbTitles = await KnowledgeSource.find({ organizationId, agentId })
      .select("title")
      .limit(100)
      .lean();

    const registry = await buildToolRegistry({
      ctx: {
        organizationId,
        agentId,
        conversationId,
        contactSessionId: conversation.contactSessionId.toString(),
        customerMessage,
        piiRedact,
        history: history as unknown as { role: string; content: string }[],
        vocabulary: [
          ...(agent.name ? [agent.name] : []),
          ...kbTitles.map((k) => String(k.title)).filter(Boolean),
        ],
      },
      allowEscalation: controls.allowHumanEscalation,
      toolPriority: agent.toolPriority as { key?: string; connectionIds?: unknown[] }[] | null,
    });

    const systemPrompt = buildSystemPrompt({
      agent,
      organization,
      conversation,
      controls,
      activeToolKeys: registry.activeToolKeys,
      integrationTools: registry.promptTools,
      contact,
    });

    // No hardcoded fallbacks — `agent.model`/`agent.temperature` may be
    // undefined for fresh agents; the env vars are the only sanctioned defaults.
    const model = agent.model ?? env.ai.model;
    const temperature = agent.temperature ?? env.ai.temperature;
    usageModel = model;

    const turnContext: TurnContext = {
      model,
      temperature,
      maxToolTurns: env.ai.maxToolTurns,
      registry,
      piiRedact,
      organizationId,
      agentId,
      conversationId,
      contactSessionId: conversation.contactSessionId.toString(),
      ...(presentToolResult ? { presentToolResult } : {}),
    };

    // Present-only mode: attach the already-executed tool's rich card (booking
    // confirmation, subscription card, …) up front.
    const seedBlocks = presentToolResult
      ? (resultToBlocks(presentToolResult.toolKey, presentToolResult.result) ?? [])
      : [];

    const initialMessages = buildInitialMessages({
      systemPrompt,
      history: history as unknown as { role: string; content: string; attachments?: unknown }[],
      customerMessage,
      imageParts: await buildImageParts(organizationId, currentAttachments),
      currentAttachments,
      piiRedact,
    });

    const trace = traceMetadata({ organizationId, agentId, conversationId });
    const stream = getReplyGraph().streamEvents(
      { messages: initialMessages, blocks: seedBlocks },
      {
        version: "v2",
        runName: GRAPH_NAME,
        configurable: { [TURN_CONTEXT_KEY]: turnContext },
        tags: trace.tags,
        metadata: trace.metadata,
        // Each agent↔tool round trip costs two steps; leave headroom for the
        // start edge and the finalize node on top of the configured ceiling.
        recursionLimit: env.ai.maxToolTurns * 2 + 10,
      },
    );

    let finalState: AgentState | null = null;
    for await (const event of stream) {
      if (event.event === "on_chat_model_stream" && event.tags?.includes(FINAL_REPLY_TAG)) {
        const delta = contentToText((event.data.chunk as AIMessageChunk | undefined)?.content);
        if (!delta) continue;
        const messageId = await ensurePlaceholder();
        io?.to(sessionRoom).emit("message:delta", { conversationId, messageId, delta });
        continue;
      }
      // The graph's own end event carries the finished state. Match on the
      // presence of `replyText` rather than the run name alone, so a rename or a
      // nested run can never silently strand the turn on its fallback reply.
      if (event.event === "on_chain_end") {
        const output = event.data.output as Partial<AgentState> | undefined;
        if (output && typeof output.replyText === "string") finalState = output as AgentState;
      }
    }

    if (!finalState) throw new Error("graph produced no final state");

    replyText = finalState.replyText;
    confidence = finalState.confidence;
    action = finalState.action;
    quickReplies = finalState.quickReplies;
    blocks = finalState.blocks;
    sources = topSources(finalState.kbHits);
    citations = finalState.citations ?? [];
    toolCallLog = finalState.toolCallLog;
    generationIds = finalState.generationIds;
    kbHits = finalState.kbHits;
    queryRewrites = finalState.queryRewrites ?? [];
    retrievalStats = finalState.retrievalStats ?? [];
    generationStats = finalState.generationStats;
    toolTurns = finalState.toolTurns ?? 0;
    conflicted = Boolean(finalState.conflicted);
    telemetryStatus = "ok";
  } catch (err) {
    logger.error("[ai] reply generation failed, sending fallback escalation", {
      conversationId,
      err: (err as Error).message,
    });
    // The safe fallback initialized above stands.
  }

  // Enforce org conversation controls (defense-in-depth beyond the prompt + tool
  // gating): never hand off when escalation is disabled, and require a two-step
  // confirmation before the AI closes a conversation.
  const enforced = applyConversationControls({
    action,
    replyText,
    customerMessage,
    controls,
    wasPendingResolve: Boolean(conversation.pendingResolveConfirmation),
  });
  action = enforced.action;
  replyText = enforced.replyText;
  conversation.pendingResolveConfirmation = enforced.pendingResolve;

  const finalBlocks = blocks.length > 0 ? blocks : undefined;
  const persisted = {
    content: replyText,
    confidence,
    toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined,
    // Prefer the validated citations: they carry the inline marker and identify
    // the exact passage, not just the document. Fall back to the old
    // source-level shape when the turn produced no citations, so a reply without
    // markers persists and renders exactly as it did before.
    sources: citations.length > 0 ? citations : sources.length > 0 ? sources : undefined,
    quickReplies: quickReplies?.length ? quickReplies : undefined,
    blocks: finalBlocks,
  };

  // Promote the streaming placeholder, or create the message outright when the
  // turn never produced a token (a failure before or during the final call).
  let aiMessage: PlaceholderMessage;
  if (streaming.placeholder) {
    await Message.updateOne({ _id: streaming.placeholder._id }, persisted);
    aiMessage = streaming.placeholder;
  } else {
    aiMessage = await Message.create({
      conversationId: conversation._id,
      organizationId: conversation.organizationId,
      role: "ai",
      senderType: "ai",
      ...persisted,
    });
  }

  // Tell clients to promote the streaming bubble to a final message. Emitted
  // after persistence so a client that refetches on this event sees the real row.
  io?.to(sessionRoom).emit("message:done", {
    conversationId,
    messageId: aiMessage._id.toString(),
    content: replyText,
  });

  // Fire-and-forget: fetch OpenRouter cost and store UsageRecord.
  //
  // The promise is kept rather than dropped so RAG telemetry can backfill the
  // same tokens and cost onto its own document. Asking OpenRouter twice per turn
  // for numbers this call already fetched would be a second round trip for
  // nothing. The `.catch` still lives here, so a usage failure stays a warning.
  let usage: Promise<UsageTotals | null> | null = null;
  if (generationIds.length > 0) {
    usage = recordConversationUsage({
      generationIds,
      organizationId: conversation.organizationId,
      websiteId: (conversation as unknown as { websiteId?: string | null }).websiteId ?? null,
      conversationId: conversation._id,
      model: usageModel,
    }).catch((err) => {
      logger.warn("[ai] usage recording failed", { err: (err as Error).message });
      return null;
    });
  }

  // Per-turn RAG telemetry (__specs/39). Deliberately last, deliberately not
  // awaited, and deliberately after the reply has been persisted and emitted:
  // the customer's reply is already on its way out by this line, so nothing
  // below can cost them latency and nothing below can fail their turn.
  recordRagTurn({
    organizationId,
    agentId,
    conversationId,
    messageId: aiMessage._id.toString(),
    customerMessage,
    queryRewrites,
    retrievalStats,
    kbHits,
    citations,
    generationStats,
    confidence,
    action,
    toolTurns,
    conflicted,
    replyText,
    model: usageModel,
    status: telemetryStatus,
    durationMs: Date.now() - turnStarted,
    usage,
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
  conversation.lastMessageAt = (aiMessage.createdAt as Date | undefined) ?? new Date();
  conversation.lastMessagePreview = replyText.slice(0, 140);
  conversation.messageCount = (conversation.messageCount ?? 0) + 1;
  await conversation.save();

  if (!io) return;
  const payload = { conversationId, messageId: aiMessage._id.toString() };
  io.to(`org:${organizationId}`).emit("message:new", payload);
  io.to(`conversation:${conversationId}`).emit("message:new", payload);
  io.to(sessionRoom).emit("message:new", payload);
  if (conversationChanged) {
    io.to(`org:${organizationId}`).emit("conversation:updated", {
      conversationId,
      status: conversation.status,
    });
  }
}

export { Conversation };
