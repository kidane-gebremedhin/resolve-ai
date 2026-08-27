import { z } from "zod";

/**
 * One golden case.
 *
 * `expectedChunkIds` is the precise target (chunk ids are `<sourceId>:<index>`),
 * `expectedSourceIds` the coarse one. Cases may declare either; chunk ids score
 * retrieval exactly, source ids tolerate a re-chunk that shifts indices without
 * changing which document holds the answer. Both empty means this is a negative
 * case: the fixture KB genuinely does not contain the answer, and the correct
 * behavior is to say so and escalate.
 */
export const evalCaseSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  /** Resolved at run time against the fixture agent unless a case pins one. */
  agentId: z.string().optional(),
  expectedSourceIds: z.array(z.string()).default([]),
  expectedChunkIds: z.array(z.string()).default([]),
  referenceAnswer: z.string().default(""),
  mustContain: z.array(z.string()).default([]),
  mustNotContain: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  /**
   * Prior turns, replayed into the same conversation before the question is
   * asked. Only follow-up cases need this: it is what makes "what about the
   * annual one?" mean anything.
   */
  history: z
    .array(z.object({ role: z.enum(["customer", "ai"]), content: z.string() }))
    .default([]),
});

export type EvalCase = z.infer<typeof evalCaseSchema>;

export const datasetSchema = z.object({
  name: z.string().default("golden"),
  description: z.string().default(""),
  cases: z.array(evalCaseSchema).min(1),
});

export type Dataset = z.infer<typeof datasetSchema>;

/** A case is negative when it declares no evidence anywhere in the KB. */
export function isNegativeCase(c: EvalCase): boolean {
  return c.expectedChunkIds.length === 0 && c.expectedSourceIds.length === 0;
}

export type RetrievalScores = {
  /** Keyed by K, e.g. `{ "3": 0.66, "5": 1, "10": 1 }`. Null where inapplicable. */
  recallAtK: Record<string, number | null>;
  precisionAtK: Record<string, number | null>;
  ndcgAtK: Record<string, number | null>;
  reciprocalRank: number | null;
  /** Hits at the production default `AI_KB_SEARCH_TOP_K`. */
  hitAtProductionK: boolean | null;
  /** Whether this query fell through to `KnowledgeBaseRetriever`'s widen-on-empty retry. */
  widenedOnEmpty: boolean;
  retrievedCount: number;
  topScore: number | null;
  latencyMs: number;
};

export type GenerationScores = {
  faithfulness: number | null;
  unsupported: { claim: string; verdict: string; reason?: string }[];
  answerRelevance: number | null;
  correctness: number | null;
  contextPrecision: number | null;
  contextRecall: number | null;
  citationAccuracy: number | null;
  refusalCorrect: boolean | null;
  mustContainPassed: boolean | null;
  mustNotContainPassed: boolean | null;
};

/**
 * Per-case cost and latency.
 *
 * `costUsd` is deliberately `number | null`: OpenRouter resolves cost
 * asynchronously and the usage service records zero when it gives up, so an
 * unresolved cost must read as unknown. A fake 0.00 in a budget table is worse
 * than a blank, because it is indistinguishable from a free call.
 */
export type OperationalScores = {
  latencyMs: { retrieval: number; generation: number; total: number };
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  costResolved: boolean;
  judgeCostUsd: number | null;
  generationIds: string[];
};

/** What the query-understanding stage did for this case, for the report. */
export type RewriteRecord = {
  originalQuery: string;
  rewrittenQuery: string;
  queriesRun: string[];
  rewritten: boolean;
  followUpRan: boolean;
  /** The rewrite model call alone: the number the 400ms budget is stated in. */
  rewriteLatencyMs: number;
  /** Rewrite plus every retrieval it caused. */
  totalLatencyMs: number;
};

export type CaseResult = {
  id: string;
  /**
   * The conversation this case ran in, or null when the case errored before one
   * existed. Costs are joined back on this rather than on array position: a
   * single errored case would otherwise shift every later index and silently
   * attribute one case's cost to another.
   */
  conversationId: string | null;
  question: string;
  tags: string[];
  negative: boolean;
  answer: string;
  action: string;
  confidence: number | null;
  retrieval: RetrievalScores;
  generation: GenerationScores;
  operational: OperationalScores;
  rewrite: RewriteRecord | null;
  error?: string;
};

export type ReportSummary = {
  cases: number;
  errored: number;
  retrieval: {
    recallAtK: Record<string, number | null>;
    precisionAtK: Record<string, number | null>;
    ndcgAtK: Record<string, number | null>;
    mrr: number | null;
    hitRateAtProductionK: number | null;
    widenOnEmptyRate: number;
  };
  generation: {
    faithfulness: number | null;
    answerRelevance: number | null;
    correctness: number | null;
    contextPrecision: number | null;
    contextRecall: number | null;
    citationAccuracy: number | null;
    refusalCorrectness: number | null;
    mustContainPassRate: number | null;
    mustNotContainPassRate: number | null;
  };
  operational: {
    p50LatencyMs: number;
    p95LatencyMs: number;
    /** Query-rewrite latency, the number its budget is stated in. */
    rewriteP50Ms: number | null;
    rewriteP95Ms: number | null;
    rewriteFailureRate: number | null;
    followUpRate: number | null;
    totalCostUsd: number | null;
    unresolvedCostCases: number;
    totalJudgeCostUsd: number | null;
    judgeCacheHits: number;
    judgeCalls: number;
  };
};

export type Report = {
  version: 1;
  startedAt: string;
  finishedAt: string;
  dataset: string;
  ks: number[];
  productionTopK: number;
  answeringModel: string;
  judgeModel: string;
  summary: ReportSummary;
  results: CaseResult[];
};
