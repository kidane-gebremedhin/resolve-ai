// The finalize step: write the customer-facing reply, and judge the turn.
//
// Two calls run concurrently. The first streams prose so the customer sees
// tokens within a few hundred milliseconds; it is tagged so the runner can pick
// its tokens out of the graph's event stream and forward them over Socket.IO.
// The second is a cheap structured pass that decides confidence, next action and
// follow-up chips — kept separate precisely so the visible reply can stream as
// plain text instead of arriving as one JSON blob at the end.

import * as Sentry from "@sentry/node";
import { SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";
import { logger } from "../../../../config/logger.js";
import { createChatModel, contentToText, generationIdOf } from "../../llm/chat-model.js";
import { extractUrls, fetchOgPreview } from "../../../og/preview.service.js";
import { FINAL_REPLY_TAG, getTurnContext } from "../context.js";
import type { AgentState, AgentStateUpdate, GenerationStats, ReplyAction } from "../state.js";
import type { MessageBlock } from "../../../../types/messageBlocks.js";
import { assertVerbatim, buildContextBlock } from "../../context-block.js";
import { validateCitations } from "../../citation-validator.js";
import { env } from "../../../../config/env.js";

export const FINALIZE_NODE = "finalize";

const FINAL_INSTRUCTION =
  "Now write your final reply to the customer. Be concise and helpful. Do NOT include JSON. " +
  "Use markdown when it improves clarity — bullet lists for multi-step answers or lists of items, " +
  "**bold** for key terms — plain prose otherwise.";

const presentInstruction = (toolKey: string) =>
  `The customer just submitted a form that completed the "${toolKey}" action — its result is in the last message. ` +
  "Write a short confirmation presenting ONLY that result (e.g. confirm the booking date/time, or the plan change). " +
  "Do NOT bring up, answer, or reference any earlier or unrelated request from the conversation. " +
  "Do NOT include JSON. Use markdown sparingly.";

const MetaSchema = z.object({
  confidence: z
    .number()
    .describe("Confidence 0.0-1.0 that the reply correctly addresses the customer's need."),
  action: z
    .enum(["reply", "escalate", "resolve"])
    .describe("What should happen after this turn."),
  quickReplies: z
    .array(z.string())
    .nullable()
    .describe("Up to 3 short follow-up chip labels the customer would likely tap next, or null."),
});

const META_INSTRUCTION =
  'Evaluate this conversation and output a JSON object with: "confidence" (0.0-1.0 how well the reply ' +
  'addresses the need), "action" ("reply"|"escalate"|"resolve"), and "quickReplies" (null, or an array ' +
  "of up to 3 short follow-up chip labels (3-7 words each) the customer would likely tap next — include " +
  "when there are natural follow-ups, null when not applicable).";

/** Stream the customer-facing prose, accumulating it as it goes. */
async function streamReply(
  messages: BaseMessage[],
  ctx: { model: string; temperature: number },
  config?: RunnableConfig,
): Promise<{ text: string; generationId: string | null }> {
  const model = createChatModel({
    model: ctx.model,
    temperature: ctx.temperature,
    streaming: true,
  }).withConfig({ tags: [FINAL_REPLY_TAG], runName: "final_reply" });

  let text = "";
  let generationId: string | null = null;
  const stream = await model.stream(messages, config);
  for await (const chunk of stream) {
    text += contentToText(chunk.content);
    generationId ??= generationIdOf(chunk);
  }
  return { text, generationId };
}

/** Judge the turn: confidence, next action, follow-up chips. */
async function runMetaPass(
  messages: BaseMessage[],
  ctx: { model: string },
  config?: RunnableConfig,
): Promise<{ meta: z.infer<typeof MetaSchema> | null; generationId: string | null }> {
  const model = createChatModel({
    model: ctx.model,
    // Deterministic: this is a classification, not a piece of writing.
    temperature: 0,
  })
    .withStructuredOutput(MetaSchema, {
      name: "meta_pass",
      method: "jsonSchema",
      includeRaw: true,
    })
    .withConfig({ runName: "meta_pass" });

  const { raw, parsed } = (await model.invoke(messages, config)) as {
    raw: BaseMessage;
    parsed: z.infer<typeof MetaSchema> | null;
  };
  return { meta: parsed ?? null, generationId: generationIdOf(raw) };
}

/** Open Graph previews for up to a couple of links the reply mentions. */
async function linkPreviewBlocks(replyText: string): Promise<MessageBlock[]> {
  try {
    const urls = extractUrls(replyText);
    if (urls.length === 0) return [];
    const previews = await Promise.all(urls.map((u) => fetchOgPreview(u).catch(() => null)));
    return previews.filter((og): og is NonNullable<typeof og> => Boolean(og)).map(
      (og) => ({ type: "link_preview", ...og }) as MessageBlock,
    );
  } catch {
    // Never crash the reply for a link preview.
    return [];
  }
}

/**
 * Replace `search_kb` tool payloads with a pointer to the context block.
 *
 * The tool call itself has to stay in the transcript: removing it would leave an
 * assistant message referencing a tool call with no result, which providers
 * reject. So the message is kept and its content replaced.
 */
function stripKbToolResults(messages: readonly BaseMessage[]): BaseMessage[] {
  return messages.map((m) => {
    if (!(m instanceof ToolMessage) || m.name !== "search_kb") return m;
    return new ToolMessage({
      content: JSON.stringify({ seeNumberedPassagesBelow: true }),
      tool_call_id: m.tool_call_id,
      name: m.name,
    });
  });
}

export async function finalizeNode(
  state: AgentState,
  config?: RunnableConfig,
): Promise<AgentStateUpdate> {
  const ctx = getTurnContext(config);

  // Build the numbered context block the reply must be grounded in. Passages
  // reached the model only as a tool-result blob before this: nothing to cite,
  // so nothing cited.
  const context = buildContextBlock(state.kbHits);
  if (context.citations.length > 0) {
    // Structural, not aspirational: if anything between the store and here ever
    // edits a passage, every citation in the product silently starts pointing at
    // our paraphrase instead of the evidence.
    assertVerbatim(context, state.kbHits);
  }

  const instruction = ctx.presentToolResult
    ? presentInstruction(ctx.presentToolResult.toolKey)
    : FINAL_INSTRUCTION;

  // No evidence means NO block, not an empty one. An empty "Retrieved passages:"
  // header invites a best-effort guess under a heading that implies sourcing.
  const groundedInstruction =
    context.text.length > 0
      ? `Retrieved passages — the only source for factual claims about this organization:\n\n${context.text}\n\n${instruction}\n\nCite the passage marker on every factual sentence, e.g. "Refunds take 30 days [2]." Cite only a passage that actually supports the sentence.`
      : `${instruction}\n\nNo passages were retrieved for this question. Do not state facts about this organization's products, pricing or policies. Say plainly that you don't have that information and follow the escalation policy.`;

  // The passages are now in the numbered block, so the raw `search_kb` tool
  // results are redundant in the finalize call — sending both puts every
  // passage in the prompt TWICE, roughly doubling context tokens for no benefit
  // and giving the model two representations of the same evidence, only one of
  // which carries the markers it is asked to cite.
  //
  // Only for THIS call. The agent loop still sees full tool results, because
  // that is what it reasons over when deciding whether to search again.
  const messagesForReply =
    context.citations.length > 0 ? stripKbToolResults(state.messages) : state.messages;

  const streamMessages = [...messagesForReply, new SystemMessage(groundedInstruction)];
  const metaMessages = [...state.messages, new SystemMessage(META_INSTRUCTION)];

  const generationStarted = Date.now();
  const [replyResult, metaResult] = await Promise.allSettled([
    streamReply(streamMessages, ctx, config),
    runMetaPass(metaMessages, ctx, config),
  ]);

  const generationIds: string[] = [];
  let replyText = "";
  if (replyResult.status === "fulfilled") {
    replyText = replyResult.value.text.trim();
    if (replyResult.value.generationId) generationIds.push(replyResult.value.generationId);
  } else {
    logger.error("[ai] streaming final call failed", {
      err: (replyResult.reason as Error)?.message,
    });
    // Report to Sentry so a provider-side outage (OpenRouter key/credits/model)
    // is actually alertable. Without this the failure is swallowed into a 201 +
    // the fallback string below, so uptime checks and dashboards stay green
    // while every customer conversation is silently broken.
    Sentry.captureException(replyResult.reason, { tags: { area: "ai.stream" } });
    // Generic, non-committal error — don't promise a human handoff here (the
    // escalation action is decided by the meta pass, not by this fallback).
    replyText = "Sorry, I encountered some issues, please try again later.";
  }

  let confidence = 0.5;
  let action: ReplyAction = "reply";
  let quickReplies: string[] | undefined;
  if (metaResult.status === "fulfilled") {
    if (metaResult.value.generationId) generationIds.push(metaResult.value.generationId);
    const meta = metaResult.value.meta;
    if (meta) {
      confidence = Math.max(0, Math.min(1, meta.confidence));
      action = meta.action;
      const chips = (meta.quickReplies ?? [])
        .filter((v) => typeof v === "string" && v.trim().length > 0)
        .slice(0, 3);
      if (chips.length > 0) quickReplies = chips;
    }
  } else {
    logger.warn("[ai] meta-pass failed", { err: (metaResult.reason as Error)?.message });
  }

  const rawText = replyText || "I'm here — what can I help with?";

  // Validate the citations the model emitted. Markers pointing at nothing are
  // stripped: a citation the customer can click that resolves to nothing looks
  // more like evidence than no citation at all.
  const validated = validateCitations(rawText, context.citations);
  const finalText = validated.text || rawText;

  if (validated.invalidMarkers.length > 0) {
    logger.warn("[ai] reply cited markers that do not exist, stripped", {
      invalid: validated.invalidMarkers,
      available: context.citations.length,
    });
  }

  // Faithfulness as a live control rather than a metric read later. When too
  // much of the answer states facts with nothing behind them, drop confidence so
  // the EXISTING `AI_CONFIDENCE_THRESHOLD` escalation catches the turn — no new
  // escalation path, just an honest input to the one already there.
  if (
    context.citations.length > 0 &&
    validated.factualSentences > 0 &&
    validated.uncitedRatio > env.ai.maxUncitedRatio
  ) {
    const lowered = Math.min(confidence, env.ai.confidenceThreshold - 0.01);
    logger.warn("[ai] reply is largely uncited, lowering confidence", {
      uncitedRatio: Number(validated.uncitedRatio.toFixed(2)),
      factualSentences: validated.factualSentences,
      confidenceFrom: confidence,
      confidenceTo: lowered,
    });
    confidence = Math.max(0, lowered);
  }

  logger.info("[ai] grounding", {
    passages: context.citations.length,
    deduped: context.deduped,
    droppedForBudget: context.dropped.length,
    contextTokens: context.estimatedTokens,
    citationsUsed: validated.used.length,
    invalidMarkers: validated.invalidMarkers.length,
    uncitedRatio: Number(validated.uncitedRatio.toFixed(2)),
  });

  // Measured before the link-preview fetch below, which is an outbound HTTP
  // call to whatever domains the reply happened to mention. Folding that into
  // "generation latency" would make the number track third-party sites rather
  // than the model.
  const generationStats: GenerationStats = {
    latencyMs: Date.now() - generationStarted,
    answerLength: finalText.length,
    citationCount: validated.used.length,
    citedSourceIds: [...new Set(validated.used.map((c) => c.sourceId))],
  };

  return {
    replyText: finalText,
    confidence,
    action,
    ...(quickReplies ? { quickReplies } : {}),
    blocks: await linkPreviewBlocks(finalText),
    generationIds,
    citations: validated.used,
    generationStats,
  };
}
