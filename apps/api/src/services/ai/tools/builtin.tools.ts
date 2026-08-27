// Built-in agent tools — the capabilities every agent has regardless of which
// integrations its org has connected.
//
// Each returns a `[content, artifact]` pair: the content is JSON the model
// reads, the artifact carries the KB hits / halt signal the turn needs but the
// model must not see.

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { KnowledgeGap } from "../../../models/index.js";
import { KnowledgeBaseRetriever } from "../retrieval/kb-retriever.js";
import { understoodSearch } from "../retrieval/understood-search.js";
import { buildFormBlock } from "../shared/forms.js";
import type { ToolArtifact, ToolExecutionContext } from "./types.js";

const SEARCH_KB = "search_kb";
const ESCALATE_CONVERSATION = "escalate_conversation";
const RESOLVE_CONVERSATION = "resolve_conversation";
const REQUEST_FORM = "request_form";

/** The tool names handled in-process, rather than dispatched to a provider. */
export const BUILTIN_TOOL_NAMES = new Set<string>([
  SEARCH_KB,
  ESCALATE_CONVERSATION,
  RESOLVE_CONVERSATION,
  REQUEST_FORM,
]);

/**
 * Log a query whose best KB match was too weak to answer from, so operators can
 * see what their knowledge base is missing. Fire-and-forget: an analytics write
 * must never fail a customer reply.
 */
function recordKnowledgeGap(ctx: ToolExecutionContext, query: string, maxScore: number): void {
  if (maxScore >= env.ai.kbGapScoreThreshold) return;
  KnowledgeGap.findOneAndUpdate(
    { organizationId: ctx.organizationId, agentId: ctx.agentId, queryUsed: query },
    {
      $set: { question: ctx.customerMessage, maxKbScore: maxScore },
      $inc: { occurrenceCount: 1 },
      $setOnInsert: { status: "open" },
    },
    { upsert: true },
  ).catch((err: Error) => logger.warn("[ai] knowledge-gap upsert failed", { err: err.message }));
}

/**
 * Record a contradiction for the operator dashboard.
 *
 * A conflict is a different problem from a gap and needs a different fix: a gap
 * is filled by writing a document, a conflict is fixed by deciding which
 * existing document is right and retiring or reprioritising the other. Sharing
 * one record kind would bury the conflicts inside a list of missing topics.
 *
 * Fire-and-forget, like the gap record: an analytics write must never fail a
 * customer reply.
 */
function recordConflict(
  ctx: ToolExecutionContext,
  query: string,
  conflict: {
    reason: string;
    resolution: { winner: { sourceId: string } | null; resolvedBy: string; losers: { sourceId: string; sourceTitle: string }[] } | null;
  },
): void {
  const winner = conflict.resolution?.winner;
  const involved = [
    ...(winner ? [winner] : []),
    ...(conflict.resolution?.losers ?? []),
  ] as { sourceId: string; sourceTitle?: string }[];

  KnowledgeGap.findOneAndUpdate(
    { organizationId: ctx.organizationId, agentId: ctx.agentId, queryUsed: query, kind: "conflict" },
    {
      $set: {
        question: ctx.customerMessage,
        // Not a relevance failure: retrieval worked, the documents disagree.
        maxKbScore: 1,
        kind: "conflict",
        conflict: {
          sourceIds: involved.map((s) => s.sourceId),
          sourceTitles: involved.map((s) => s.sourceTitle ?? "Untitled"),
          resolvedBy: conflict.resolution?.resolvedBy ?? "unresolved",
          ...(winner ? { winningSourceId: winner.sourceId } : {}),
        },
      },
      $inc: { occurrenceCount: 1 },
      $setOnInsert: { status: "open" },
    },
    { upsert: true },
  ).catch((err: Error) =>
    logger.warn("[ai] conflict record upsert failed", { err: err.message }),
  );
}

