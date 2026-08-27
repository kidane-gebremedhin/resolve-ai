// Types shared by the tool layer and the graph's tool node.

import type { StructuredToolInterface } from "@langchain/core/tools";
import type { MessageBlock } from "../../../types/messageBlocks.js";
import type { KbHit } from "../../kb/search.service.js";
import type { QueryRewriteRecord } from "../graph/state.js";
import type { RetrievalStats } from "../retrieval/kb-retriever.js";

/**
 * The out-of-band half of a tool result.
 *
 * A tool returns two things: the text the model reads, and everything else the
 * turn needs — rich cards to render, KB passages to cite, whether the agent must
 * now stop and wait for the customer. LangChain's `content_and_artifact`
 * response format carries the second half on the ToolMessage without ever
 * showing it to the model, which is exactly the split we want.
 */
export type ToolArtifact = {
  /** Rich UI blocks to attach to the AI message (cards, forms, OTP prompts). */
  blocks?: MessageBlock[];
  /** KB passages retrieved by this call, for the citations panel. */
  kbHits?: KbHit[];
  /** What this search actually embedded, before and after rewriting. */
  queryRewrite?: QueryRewriteRecord;
  /**
   * Per-search retrieval stats for online telemetry. One entry per embedded
   * query, so a rewrite that fanned out into three paraphrases reports three.
   */
  retrievalStats?: RetrievalStats[];
  /**
   * A calibrated reranker judged every candidate irrelevant. Distinct from an
   * empty `kbHits`, which could also mean retrieval failed or the KB is empty.
   */
  noRelevantEvidence?: boolean;
  /** Two sources gave incompatible answers to the queried fact. */
  conflicted?: boolean;
  /**
   * The turn must stop calling tools: something is now awaiting customer input
   * (an inline form, an OTP challenge). Continuing would let the model claim an
   * action that has not happened.
   */
  halt?: boolean;
  /** Audit status for the ToolCallLog record. */
  status?: "success" | "error";
};

export type ToolExecutionContext = {
  organizationId: string;
  agentId: string;
  conversationId: string;
  contactSessionId: string;
  /** The customer turn that triggered this call — used for knowledge-gap records. */
  customerMessage: string;
  /**
   * Prior turns, oldest first. Passed in rather than re-read from Mongo because
   * the runner already loaded them, and query rewriting needs them to resolve a
   * follow-up like "what about the annual one?" into something embeddable.
   */
  history?: { role: string; content: string }[];
  /**
   * The org's own words: product names and KB document titles. Given to the
   * rewriter so it expands acronyms and spells product names the way the
   * documents do, rather than the way the customer guessed.
   */
  vocabulary?: string[];
  /** Whether tool arguments are masked before being written to the audit log. */
  piiRedact: boolean;
};

/**
 * Everything the graph needs to know about this conversation's tools: the
 * callable tools themselves, plus the schema metadata the tool node consults
 * before deciding to execute a call or collect missing inputs first.
 */
export type ToolRegistry = {
  /** Tools offered to the model, in bind order. */
  tools: StructuredToolInterface[];
  byName: Map<string, StructuredToolInterface>;
  /** Names handled in-process (vs. dispatched to an integration provider). */
  builtinNames: Set<string>;
  /** Offered JSON schema per integration tool key. */
  schemaByKey: Map<string, unknown>;
  /** Per-tool guardrail config (e.g. book_meeting's requireNamedAttendee). */
  guardrailsByKey: Map<string, { requireNamedAttendee?: boolean } | undefined>;
  /** Tool keys backed by a custom-webhook connection (operator-defined schema). */
  webhookToolKeys: Set<string>;
  /** Integration tool keys active for this agent — drives prompt layering. */
  activeToolKeys: string[];
  /** Deduped {key, description} list rendered into the system prompt. */
  promptTools: { key: string; description?: string }[];
};
