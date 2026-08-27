// Graph state for one customer turn.
//
// State is per-turn and in-memory: MongoDB's Message collection remains the
// single source of truth for conversation history, and every turn rebuilds its
// message list from there. There is deliberately no checkpointer — a second
// durable store of the same conversation would have to be kept in sync with the
// inbox, and nothing here needs to resume across process restarts.

import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { MessageBlock } from "../../../types/messageBlocks.js";
import type { KbHit } from "../../kb/search.service.js";
import type { RetrievalStats } from "../retrieval/kb-retriever.js";
import type { ContextCitation } from "../context-block.js";

export type ReplyAction = "reply" | "escalate" | "resolve";

export type ToolCallRecord = { name: string; args: unknown; result: unknown };

/** One KB search's before-and-after, plus what the rewrite decided to run. */
export type QueryRewriteRecord = {
  originalQuery: string;
  rewrittenQuery: string;
  /** Every string embedded for this search, including paraphrases and any follow-up. */
  queriesRun: string[];
  /** False when the rewrite failed and the raw query stood in. */
  rewritten: boolean;
  /** Whether the one permitted extra round fired. */
  followUpRan: boolean;
  reason: string;
  /**
   * The rewrite model call alone. This is the number the 400ms budget is stated
   * in, so it must not include retrieval: folding the two together makes a fast
   * rewrite look like a slow one whenever Pinecone is slow.
   */
  rewriteLatencyMs: number;
  /** Rewrite plus every retrieval and fusion it caused. */
  totalLatencyMs: number;
  /**
   * Stage 2. Present whether or not reranking ran, so telemetry can tell
   * "disabled" from "ran and changed nothing" without recomputing either.
   *
   * `rankCorrection` is the number that says whether reranking earns its cost:
   * a reranker that never changes the top result is latency and money for
   * nothing.
   */
  rerank: {
    ran: boolean;
    provider: string | null;
    candidates: number;
    topScore: number | null;
    rankCorrection: boolean;
    noRelevantEvidence: boolean;
    latencyMs: number;
  };
};

/**
 * What the finalize node's two model calls produced, for online telemetry.
 *
 * Derived where the numbers are already in hand rather than re-derived in the
 * runner: `latencyMs` cannot be recovered afterwards at all, and re-counting
 * citations downstream would mean two places deciding what counts as a citation.
 */
export type GenerationStats = {
  /** The finalize node: streamed reply and meta pass, which run concurrently. */
  latencyMs: number;
  /** Characters of the validated reply. A shape signal, not a billing number. */
  answerLength: number;
  citationCount: number;
  citedSourceIds: string[];
};

const appendReducer = <T>() => ({
  reducer: (left: T[], right: T[]) => left.concat(right),
  default: (): T[] => [],
});

const lastWins = <T>(fallback: T) => ({
  reducer: (_left: T, right: T) => right,
  default: (): T => fallback,
});

export const AgentStateAnnotation = Annotation.Root({
  /** The running LLM conversation: system + history + tool traffic. */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  /** Rich UI blocks accumulated from tool artifacts (cards, forms, OTP, previews). */
  blocks: Annotation<MessageBlock[]>(appendReducer<MessageBlock>()),
  /** Every KB passage retrieved this turn; deduped into citations at the end. */
  kbHits: Annotation<KbHit[]>(appendReducer<KbHit>()),
  /** Tool trace persisted onto the AI message for the operator inbox. */
  toolCallLog: Annotation<ToolCallRecord[]>(appendReducer<ToolCallRecord>()),
  /** OpenRouter generation ids, used to price the turn after the fact. */
  generationIds: Annotation<string[]>(appendReducer<string>()),
  /**
   * One entry per embedded query, accumulated alongside `kbHits`.
   *
   * Parallel to `kbHits` rather than folded into it because they answer
   * different questions: `kbHits` is what survived to the prompt, these are what
   * every search actually did — including the searches that returned nothing,
   * which leave no hits behind and are exactly the turns worth monitoring.
   */
  retrievalStats: Annotation<RetrievalStats[]>(appendReducer<RetrievalStats>()),
  /**
   * What the KB was actually searched for this turn.
   *
   * One entry per `search_kb` call: the query the model produced, and the
   * rewritten form that was really embedded. Carried on state rather than
   * re-derived later, because the rewrite is non-deterministic and there is no
   * way to reconstruct it after the fact. Telemetry persists these as-is.
   */
  queryRewrites: Annotation<QueryRewriteRecord[]>(appendReducer<QueryRewriteRecord>()),
  /**
   * A tool has handed control to the customer (inline form / OTP challenge).
   * Latches on: once something is awaiting them, no further tool calls may run
   * this turn or the model would claim an action that hasn't happened.
   */
  halt: Annotation<boolean>({
    reducer: (left: boolean, right: boolean) => left || right,
    default: () => false,
  }),
  /**
   * Two retrieved sources contradicted each other on the queried fact.
   *
   * Latches on like `halt`: a turn that hit one contradiction hit one, and a
   * later clean search does not un-contradict it.
   */
  conflicted: Annotation<boolean>({
    reducer: (left: boolean, right: boolean) => left || right,
    default: () => false,
  }),
  /** Agent↔tool round trips so far, checked against the configured ceiling. */
  toolTurns: Annotation<number>({
    reducer: (left: number, right: number) => left + right,
    default: () => 0,
  }),

  // ---- Results produced by the finalize node ----
  replyText: Annotation<string>(lastWins("")),
  confidence: Annotation<number>(lastWins(0.5)),
  action: Annotation<ReplyAction>(lastWins<ReplyAction>("reply")),
  quickReplies: Annotation<string[] | undefined>(lastWins<string[] | undefined>(undefined)),
  /**
   * Citations the reply actually used, with the marker shown in the text.
   *
   * Produced by finalize after validation, so markers pointing at nothing are
   * already stripped. Persisted onto the message so the widget can resolve an
   * inline `[2]` to the passage it refers to.
   */
  citations: Annotation<ContextCitation[]>(lastWins<ContextCitation[]>([])),
  /** Generation-side telemetry. Undefined when finalize never ran. */
  generationStats: Annotation<GenerationStats | undefined>(
    lastWins<GenerationStats | undefined>(undefined),
  ),
});

export type AgentState = typeof AgentStateAnnotation.State;
export type AgentStateUpdate = typeof AgentStateAnnotation.Update;