function buildSearchKbTool(ctx: ToolExecutionContext): StructuredToolInterface {
  const retriever = new KnowledgeBaseRetriever({
    organizationId: ctx.organizationId,
    agentId: ctx.agentId,
  });

  return tool(
    async (input): Promise<[string, ToolArtifact]> => {
      const query = String((input as { query?: unknown }).query ?? "").trim();
      if (!query) return [JSON.stringify({ hits: [] }), { status: "success" }];

      // Query understanding sits here rather than inside the retriever, because
      // it needs conversation history and the org's vocabulary — context the
      // retriever has no business knowing about. With rewriting disabled this
      // is one `searchHits` call with the model's own query, exactly as before.
      const { hits, record, noRelevantEvidence, conflict } = await understoodSearch({
        query,
        conversationId: ctx.conversationId,
        retriever,
        history: ctx.history ?? [],
        vocabulary: ctx.vocabulary ?? [],
      });

      logger.info("[ai] search_kb", {
        query: record.originalQuery,
        rewritten: record.rewrittenQuery,
        queriesRun: record.queriesRun.length,
        followUpRan: record.followUpRan,
        rewriteMs: record.rewriteLatencyMs,
        searchMs: record.totalLatencyMs,
        rerankRan: record.rerank.ran,
        rerankCandidates: record.rerank.candidates,
        rerankTopScore: record.rerank.topScore,
        rankCorrection: record.rerank.rankCorrection,
        rerankMs: record.rerank.latencyMs,
        noRelevantEvidence,
        hits: hits.length,
        topScore: hits[0]?.score,
      });
      // The knowledge gap records what was actually searched for: the raw query
      // is what the customer's need looked like before we cleaned it up, and an
      // operator reading the gap list wants that, not our paraphrase.
      recordKnowledgeGap(ctx, record.originalQuery, hits.length > 0 ? Math.max(...hits.map((h) => h.score)) : 0);

      // A calibrated reranker said every candidate is irrelevant. That is a
      // fact worth stating rather than hiding behind an empty result: told
      // plainly, the model escalates instead of assembling an answer out of
      // whatever it already believes. Before stage 2 existed there was no way
      // to distinguish this from "retrieval happened to return nothing".
      if (noRelevantEvidence) {
        recordKnowledgeGap(ctx, record.originalQuery, record.rerank.topScore ?? 0);
        return [
          JSON.stringify({
            hits: [],
            noRelevantEvidence: true,
            instruction:
              "The knowledge base does not contain an answer to this question. Say so plainly and escalate to a human. Do not answer from general knowledge.",
          }),
          {
            kbHits: [],
            queryRewrite: record,
            retrievalStats: retriever.drainStats(),
            noRelevantEvidence: true,
            status: "success",
          },
        ];
      }

      // A contradiction is a fact about the evidence, so the model is told
      // about it explicitly rather than left to notice that two passages
      // disagree — which it reliably does not, and instead blends them into a
      // confident answer that exists in no document.
      if (conflict.conflicted) {
        recordConflict(ctx, record.originalQuery, conflict);
      }

      const content = JSON.stringify({
        hits: hits.map((h) => ({
          source: h.sourceTitle,
          text: h.text,
          score: Number(h.score.toFixed(3)),
        })),
        ...(conflict.conflicted
          ? {
              conflict: {
                detected: true,
                disagreementAbout: conflict.reason,
                authoritativeSource: conflict.resolution?.winner?.sourceTitle ?? null,
                resolvedBy: conflict.resolution?.resolvedBy ?? "unresolved",
                instruction:
                  conflict.resolution?.winner
                    ? `These sources disagree about ${conflict.reason || "the answer"}. "${conflict.resolution.winner.sourceTitle}" is authoritative. Answer from it ONLY, cite it, and do not blend in the other source or mention both figures as if either could be right.`
                    : `These sources disagree about ${conflict.reason || "the answer"} and nothing distinguishes which is correct. Do NOT pick one and do NOT merge them. Tell the customer our documentation is inconsistent on this point and escalate to a human.`,
              },
            }
          : {}),
      });
      return [
        content,
        {
          kbHits: hits,
          queryRewrite: record,
          retrievalStats: retriever.drainStats(),
          ...(conflict.conflicted ? { conflicted: true } : {}),
          status: "success",
        },
      ];
    },
    {
      name: SEARCH_KB,
      description:
        "Search the organization's knowledge base for relevant passages. Use this before answering any question whose answer is not obviously in the conversation history.",
      schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "A focused search query (3-12 words). Rephrase the customer's question to extract the core information need.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      responseFormat: "content_and_artifact",
    },
  ) as unknown as StructuredToolInterface;
}

/**
 * Escalation and resolution are SIGNALS, not actions. The tool only
 * acknowledges the intent; the turn's real status change is decided after the
 * final reply by the meta pass and then filtered through the org's
 * conversation controls (see shared/controls.ts).
 */
