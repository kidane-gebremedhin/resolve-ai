// Online RAG telemetry (__specs/39, online section).
//
// Three things are being pinned down here, and they are pinned down separately
// because they fail separately:
//
//   the FORMULA          pure, so its boundaries are unit-testable exactly
//   the RECORD SHAPE     pure, so masking and flag derivation are testable
//                        without a database or a model
//   the WIRING           only testable end to end: that one turn writes exactly
//                        one document, that a telemetry failure cannot touch the
//                        customer's reply, and that the judge is genuinely off
//                        the reply path rather than merely intended to be

import mongoose, { type HydratedDocument } from "mongoose";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// --- scripted chat model -----------------------------------------------------
//
// Mirrors `ai-graph.test.ts`: `bindTools` and `withStructuredOutput` live on the
// MODEL and `withConfig` returns a binding that has neither. The judge is the
// one caller that invokes the model directly, so the stub carries a top-level
// `invoke` as well — and that is exactly the call whose latency this file
// measures.

let agentScript: AIMessage[] = [];
let agentCalls = 0;
let finalTokens: string[] = [];
let judgeDelayMs = 0;
/** Incremented on entry; `judgeCompleted` only once the call has returned. */
let judgeCalls = 0;
let judgeCompleted = 0;
const judgeResponse = JSON.stringify({
  claims: [
    { claim: "Refunds take 30 days.", verdict: "supported" },
    { claim: "Shipping is free.", verdict: "not_found" },
  ],
  answerRelevance: 0.9,
  correctness: null,
  contextUsedCount: 1,
  contextRequiredCovered: 1,
  contextRequiredTotal: 1,
  citationsSupported: 1,
  citationsTotal: 1,
  declined: false,
});

vi.mock("../services/ai/llm/chat-model.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai/llm/chat-model.js")>();
  const binding = {
    invoke: async () => {
      const scripted = agentScript[agentCalls];
      agentCalls += 1;
      return scripted ?? new AIMessage("All set.");
    },
    stream: async function* () {
      for (const token of finalTokens) yield new AIMessageChunk({ content: token });
    },
  };
  const structuredBinding = {
    invoke: async () => ({
      raw: new AIMessage(""),
      parsed: { confidence: 0.9, action: "reply", quickReplies: null },
    }),
  };
  const stub = {
    bindTools: () => ({ withConfig: () => binding }),
    withConfig: () => binding,
    withStructuredOutput: () => ({ withConfig: () => structuredBinding }),
    // The judge's call path.
    invoke: async () => {
      judgeCalls += 1;
      if (judgeDelayMs > 0) await new Promise((r) => setTimeout(r, judgeDelayMs));
      judgeCompleted += 1;
      return new AIMessage(judgeResponse);
    },
  };
  return { ...actual, createChatModel: () => stub, isLlmConfigured: () => true };
});

// Retrieval is stubbed at the store boundary, so everything above it — the
// retriever's stats capture, query understanding, fusion, the context block —
// runs for real.
const FIXTURE_HITS = [
  { sourceId: "src-a", sourceTitle: "Refunds", chunkIndex: 0, chunkId: "src-a:0", text: "Refunds are processed within 30 days.", score: 0.91 },
  { sourceId: "src-b", sourceTitle: "Returns", chunkIndex: 2, chunkId: "src-b:2", text: "Returns must be postmarked within 14 days.", score: 0.44 },
  { sourceId: "src-a", sourceTitle: "Refunds", chunkIndex: 1, chunkId: "src-a:1", text: "Refunds go back to the original payment method.", score: 0.39 },
];

let searchResult = FIXTURE_HITS;
vi.mock("../services/kb/search.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/kb/search.service.js")>();
  return { ...actual, searchKb: async () => searchResult };
});

import {
  Agent,
  ContactSession,
  Conversation,
  Message,
  Organization,
  RagTurnMetric,
  Website,
  type ConversationDocType,
} from "../models/index.js";
import { env } from "../config/env.js";
import {
  retrievalConfidence,
  retrievalConfidenceParts,
  scoreSummary,
  DEPTH_SATURATION,
  W_DEPTH,
  W_MAGNITUDE,
  W_MARGIN,
} from "../services/ai/retrieval/retrieval-confidence.js";
import {
  buildRagTurnMetric,
  flushRagTelemetry,
  type RagTurnInput,
} from "../services/ai/telemetry/rag-telemetry.service.js";
import { shouldSample } from "../services/ai/telemetry/online-faithfulness.service.js";
import { alertsForWindow, ragQualityWindow } from "../services/ai/telemetry/rag-alerts.service.js";
import { generateAiReplyWithGraph } from "../services/ai/graph/runner.js";