function buildEscalateTool(): StructuredToolInterface {
  return tool(
    async (): Promise<[string, ToolArtifact]> => [
      JSON.stringify({ ok: true, note: "Escalation will be applied after the final reply." }),
      { status: "success" },
    ],
    {
      name: ESCALATE_CONVERSATION,
      description:
        "Transfer the conversation to a human operator. Use this when (a) the customer explicitly asks for a human, (b) the customer is angry/frustrated, (c) you cannot help confidently after a KB search, or (d) the issue requires account access or payment changes.",
      schema: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "One-sentence reason for the handoff, written for the operator.",
          },
        },
        required: ["reason"],
        additionalProperties: false,
      },
      responseFormat: "content_and_artifact",
    },
  ) as unknown as StructuredToolInterface;
}

function buildResolveTool(): StructuredToolInterface {
  return tool(
    async (): Promise<[string, ToolArtifact]> => [
      JSON.stringify({ ok: true, note: "Resolution will be applied after the final reply." }),
      { status: "success" },
    ],
    {
      name: RESOLVE_CONVERSATION,
      description:
        "Mark the conversation as resolved. Use ONLY when the customer has confirmed their issue is fixed or thanks you in a way that clearly ends the exchange.",
      schema: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "One-sentence summary of how the issue was resolved.",
          },
        },
        required: ["summary"],
        additionalProperties: false,
      },
      responseFormat: "content_and_artifact",
    },
  ) as unknown as StructuredToolInterface;
}

/**
 * Lets the AI render an inline form in the widget to collect the exact inputs an
 * integration/webhook tool needs (order #, reason, …) as ONE structured payload,
 * instead of asking for each field in chat. Only offered when the agent actually
 * has integration tools. On submit, the widget posts the payload back and the
 * tool runs automatically.
 */
function buildRequestFormTool(args: {
  schemaByKey: Map<string, unknown>;
  webhookToolKeys: Set<string>;
}): StructuredToolInterface {
  return tool(
    async (input): Promise<[string, ToolArtifact]> => {
      const { toolKey, title } = input as { toolKey?: unknown; title?: unknown };
      const targetKey = String(toolKey ?? "");
      const formBlock = buildFormBlock(
        targetKey,
        args.schemaByKey.get(targetKey),
        title,
        undefined,
        undefined,
        // Custom webhooks: collect every field of the operator's schema.
        !args.webhookToolKeys.has(targetKey),
      );
      if (!formBlock) {
        return [
          JSON.stringify({ error: `No integration tool "${targetKey}" with fillable fields.` }),
          { status: "error" },
        ];
      }
      return [
        JSON.stringify({
          shown: true,
          note: "Form displayed. Wait for the customer to submit it — do not ask for the same fields in chat.",
        }),
        { blocks: [formBlock], halt: true, status: "success" },
      ];
    },
    {
      name: REQUEST_FORM,
      description:
        "Show the customer an inline form to collect the inputs an integration/webhook tool needs (e.g. order number, reason). Prefer this over asking for several fields in chat. After the customer submits, the tool runs automatically. Pass the exact `toolKey` of the tool whose inputs you need.",
      schema: {
        type: "object",
        properties: {
          toolKey: {
            type: "string",
            description: "The integration tool to collect inputs for, e.g. lookup_order.",
          },
          title: { type: "string", description: "Optional short heading shown above the form." },
        },
        required: ["toolKey"],
        additionalProperties: false,
      },
      responseFormat: "content_and_artifact",
    },
  ) as unknown as StructuredToolInterface;
}

/**
 * The built-in tool set for a conversation, gated by org settings. When human
 * escalation is disabled the escalate tool is removed entirely, so the model
 * cannot signal a handoff it isn't allowed to make.
 */
export function buildBuiltinTools(args: {
  ctx: ToolExecutionContext;
  allowEscalation: boolean;
  /** request_form is only useful when there is an integration tool to fill in. */
  offerRequestForm: boolean;
  schemaByKey: Map<string, unknown>;
  webhookToolKeys: Set<string>;
}): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = [buildSearchKbTool(args.ctx)];
  if (args.allowEscalation) tools.push(buildEscalateTool());
  tools.push(buildResolveTool());
  if (args.offerRequestForm) {
    tools.push(
      buildRequestFormTool({
        schemaByKey: args.schemaByKey,
        webhookToolKeys: args.webhookToolKeys,
      }),
    );
  }
  return tools;
}