// ============================================================================
// 1. The confidence formula
// ============================================================================

describe("retrievalConfidence", () => {
  it("is exactly 0 for zero hits, not a floor built from the other terms", () => {
    // The boundary that matters most: "retrieval found nothing" must not score
    // above "retrieval found one weak passage".
    expect(retrievalConfidence([])).toBe(0);
    expect(retrievalConfidenceParts([])).toEqual({
      confidence: 0,
      magnitude: 0,
      margin: 0,
      depth: 0,
    });
    expect(retrievalConfidence([])).toBeLessThan(retrievalConfidence([0.05]));
  });

  it("gives a single hit a full margin and a one-third depth", () => {
    const parts = retrievalConfidenceParts([0.9]);
    expect(parts.margin).toBe(1);
    expect(parts.depth).toBeCloseTo(1 / DEPTH_SATURATION, 10);
    expect(parts.confidence).toBeCloseTo(
      W_MAGNITUDE * 0.9 + W_MARGIN * 1 + W_DEPTH * (1 / 3),
      10,
    );
  });

  it("ranks a lone weak hit below a lone strong one, and below a corroborated one", () => {
    const loneWeak = retrievalConfidence([0.1]);
    const loneStrong = retrievalConfidence([0.9]);
    const corroborated = retrievalConfidence([0.9, 0.2, 0.15]);
    expect(loneWeak).toBeLessThan(loneStrong);
    expect(loneStrong).toBeLessThan(corroborated);
  });

  it("scores a decisive win above a photo finish at the same top score", () => {
    const decisive = retrievalConfidence([0.9, 0.2, 0.15]);
    const photoFinish = retrievalConfidence([0.9, 0.89, 0.88]);
    expect(decisive).toBeGreaterThan(photoFinish);
  });

  it("reads the same for 0.9/0.2 as for 0.09/0.02 on the margin term alone", () => {
    // Scale-free by construction: the relative gap is what carries the signal,
    // which is why a raw cosine magnitude cannot be the whole story.
    expect(retrievalConfidenceParts([0.9, 0.2]).margin).toBeCloseTo(
      retrievalConfidenceParts([0.09, 0.02]).margin,
      10,
    );
  });

  it("does not depend on the order the scores arrive in", () => {
    // After RRF the list is ordered by fused rank, so its raw scores are not
    // monotonic. The formula sorts.
    expect(retrievalConfidence([0.2, 0.9, 0.15])).toBeCloseTo(
      retrievalConfidence([0.9, 0.2, 0.15]),
      10,
    );
  });

  it("saturates depth at three passages", () => {
    const three = retrievalConfidence([0.8, 0.4, 0.3]);
    const ten = retrievalConfidence([0.8, 0.4, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]);
    expect(ten).toBeCloseTo(three, 10);
  });

  it("clamps out-of-range scores instead of leaving the range", () => {
    expect(retrievalConfidence([1.4, 1.2])).toBeLessThanOrEqual(1);
    expect(retrievalConfidence([-0.3, -0.9])).toBeGreaterThanOrEqual(0);
    expect(retrievalConfidenceParts([-0.3, -0.9]).margin).toBe(0);
  });

  it("stays inside [0,1] across the whole plausible input space", () => {
    for (const top of [0, 0.001, 0.25, 0.5, 0.9, 1, 2]) {
      for (const second of [0, 0.001, 0.2, top, top * 0.99]) {
        for (const count of [1, 2, 3, 8]) {
          const scores = [top, ...Array<number>(count - 1).fill(second)];
          const c = retrievalConfidence(scores);
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("reaches 1 only on a perfect, decisive, corroborated retrieval", () => {
    expect(retrievalConfidence([1, 0, 0])).toBeCloseTo(1, 10);
  });
});

describe("scoreSummary", () => {
  it("returns nulls rather than zeros when there are no hits", () => {
    expect(scoreSummary([])).toEqual({ topScore: null, meanScore: null, scoreSpread: null });
  });

  it("collapses spread to zero for a single hit", () => {
    expect(scoreSummary([0.7])).toEqual({ topScore: 0.7, meanScore: 0.7, scoreSpread: 0 });
  });

  it("summarises regardless of input order", () => {
    const s = scoreSummary([0.2, 0.9, 0.4]);
    expect(s.topScore).toBe(0.9);
    expect(s.scoreSpread).toBeCloseTo(0.7, 10);
    expect(s.meanScore).toBeCloseTo(0.5, 10);
  });
});

// ============================================================================
// 2. The record shape
// ============================================================================

const OID = () => new mongoose.Types.ObjectId().toString();

function inputWith(overrides: Partial<RagTurnInput> = {}): RagTurnInput {
  return {
    organizationId: OID(),
    agentId: OID(),
    conversationId: OID(),
    messageId: OID(),
    customerMessage: "where is my refund",
    queryRewrites: [],
    retrievalStats: [],
    kbHits: [],
    citations: [],
    confidence: 0.9,
    action: "reply",
    toolTurns: 1,
    conflicted: false,
    replyText: "Refunds take 30 days.",
    model: "test/model",
    status: "ok",
    durationMs: 1234,
    ...overrides,
  };
}

const stat = (over: Partial<import("../services/ai/retrieval/kb-retriever.js").RetrievalStats> = {}) => ({
  query: "refund policy",
  topK: 8,
  minScore: 0.2,
  hitCount: 3,
  topScore: 0.91,
  widenedOnEmpty: false,
  sourceIds: ["src-a", "src-b"],
  latencyMs: 40,
  ...over,
});

describe("buildRagTurnMetric", () => {
  it("masks the query through piiMask before it can be persisted", () => {
    const doc = buildRagTurnMetric(
      inputWith({
        queryRewrites: [
          {
            originalQuery: "refund for kidane12g@gmail.com card 4111 1111 1111 1111",
            rewrittenQuery: "refund status kidane12g@gmail.com 4111 1111 1111 1111",
            queriesRun: [],
            rewritten: true,
            followUpRan: false,
            reason: "",
            rewriteLatencyMs: 10,
            totalLatencyMs: 50,
            rerank: {
              ran: false,
              provider: null,
              candidates: 0,
              topScore: null,
              rankCorrection: false,
              noRelevantEvidence: false,
              latencyMs: 0,
            },
          },
        ],
      }),
    );

    expect(doc.originalQuery).toBe("refund for [EMAIL] card [CARD]");
    expect(doc.rewrittenQuery).toBe("refund status [EMAIL] [CARD]");
    expect(JSON.stringify(doc)).not.toContain("kidane12g@gmail.com");
    expect(JSON.stringify(doc)).not.toContain("4111");
  });

  it("falls back to the customer message when the turn never searched", () => {
    const doc = buildRagTurnMetric(
      inputWith({ customerMessage: "reach me at kidane12g@gmail.com" }),
    );
    expect(doc.originalQuery).toBe("reach me at [EMAIL]");
    expect(doc.rewrittenQuery).toBe("");
    expect((doc.retrieval as Record<string, unknown>).searchCount).toBe(0);
  });

  it("derives retrieval from the passages that reached the prompt", () => {
    const doc = buildRagTurnMetric(
      inputWith({
        kbHits: FIXTURE_HITS as RagTurnInput["kbHits"],
        retrievalStats: [stat(), stat({ latencyMs: 25, sourceIds: ["src-a"] })],
      }),
    );
    const r = doc.retrieval as Record<string, unknown>;
    expect(r.hitCount).toBe(3);
    expect(r.topScore).toBe(0.91);
    expect(r.sourceIds).toEqual(["src-a", "src-b"]);
    expect(r.searchCount).toBe(2);
    expect(r.latencyMs).toBe(65);
    expect(r.retrievalConfidence).toBeCloseTo(retrievalConfidence([0.91, 0.44, 0.39]), 10);
  });

  it("records the loosest floor actually applied, not the configured one", () => {
    const doc = buildRagTurnMetric(
      inputWith({
        retrievalStats: [stat(), stat({ minScore: 0, widenedOnEmpty: true, hitCount: 0 })],
      }),
    );
    const r = doc.retrieval as Record<string, unknown>;
    expect(r.minScore).toBe(0);
    expect(r.widenedOnEmpty).toBe(true);
  });

  it("leaves tokens and cost null so an unresolved cost never reads as free", () => {
    const g = buildRagTurnMetric(inputWith()).generation as Record<string, unknown>;
    expect(g.promptTokens).toBeNull();
    expect(g.completionTokens).toBeNull();
    expect(g.costUsd).toBeNull();
  });

  it("derives every flag from the turn rather than from the model's opinion", () => {
    const bad = buildRagTurnMetric(
      inputWith({ kbHits: [], confidence: 0.1, action: "escalate", conflicted: true }),
    ).flags as Record<string, boolean>;
    expect(bad).toEqual({
      noHits: true,
      lowConfidence: true,
      escalated: true,
      conflicted: true,
    });

    const good = buildRagTurnMetric(
      inputWith({ kbHits: FIXTURE_HITS as RagTurnInput["kbHits"], confidence: 0.95 }),
    ).flags as Record<string, boolean>;
    expect(good).toEqual({
      noHits: false,
      lowConfidence: false,
      escalated: false,
      conflicted: false,
    });
  });

  it("prefers the generation stats finalize measured over re-deriving them", () => {
    const doc = buildRagTurnMetric(
      inputWith({
        generationStats: {
          latencyMs: 812,
          answerLength: 42,
          citationCount: 2,
          citedSourceIds: ["src-a", "src-b"],
        },
      }),
    );
    const g = doc.generation as Record<string, unknown>;
    expect(g.latencyMs).toBe(812);
    expect(g.answerLength).toBe(42);
    expect(g.citationCount).toBe(2);
    expect(g.citedSourceIds).toEqual(["src-a", "src-b"]);
  });
});

describe("an unresolved cost is unknown, never zero", () => {
  // The trap __specs/39 names: OpenRouter's /generation endpoint 404s until the
  // record lands, `fetchGeneration` gives up, and the usage row is written with
  // zeros. Handing those zeros to telemetry makes the dashboard report a turn
  // that cost real money as free — and count it as priced, so the average is
  // dragged down too. Caught in production on a live turn with 3 generations.
  it("leaves tokens and cost null when the provider never priced the turn", async () => {
    const { recordUsage } = await import("../services/openrouter-usage.service.js");
    const organizationId = new mongoose.Types.ObjectId();

    // No provider reachable in tests, so every generation lookup gives up.
    const totals = await recordUsage({
      feature: "widget_reply",
      organizationId,
      model: "test/model",
      generationIds: ["gen-a", "gen-b"],
    });

    expect(totals, "a give-up was reported as a resolved zero").toBeNull();

    // The row is still written, deliberately: it exists for reconciliation.
    const { UsageRecord } = await import("../models/index.js");
    const row = await UsageRecord.findOne({ organizationId }).lean();
    expect(row, "the usage row should still be written for reconciliation").toBeTruthy();
    expect(row!.generationIds).toHaveLength(2);
  });

  it("still reports a genuine zero when tokens were actually measured", async () => {
    // A free model really can cost $0. Tokens are the evidence that the
    // provider answered, so a row with tokens is trusted even at zero cost.
    const { recordUsage } = await import("../services/openrouter-usage.service.js");
    const totals = await recordUsage({
      feature: "widget_reply",
      organizationId: new mongoose.Types.ObjectId(),
      model: "test/model",
      promptTokens: 1200,
      completionTokens: 40,
      costUsd: 0,
    });
    expect(totals).toEqual({ promptTokens: 1200, completionTokens: 40, costUsd: 0 });
  });
});

describe("shouldSample", () => {
  it("never samples at 0 and always samples at 1", () => {
    expect(shouldSample(0, () => 0)).toBe(false);
    expect(shouldSample(1, () => 0.999999)).toBe(true);
  });

  it("draws strictly below the rate", () => {
    expect(shouldSample(0.05, () => 0.049)).toBe(true);
    expect(shouldSample(0.05, () => 0.05)).toBe(false);
  });
});

// ============================================================================
// 3. The wiring
// ============================================================================

type Fixture = {
  organizationId: mongoose.Types.ObjectId;
  conversation: HydratedDocument<ConversationDocType>;
};

async function makeTurnFixture(): Promise<Fixture> {
  const org = await Organization.create({ name: "Example", slug: `example-${OID()}` });
  const site = await Website.create({ organizationId: org._id, name: "Example", domain: `${OID()}.test` });
  const agent = await Agent.create({
    organizationId: org._id,
    websiteId: site._id,
    name: "Ada",
    model: "test/model",
    temperature: 0,
  });
  const session = await ContactSession.create({
    organizationId: org._id,
    websiteId: site._id,
    token: OID(),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const conversation = (await Conversation.create({
    threadId: OID(),
    organizationId: org._id,
    websiteId: site._id,
    agentId: agent._id,
    contactSessionId: session._id,
    status: "active",
  })) as unknown as HydratedDocument<ConversationDocType>;
  return { organizationId: org._id as mongoose.Types.ObjectId, conversation };
}

/** The scripted turn: one `search_kb` call, then a grounded reply. */
function scriptSearchTurn(query: string): void {
  agentScript = [
    new AIMessage({
      content: "",
      tool_calls: [{ name: "search_kb", args: { query }, id: "call-1", type: "tool_call" }],
    }),
    new AIMessage("Refunds take 30 days [1]."),
  ];
  agentCalls = 0;
  finalTokens = ["Refunds take 30 days [1]."];
}

const CUSTOMER_MESSAGE = "refund for kidane12g@gmail.com card 4111 1111 1111 1111";

describe("RagTurnMetric wiring", () => {
  const originalRate = env.rag.faithfulnessSampleRate;

  beforeAll(async () => {
    await RagTurnMetric.createIndexes();
  });

  beforeEach(() => {
    searchResult = FIXTURE_HITS;
    judgeCalls = 0;
    judgeDelayMs = 0;
    // Sampling off by default: each test that wants the judge turns it on, so
    // no other assertion is at the mercy of a dice roll.
    env.rag.faithfulnessSampleRate = 0;
    scriptSearchTurn(CUSTOMER_MESSAGE);
  });

  afterEach(() => {
    env.rag.faithfulnessSampleRate = originalRate;
    vi.restoreAllMocks();
  });

  it("writes exactly one metric per turn, joined to the message it scores", async () => {
    const { organizationId, conversation } = await makeTurnFixture();

    await generateAiReplyWithGraph(conversation, CUSTOMER_MESSAGE, null);
    await flushRagTelemetry();

    const metrics = await RagTurnMetric.find({ organizationId }).lean();
    expect(metrics).toHaveLength(1);

    const metric = metrics[0]!;
    const aiMessage = await Message.findOne({ conversationId: conversation._id, role: "ai" }).lean();
    expect(String(metric.messageId)).toBe(String(aiMessage!._id));
    expect(String(metric.conversationId)).toBe(String(conversation._id));
    expect(metric.status).toBe("ok");
    expect(metric.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("carries the real retrieval and generation numbers, not placeholders", async () => {
    const { organizationId, conversation } = await makeTurnFixture();

    await generateAiReplyWithGraph(conversation, CUSTOMER_MESSAGE, null);
    await flushRagTelemetry();

    const metric = (await RagTurnMetric.findOne({ organizationId }).lean())!;
    expect(metric.retrieval!.hitCount).toBe(FIXTURE_HITS.length);
    expect(metric.retrieval!.topScore).toBeCloseTo(0.91, 10);
    expect(metric.retrieval!.searchCount).toBe(1);
    expect(metric.retrieval!.sourceIds).toEqual(["src-a", "src-b"]);
    expect(metric.retrieval!.retrievalConfidence).toBeCloseTo(
      retrievalConfidence(FIXTURE_HITS.map((h) => h.score)),
      6,
    );
    expect(metric.generation!.action).toBe("reply");
    expect(metric.generation!.confidence).toBeCloseTo(0.9, 10);
    expect(metric.generation!.answerLength).toBeGreaterThan(0);
    expect(metric.toolTurns).toBeGreaterThan(0);
    expect(metric.flags!.noHits).toBe(false);
  });

  it("masks the persisted query on a fixture carrying an email and a card", async () => {
    const { organizationId, conversation } = await makeTurnFixture();

    await generateAiReplyWithGraph(conversation, CUSTOMER_MESSAGE, null);
    await flushRagTelemetry();

    const metric = (await RagTurnMetric.findOne({ organizationId }).lean())!;
    expect(metric.originalQuery).toContain("[EMAIL]");
    expect(metric.originalQuery).toContain("[CARD]");
    expect(metric.originalQuery).not.toContain("kidane12g@gmail.com");
    expect(metric.originalQuery).not.toContain("4111");
    expect(JSON.stringify(metric)).not.toContain("kidane12g@gmail.com");
  });

  it("leaves the customer's reply byte-identical when telemetry throws", async () => {
    // Control run, telemetry healthy.
    const control = await makeTurnFixture();
    await generateAiReplyWithGraph(control.conversation, CUSTOMER_MESSAGE, null);
    await flushRagTelemetry();
    const controlMessage = (await Message.findOne({
      conversationId: control.conversation._id,
      role: "ai",
    }).lean())!;

    // Same turn, with the telemetry write throwing on purpose.
    scriptSearchTurn(CUSTOMER_MESSAGE);
    const spy = vi
      .spyOn(RagTurnMetric, "create")
      .mockRejectedValue(new Error("telemetry is on fire") as never);

    const broken = await makeTurnFixture();
    await expect(
      generateAiReplyWithGraph(broken.conversation, CUSTOMER_MESSAGE, null),
    ).resolves.toBeUndefined();
    await flushRagTelemetry();

    const brokenMessage = (await Message.findOne({
      conversationId: broken.conversation._id,
      role: "ai",
    }).lean())!;

    expect(spy).toHaveBeenCalled();
    expect(Buffer.from(brokenMessage.content, "utf8")).toEqual(
      Buffer.from(controlMessage.content, "utf8"),
    );
    expect(brokenMessage.confidence).toBe(controlMessage.confidence);
    expect(JSON.stringify(brokenMessage.sources)).toBe(JSON.stringify(controlMessage.sources));

    // And the failure really did cost the metric, so the assertion above is not
    // passing because the write silently succeeded.
    await expect(RagTurnMetric.countDocuments({ organizationId: broken.organizationId })).resolves.toBe(0);
    const conversationAfter = await Conversation.findById(broken.conversation._id).lean();
    expect(conversationAfter!.status).toBe("active");
  });

  it("records a fallback turn when the graph never produced a state", async () => {
    const { organizationId, conversation } = await makeTurnFixture();
    // No script and no tokens: the meta pass still answers, but the streamed
    // reply is empty, so the turn lands on finalize's own fallback text.
    agentScript = [];
    agentCalls = 0;
    finalTokens = [];
    searchResult = [];

    await generateAiReplyWithGraph(conversation, "hello?", null);
    await flushRagTelemetry();

    const metrics = await RagTurnMetric.find({ organizationId }).lean();
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.flags!.noHits).toBe(true);
    expect(metrics[0]!.retrieval!.retrievalConfidence).toBe(0);
  });
});

// ============================================================================
// 4. Sampled faithfulness stays off the reply path
// ============================================================================

describe("online faithfulness sampling", () => {
  const originalRate = env.rag.faithfulnessSampleRate;

  beforeEach(() => {
    searchResult = FIXTURE_HITS;
    judgeCalls = 0;
    judgeCompleted = 0;
    scriptSearchTurn("refund policy");
  });

  afterEach(() => {
    env.rag.faithfulnessSampleRate = originalRate;
    judgeDelayMs = 0;
  });

  it("adds zero latency to the reply: the judge runs entirely after it returns", async () => {
    // A judge call slow enough that awaiting it anywhere on the reply path would
    // be unmissable in the numbers below.
    const JUDGE_MS = 400;

    // Baseline: the same turn with sampling off.
    env.rag.faithfulnessSampleRate = 0;
    const baseline = await makeTurnFixture();
    const b0 = Date.now();
    await generateAiReplyWithGraph(baseline.conversation, "how long do refunds take?", null);
    const baselineMs = Date.now() - b0;
    await flushRagTelemetry();

    // Same turn, sampled, with a deliberately slow judge.
    scriptSearchTurn("refund policy");
    env.rag.faithfulnessSampleRate = 1;
    judgeDelayMs = JUDGE_MS;

    const { organizationId, conversation } = await makeTurnFixture();

    const t0 = Date.now();
    await generateAiReplyWithGraph(conversation, "how long do refunds take?", null);
    const replyMs = Date.now() - t0;

    // The load-bearing assertion, and deliberately not a wall-clock one: the
    // reply is persisted and emitted while no judge call has finished. If the
    // judge were awaited anywhere on this path, this could not be 0.
    expect(judgeCompleted).toBe(0);
    // The measurement, with a margin only a real regression crosses. An
    // absolute bound here would fail on a loaded CI box for reasons that have
    // nothing to do with the code; a delta against a baseline turn measured on
    // the same machine, moments earlier, cancels that out. Awaiting the judge
    // would add a full JUDGE_MS to this difference.
    expect(replyMs - baselineMs).toBeLessThan(JUDGE_MS);

    await flushRagTelemetry();
    const afterFlushMs = Date.now() - t0;

    expect(judgeCompleted).toBe(1);
    // The judge's cost landed after the reply, not inside it.
    expect(afterFlushMs).toBeGreaterThanOrEqual(JUDGE_MS);

    const metric = (await RagTurnMetric.findOne({ organizationId }).lean())!;
    // Two claims, one supported.
    expect(metric.faithfulness!.sampled).toBe(true);
    expect(metric.faithfulness!.score).toBeCloseTo(0.5, 10);
    expect(metric.faithfulness!.claimCount).toBe(2);
    expect(metric.faithfulness!.unsupported).toHaveLength(1);
    expect(metric.faithfulness!.judgeModel).toBe(env.rag.faithfulnessJudgeModel);
  });

  it("does not call the judge at all when the turn is not drawn", async () => {
    env.rag.faithfulnessSampleRate = 0;
    const { organizationId, conversation } = await makeTurnFixture();

    await generateAiReplyWithGraph(conversation, "how long do refunds take?", null);
    await flushRagTelemetry();

    expect(judgeCalls).toBe(0);
    const metric = (await RagTurnMetric.findOne({ organizationId }).lean())!;
    expect(metric.faithfulness!.sampled).toBe(false);
    expect(metric.faithfulness!.score).toBeNull();
  });

  it("marks a drawn turn with no passages as sampled-but-unscored", async () => {
    env.rag.faithfulnessSampleRate = 1;
    searchResult = [];
    const { organizationId, conversation } = await makeTurnFixture();

    await generateAiReplyWithGraph(conversation, "who founded the company?", null);
    await flushRagTelemetry();

    expect(judgeCalls).toBe(0);
    const metric = (await RagTurnMetric.findOne({ organizationId }).lean())!;
    expect(metric.faithfulness!.sampled).toBe(true);
    expect(metric.faithfulness!.score).toBeNull();
    expect(metric.faithfulness!.skippedReason).toBe("no_passages");
  });
});

// ============================================================================
// 5. Alerts
// ============================================================================

describe("rag quality alerts", () => {
  const seed = async (
    organizationId: mongoose.Types.ObjectId,
    turns: { noHits?: boolean; lowConfidence?: boolean; escalated?: boolean }[],
  ): Promise<void> => {
    const agentId = new mongoose.Types.ObjectId();
    await RagTurnMetric.insertMany(
      turns.map((t) => ({
        organizationId,
        agentId,
        conversationId: new mongoose.Types.ObjectId(),
        messageId: new mongoose.Types.ObjectId(),
        status: "ok",
        durationMs: 100,
        flags: {
          noHits: Boolean(t.noHits),
          lowConfidence: Boolean(t.lowConfidence),
          escalated: Boolean(t.escalated),
          conflicted: false,
        },
      })),
    );
  };

  it("computes the three rates over the window", async () => {
    const organizationId = new mongoose.Types.ObjectId();
    await seed(organizationId, [
      { noHits: true, escalated: true },
      { noHits: true },
      { lowConfidence: true },
      {},
    ]);

    const w = await ragQualityWindow(organizationId.toString(), new Date(Date.now() - 60_000));
    expect(w.turns).toBe(4);
    expect(w.noHitRate).toBeCloseTo(0.5, 10);
    expect(w.lowConfidenceRate).toBeCloseTo(0.25, 10);
    expect(w.escalationRate).toBeCloseTo(0.25, 10);
  });

  it("returns an empty window rather than dividing by zero", async () => {
    const w = await ragQualityWindow(
      new mongoose.Types.ObjectId().toString(),
      new Date(Date.now() - 60_000),
    );
    expect(w).toMatchObject({ turns: 0, noHitRate: 0, lowConfidenceRate: 0, escalationRate: 0 });
  });

  it("stays silent below the turn floor, however bad the rate looks", () => {
    // Three turns of which two missed is not a 67 percent no-hit rate, it is
    // three turns.
    expect(
      alertsForWindow({
        turns: 3,
        noHits: 2,
        lowConfidence: 3,
        escalated: 3,
        noHitRate: 2 / 3,
        lowConfidenceRate: 1,
        escalationRate: 1,
      }),
    ).toEqual([]);
  });

  it("raises each crossed threshold separately, worst first", () => {
    const specs = alertsForWindow({
      turns: 100,
      noHits: 45,
      lowConfidence: 90,
      escalated: 10,
      noHitRate: 0.45,
      lowConfidenceRate: 0.9,
      escalationRate: 0.1,
    });
    expect(specs.map((s) => s.type)).toEqual(["rag_low_confidence_rate", "rag_no_hit_rate"]);
  });
});

// ============================================================================
// 6. Index coverage for the dashboard queries
// ============================================================================

describe("RagTurnMetric indexes", () => {
  const organizationId = new mongoose.Types.ObjectId();
  const agentId = new mongoose.Types.ObjectId();
  const since = new Date(Date.now() - 3_600_000);

  // Seeded per test, not once: the shared setup wipes every collection between
  // tests, and an empty collection makes every plan look fine.
  beforeEach(async () => {
    await RagTurnMetric.createIndexes();
    await RagTurnMetric.insertMany(
      Array.from({ length: 25 }, (_, i) => ({
        organizationId,
        agentId,
        conversationId: new mongoose.Types.ObjectId(),
        messageId: new mongoose.Types.ObjectId(),
        status: "ok",
        durationMs: 100,
        flags: {
          noHits: i % 3 === 0,
          lowConfidence: i % 4 === 0,
          escalated: i % 5 === 0,
          conflicted: false,
        },
        faithfulness: { sampled: i % 10 === 0 },
      })),
    );
  });

  /**
   * The winning plan must scan an index. A COLLSCAN here is the regression.
   *
   * Matched on several stage names because "used an index" is spelled
   * differently depending on the plan: a covered count is a COUNT_SCAN and the
   * slot-based engine writes its index seek as `ixseek`. All three mean the same
   * thing, and only COLLSCAN means the opposite.
   */
  const INDEX_SCAN = /IXSCAN|COUNT_SCAN|ixseek|DISTINCT_SCAN/;

  const expectIndexed = async (plan: unknown): Promise<void> => {
    const json = JSON.stringify(plan);
    expect(json).toMatch(INDEX_SCAN);
    expect(json).not.toContain("COLLSCAN");
  };

  const winningPlanOf = async (q: mongoose.Query<unknown, unknown>): Promise<unknown> => {
    const explained = (await q.explain("queryPlanner")) as {
      queryPlanner?: { winningPlan?: unknown };
    };
    return explained.queryPlanner?.winningPlan;
  };

  it("covers the agent timeline", async () => {
    await expectIndexed(
      await winningPlanOf(RagTurnMetric.find({ organizationId, agentId }).sort({ createdAt: -1 })),
    );
  });

  it("covers the org-wide rolling window", async () => {
    await expectIndexed(
      await winningPlanOf(
        RagTurnMetric.find({ organizationId, createdAt: { $gte: since } }).sort({ createdAt: -1 }),
      ),
    );
  });

  it.each([
    ["flags.noHits"],
    ["flags.lowConfidence"],
    ["flags.escalated"],
    ["flags.conflicted"],
  ])("covers the %s drill-down", async (flag) => {
    await expectIndexed(
      await winningPlanOf(
        RagTurnMetric.find({ organizationId, [flag]: true, createdAt: { $gte: since } }).sort({
          createdAt: -1,
        }),
      ),
    );
  });

  it("covers the sampled-faithfulness rollup", async () => {
    await expectIndexed(
      await winningPlanOf(
        RagTurnMetric.find({
          organizationId,
          "faithfulness.sampled": true,
          createdAt: { $gte: since },
        }).sort({ createdAt: -1 }),
      ),
    );
  });

  it("covers the per-conversation drill-down", async () => {
    const one = await RagTurnMetric.findOne({ organizationId }).lean();
    await expectIndexed(
      await winningPlanOf(
        RagTurnMetric.find({ organizationId, conversationId: one!.conversationId }),
      ),
    );
  });

  it("covers the alert sweep's group-by", async () => {
    const explained = (await RagTurnMetric.aggregate([
      { $match: { organizationId, createdAt: { $gte: since } } },
      { $group: { _id: null, turns: { $sum: 1 } } },
    ]).explain()) as { queryPlanner?: { winningPlan?: unknown } };
    await expectIndexed(explained.queryPlanner?.winningPlan);
  });

  it("declares the retention TTL the security spec requires", async () => {
    const indexes = await RagTurnMetric.collection.indexes();
    const ttl = indexes.find((i) => i.expireAfterSeconds !== undefined);
    expect(ttl).toBeDefined();
    expect(ttl!.expireAfterSeconds).toBe(env.rag.retentionDays * 24 * 60 * 60);
    expect(ttl!.key).toEqual({ createdAt: 1 });
  });
});
