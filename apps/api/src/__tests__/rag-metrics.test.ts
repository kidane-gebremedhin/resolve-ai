// The RAG Quality dashboard's backend (__specs/39 online section, __specs/07).
//
// Four things are pinned down here, and the third and fourth are the ones worth
// having:
//
//   TENANCY      every endpoint, against a second org, with data present on the
//                first. Not "the middleware is applied" — the actual bytes.
//   SHAPE        empty orgs answer with nulls and empty lists, never NaN, never
//                a 500, never a zero standing in for "unknown".
//   INDEXES      asserted from MongoDB's own profiler while the real endpoints
//                run, so it is the shipped pipelines being checked and not a
//                copy of them written in the test.
//   DEFINITIONS  parsed out of __specs/39 and compared word for word, so the
//                tooltip on the page and the definition in the spec cannot
//                drift apart.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import mongoose from "mongoose";
import request from "supertest";
import type { Express } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../test/app.js";
import { createAgent, createOrgWithOwner, type RegisteredOwner } from "../test/factories.js";
import { KnowledgeGap, KnowledgeSource, MessageFeedback, RagTurnMetric } from "../models/index.js";
import { METRIC_DEFINITIONS } from "../services/ai/eval/metric-definitions.js";
import { env } from "../config/env.js";

// Vitest runs with `apps/api` as the working directory (see vitest.config.ts).
const SPEC = path.resolve(process.cwd(), "../../__specs/39-rag-evaluation.md");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type TurnSpec = {
  ranked?: string[];
  cited?: string[];
  topScore?: number | null;
  confidence?: number;
  noHits?: boolean;
  lowConfidence?: boolean;
  escalated?: boolean;
  widened?: boolean;
  costUsd?: number | null;
  durationMs?: number;
  faithfulness?: number | null;
  unsupported?: { claim: string; verdict: string; reason: string }[];
  query?: string;
  daysAgo?: number;
  conversationId?: mongoose.Types.ObjectId;
};

async function seedTurns(
  organizationId: mongoose.Types.ObjectId | string,
  agentId: mongoose.Types.ObjectId | string,
  specs: TurnSpec[],
): Promise<void> {
  const docs = specs.map((t) => {
    const ranked = t.ranked ?? [];
    return {
      organizationId: new mongoose.Types.ObjectId(String(organizationId)),
      agentId: new mongoose.Types.ObjectId(String(agentId)),
      conversationId: t.conversationId ?? new mongoose.Types.ObjectId(),
      messageId: new mongoose.Types.ObjectId(),
      originalQuery: t.query ?? "refund policy",
      rewrittenQuery: t.query ?? "refund policy",
      retrieval: {
        topK: 8,
        minScore: 0.2,
        hitCount: ranked.length,
        topScore: t.topScore === undefined ? 0.8 : t.topScore,
        meanScore: t.topScore === undefined ? 0.8 : t.topScore,
        scoreSpread: 0,
        retrievalConfidence: ranked.length > 0 ? 0.7 : 0,
        widenedOnEmpty: Boolean(t.widened),
        sourceIds: ranked,
        latencyMs: 120,
        searchCount: ranked.length > 0 ? 1 : 1,
      },
      generation: {
        confidence: t.confidence ?? 0.9,
        action: t.escalated ? "escalate" : "reply",
        citationCount: (t.cited ?? []).length,
        citedSourceIds: t.cited ?? [],
        answerLength: 120,
        model: "test/model",
        promptTokens: t.costUsd === null ? null : 1000,
        completionTokens: t.costUsd === null ? null : 100,
        costUsd: t.costUsd === undefined ? 0.01 : t.costUsd,
        latencyMs: 800,
      },
      flags: {
        noHits: t.noHits ?? ranked.length === 0,
        lowConfidence: t.lowConfidence ?? (t.confidence ?? 0.9) < 0.7,
        escalated: Boolean(t.escalated),
        conflicted: false,
      },
      faithfulness: {
        sampled: t.faithfulness !== undefined,
        score: t.faithfulness ?? null,
        claimCount: t.faithfulness !== undefined ? 4 : null,
        unsupported: t.unsupported ?? [],
        judgeModel: t.faithfulness !== undefined ? "test/judge" : null,
        judgedAt: t.faithfulness !== undefined ? new Date() : null,
        skippedReason: null,
      },
      toolTurns: 2,
      status: "ok" as const,
      durationMs: t.durationMs ?? 1000,
      createdAt: new Date(Date.now() - (t.daysAgo ?? 1) * 24 * 60 * 60 * 1000),
    };
  });
  await RagTurnMetric.insertMany(docs);
}

const SRC_A = new mongoose.Types.ObjectId().toString();
const SRC_B = new mongoose.Types.ObjectId().toString();
const SRC_DEAD = new mongoose.Types.ObjectId().toString();

const ENDPOINTS = [
  "/api/v1/rag-metrics/summary",
  "/api/v1/rag-metrics/retrieval",
  "/api/v1/rag-metrics/generation",
  "/api/v1/rag-metrics/cost",
  "/api/v1/rag-metrics/failing-queries",
  "/api/v1/rag-metrics/source-health",
  "/api/v1/rag-metrics/eval-runs",
  "/api/v1/rag-metrics/definitions",
] as const;

describe("rag-metrics API", () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  // -------------------------------------------------------------------------
  // Tenancy
  // -------------------------------------------------------------------------
  describe("org scoping", () => {
    let a: RegisteredOwner;
    let b: RegisteredOwner;
    let agentA: Awaited<ReturnType<typeof createAgent>>;

    beforeEach(async () => {
      a = await createOrgWithOwner(app, { email: `a-${Date.now()}@example.com` });
      b = await createOrgWithOwner(app, { email: `b-${Date.now()}@example.com` });
      agentA = await createAgent({ orgId: a.orgId, name: "AgentA" });
      await seedTurns(a.orgId, String(agentA._id), [
        { ranked: [SRC_A], cited: [SRC_A], faithfulness: 0.9, query: "org A secret question" },
        { ranked: [], noHits: true, query: "org A missing topic" },
      ]);
      await KnowledgeSource.create({
        organizationId: a.orgId,
        agentId: agentA._id,
        type: "text",
        title: "Org A private doc",
        contentHash: `h-${Date.now()}`,
        embeddingStatus: "synced",
        createdBy: new mongoose.Types.ObjectId(),
      });
    });

    it.each(ENDPOINTS)("%s requires authentication", async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(401);
    });

    it("org A sees its own turns", async () => {
      const res = await request(app)
        .get("/api/v1/rag-metrics/summary")
        .set("Authorization", `Bearer ${a.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.current.turns).toBe(2);
    });

    it.each(ENDPOINTS.filter((u) => !u.endsWith("definitions") && !u.endsWith("eval-runs")))(
      "%s returns nothing of org A's to org B",
      async (url) => {
        const res = await request(app)
          .get(url)
          .set("Authorization", `Bearer ${b.accessToken}`);
        expect(res.status).toBe(200);
        // The strongest available assertion, and deliberately not a field-by-field
        // one: no byte of org A's data may appear anywhere in org B's response.
        const body = JSON.stringify(res.body);
        expect(body).not.toContain("org A secret question");
        expect(body).not.toContain("org A missing topic");
        expect(body).not.toContain("Org A private doc");
        expect(body).not.toContain(SRC_A);
        expect(body).not.toContain(String(agentA._id));
        expect(body).not.toContain(String(a.orgId));
      },
    );

    it("org B sees zero turns, not org A's", async () => {
      const res = await request(app)
        .get("/api/v1/rag-metrics/summary")
        .set("Authorization", `Bearer ${b.accessToken}`);
      expect(res.body.current.turns).toBe(0);
      expect(res.body.current.faithfulness).toBeNull();
    });

    it("a client-supplied agentId belonging to another org cannot widen the scope", async () => {
      // The org clause is stamped from the token, so this can only ever
      // intersect to nothing — but that must be by design, not by luck.
      const res = await request(app)
        .get(`/api/v1/rag-metrics/summary?agentId=${String(agentA._id)}`)
        .set("Authorization", `Bearer ${b.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.current.turns).toBe(0);
      expect(JSON.stringify(res.body)).not.toContain(SRC_A);
    });

    it("a client-supplied websiteId belonging to another org cannot widen the scope", async () => {
      const res = await request(app)
        .get(`/api/v1/rag-metrics/failing-queries?websiteId=${new mongoose.Types.ObjectId()}`)
        .set("Authorization", `Bearer ${b.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });

    it("scopes source health to the caller's org", async () => {
      const res = await request(app)
        .get("/api/v1/rag-metrics/source-health")
        .set("Authorization", `Bearer ${b.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.top).toEqual([]);
      expect(res.body.neverRetrieved).toEqual([]);
      expect(res.body.totals.sources).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Empty states
  // -------------------------------------------------------------------------
  describe("an org with zero turns", () => {
    let owner: RegisteredOwner;

    beforeEach(async () => {
      owner = await createOrgWithOwner(app, { email: `empty-${Date.now()}@example.com` });
    });

    const get = async (url: string) =>
      request(app).get(url).set("Authorization", `Bearer ${owner.accessToken}`);

    it("summary answers with nulls, not NaN or zero", async () => {
      const res = await get("/api/v1/rag-metrics/summary");
      expect(res.status).toBe(200);
      expect(res.body.current.turns).toBe(0);
      // Null means "no data", which is a different fact from a rate of 0.
      expect(res.body.current.noHitRate).toBeNull();
      expect(res.body.current.escalationRate).toBeNull();
      expect(res.body.current.costPerConversation).toBeNull();
      expect(res.body.current.p95LatencyMs).toBeNull();
      expect(res.body.deltas.faithfulness).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain("null,\"NaN\"");
    });

    it("retrieval answers with an empty distribution and the live floor", async () => {
      const res = await get("/api/v1/rag-metrics/retrieval");
      expect(res.status).toBe(200);
      expect(res.body.scoredTurns).toBe(0);
      expect(res.body.distribution).toEqual([]);
      expect(res.body.mrr).toBeNull();
      expect(res.body.recallAtK["5"]).toBeNull();
      // The threshold line is config, not data: it renders on an empty chart too.
      expect(res.body.minScoreThreshold).toBe(env.ai.kbSearchMinScore);
    });

    it("generation, cost, failing queries and source health answer empty", async () => {
      const [gen, cost, failing, health] = await Promise.all([
        get("/api/v1/rag-metrics/generation"),
        get("/api/v1/rag-metrics/cost"),
        get("/api/v1/rag-metrics/failing-queries"),
        get("/api/v1/rag-metrics/source-health"),
      ]);
      expect(gen.body.daily).toEqual([]);
      expect(gen.body.unsupportedExamples).toEqual([]);
      expect(gen.body.meanConfidence).toBeNull();
      expect(gen.body.thumbs).toEqual({ up: 0, down: 0, total: 0, helpfulness: null });
      expect(cost.body.daily).toEqual([]);
      expect(cost.body.totals.costUsd).toBe(0);
      expect(cost.body.totals.costPerTurn).toBeNull();
      expect(failing.body.items).toEqual([]);
      expect(health.body.top).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // The numbers themselves
  // -------------------------------------------------------------------------
  describe("metrics", () => {
    let owner: RegisteredOwner;
    let agentId: string;

    const get = async (url: string) =>
      request(app).get(url).set("Authorization", `Bearer ${owner.accessToken}`);

    beforeEach(async () => {
      owner = await createOrgWithOwner(app, { email: `m-${Date.now()}@example.com` });
      const agent = await createAgent({ orgId: owner.orgId, name: "Agent" });
      agentId = String(agent._id);
    });

    it("scores Recall@K, Precision@K and MRR against the cited sources", async () => {
      await seedTurns(owner.orgId, agentId, [
        // Cited source is rank 1 of 1: recall 1, precision@3 = 1/3, rr = 1.
        { ranked: [SRC_A], cited: [SRC_A] },
        // Cited source is rank 2 of 2: recall 1, precision@3 = 1/3, rr = 0.5.
        { ranked: [SRC_B, SRC_A], cited: [SRC_A] },
      ]);

      const res = await get("/api/v1/rag-metrics/retrieval");
      expect(res.status).toBe(200);
      expect(res.body.scoredTurns).toBe(2);
      expect(res.body.recallAtK["3"]).toBeCloseTo(1, 6);
      expect(res.body.precisionAtK["3"]).toBeCloseTo(1 / 3, 6);
      expect(res.body.precisionAtK["5"]).toBeCloseTo(1 / 5, 6);
      // 1.0 and 0.5.
      expect(res.body.mrr).toBeCloseTo(0.75, 6);
    });

    it("excludes turns that cited nothing rather than scoring them zero", async () => {
      await seedTurns(owner.orgId, agentId, [
        { ranked: [SRC_A], cited: [SRC_A] },
        { ranked: [SRC_A], cited: [] },
        { ranked: [], cited: [], noHits: true },
      ]);
      const res = await get("/api/v1/rag-metrics/retrieval");
      // Three turns, one scoreable. Averaging the other two in as zeros would
      // report a recall of 0.33 for a pipeline that found the answer every time
      // it was asked to cite one.
      expect(res.body.totalTurns).toBe(3);
      expect(res.body.scoredTurns).toBe(1);
      expect(res.body.recallAtK["5"]).toBeCloseTo(1, 6);
    });

    it("buckets the score distribution server-side", async () => {
      await seedTurns(owner.orgId, agentId, [
        { ranked: [SRC_A], cited: [SRC_A], topScore: 0.82 },
        { ranked: [SRC_A], cited: [SRC_A], topScore: 0.84 },
        { ranked: [SRC_A], cited: [SRC_A], topScore: 0.11 },
      ]);
      const res = await get("/api/v1/rag-metrics/retrieval");
      const bucket = (from: number) =>
        res.body.distribution.find((b: { from: number }) => Math.abs(b.from - from) < 1e-9);
      expect(bucket(0.8).count).toBe(2);
      expect(bucket(0.1).count).toBe(1);
      // Raw scores never cross the wire — only counts.
      expect(JSON.stringify(res.body)).not.toContain("0.82");
    });

    it("computes rates, cost per conversation and a period-over-period delta", async () => {
      const convo = new mongoose.Types.ObjectId();
      await seedTurns(owner.orgId, agentId, [
        { ranked: [SRC_A], cited: [SRC_A], conversationId: convo, costUsd: 0.02, daysAgo: 1 },
        { ranked: [], noHits: true, escalated: true, conversationId: convo, costUsd: 0.01, daysAgo: 1 },
        // Previous window: 60 days back, outside a 30-day range.
        { ranked: [SRC_A], cited: [SRC_A], costUsd: 0.05, daysAgo: 40 },
      ]);

      const res = await get("/api/v1/rag-metrics/summary?days=30");
      expect(res.body.current.turns).toBe(2);
      expect(res.body.current.noHitRate).toBeCloseTo(0.5, 6);
      expect(res.body.current.escalationRate).toBeCloseTo(0.5, 6);
      // Two turns, ONE conversation: $0.03 per conversation, not per turn.
      expect(res.body.current.costPerConversation).toBeCloseTo(0.03, 6);
      expect(res.body.previous.turns).toBe(1);
      expect(res.body.deltas.noHitRate).toBeCloseTo(0.5, 6);
    });

    it("excludes unpriced turns from cost rather than counting them as free", async () => {
      await seedTurns(owner.orgId, agentId, [
        { ranked: [SRC_A], cited: [SRC_A], costUsd: 0.04 },
        { ranked: [SRC_A], cited: [SRC_A], costUsd: null },
      ]);
      const summary = await get("/api/v1/rag-metrics/summary");
      // One priced conversation, so $0.04 — not $0.02 averaged over both.
      expect(summary.body.current.costPerConversation).toBeCloseTo(0.04, 6);

      const cost = await get("/api/v1/rag-metrics/cost");
      expect(cost.body.totals.pricedTurns).toBe(1);
      expect(cost.body.totals.turns).toBe(2);
      expect(cost.body.totals.pricedShare).toBeCloseTo(0.5, 6);
      expect(cost.body.totals.costPerTurn).toBeCloseTo(0.04, 6);
    });

    it("averages faithfulness over scored samples only", async () => {
      await seedTurns(owner.orgId, agentId, [
        { ranked: [SRC_A], cited: [SRC_A], faithfulness: 1 },
        { ranked: [SRC_A], cited: [SRC_A], faithfulness: 0.5 },
        // Sampled but unscored, and unsampled: neither may average in as a zero.
        { ranked: [SRC_A], cited: [SRC_A], faithfulness: null },
        { ranked: [SRC_A], cited: [SRC_A] },
      ]);
      const res = await get("/api/v1/rag-metrics/generation");
      expect(res.body.faithfulness).toBeCloseTo(0.75, 6);
      expect(res.body.faithfulnessSamples).toBe(2);
    });

    it("returns unsupported claims linked to their conversation", async () => {
      await seedTurns(owner.orgId, agentId, [
        {
          ranked: [SRC_A],
          cited: [SRC_A],
          faithfulness: 0,
          unsupported: [
            { claim: "Refunds are processed within 30 days", verdict: "contradicted", reason: "eligibility window, not processing time" },
          ],
        },
      ]);
      const res = await get("/api/v1/rag-metrics/generation");
      expect(res.body.unsupportedExamples).toHaveLength(1);
      const ex = res.body.unsupportedExamples[0];
      expect(ex.claims[0].verdict).toBe("contradicted");
      expect(ex.conversationId).toMatch(/^[0-9a-f]{24}$/);
    });

    it("reports thumbs from MessageFeedback", async () => {
      await seedTurns(owner.orgId, agentId, [{ ranked: [SRC_A], cited: [SRC_A] }]);
      await MessageFeedback.insertMany(
        (["up", "up", "down"] as const).map((rating) => ({
          messageId: new mongoose.Types.ObjectId(),
          conversationId: new mongoose.Types.ObjectId(),
          organizationId: new mongoose.Types.ObjectId(String(owner.orgId)),
          contactSessionId: new mongoose.Types.ObjectId(),
          rating,
        })),
      );
      const res = await get("/api/v1/rag-metrics/generation");
      expect(res.body.thumbs).toMatchObject({ up: 2, down: 1, total: 3 });
      expect(res.body.thumbs.helpfulness).toBeCloseTo(2 / 3, 6);
    });

    it("ranks failing queries and joins them to a knowledge gap through the mask", async () => {
      await seedTurns(owner.orgId, agentId, [
        { ranked: [], noHits: true, query: "how do I export to [EMAIL]", daysAgo: 1 },
        { ranked: [], noHits: true, query: "how do I export to [EMAIL]", daysAgo: 2 },
        { ranked: [SRC_A], cited: [], confidence: 0.2, lowConfidence: true, query: "seat pricing", daysAgo: 1 },
      ]);
      // The gap side stores the RAW query; the metric side stores it masked.
      // A `$lookup` on the text would miss this join entirely.
      await KnowledgeGap.create({
        organizationId: owner.orgId,
        agentId,
        question: "How do I export?",
        queryUsed: "how do I export to someone@example.com",
        maxKbScore: 0.1,
        occurrenceCount: 2,
      });

      const res = await get("/api/v1/rag-metrics/failing-queries");
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].query).toBe("how do I export to [EMAIL]");
      expect(res.body.items[0].turns).toBe(2);
      expect(res.body.items[0].gap?.question).toBe("How do I export?");
      expect(res.body.items[1].lowConfidence).toBe(1);
    });

    it("credits a source's mean score only for the turns where it ranked first", async () => {
      await seedTurns(owner.orgId, agentId, [
        { ranked: [SRC_A, SRC_B], cited: [SRC_A], topScore: 0.9 },
        { ranked: [SRC_A, SRC_B], cited: [SRC_A], topScore: 0.7 },
        { ranked: [SRC_B], cited: [SRC_B], topScore: 0.4 },
      ]);
      const res = await get("/api/v1/rag-metrics/source-health");
      const a = res.body.top.find((s: { sourceId: string }) => s.sourceId === SRC_A);
      const b = res.body.top.find((s: { sourceId: string }) => s.sourceId === SRC_B);
      expect(a.retrievalCount).toBe(2);
      expect(a.topRankCount).toBe(2);
      expect(a.meanTopScore).toBeCloseTo(0.8, 6);
      // B appeared 3 times but led once: only that turn's score is honestly its own.
      expect(b.retrievalCount).toBe(3);
      expect(b.topRankCount).toBe(1);
      expect(b.meanTopScore).toBeCloseTo(0.4, 6);
    });

    it("lists indexed sources that nothing retrieved, and excludes unindexed ones", async () => {
      await seedTurns(owner.orgId, agentId, [{ ranked: [SRC_A], cited: [SRC_A] }]);
      await KnowledgeSource.insertMany([
        {
          _id: new mongoose.Types.ObjectId(SRC_A),
          organizationId: owner.orgId, agentId, type: "text", title: "Retrieved doc",
          contentHash: "h1", embeddingStatus: "synced", chunkCount: 3,
          createdBy: new mongoose.Types.ObjectId(),
        },
        {
          _id: new mongoose.Types.ObjectId(SRC_DEAD),
          organizationId: owner.orgId, agentId, type: "text", title: "Dead weight doc",
          contentHash: "h2", embeddingStatus: "synced", chunkCount: 9,
          createdBy: new mongoose.Types.ObjectId(),
        },
        {
          organizationId: owner.orgId, agentId, type: "text", title: "Broken ingest doc",
          contentHash: "h3", embeddingStatus: "error", chunkCount: 0,
          createdBy: new mongoose.Types.ObjectId(),
        },
      ]);

      const res = await get("/api/v1/rag-metrics/source-health");
      const titles = res.body.neverRetrieved.map((s: { title: string }) => s.title);
      expect(titles).toContain("Dead weight doc");
      expect(titles).not.toContain("Retrieved doc");
      // A source that never indexed cannot be retrieved. Listing it as dead
      // weight would send the operator to delete content that is fine.
      expect(titles).not.toContain("Broken ingest doc");
      expect(res.body.ingestion.failing).toBeGreaterThanOrEqual(1);
    });

    it("narrows to one agent when asked, and to nothing when the agent is not ours", async () => {
      const other = await createAgent({ orgId: owner.orgId, name: "Other" });
      await seedTurns(owner.orgId, agentId, [{ ranked: [SRC_A], cited: [SRC_A] }]);
      await seedTurns(owner.orgId, String(other._id), [
        { ranked: [SRC_B], cited: [SRC_B] },
        { ranked: [SRC_B], cited: [SRC_B] },
      ]);

      const all = await get("/api/v1/rag-metrics/summary");
      expect(all.body.current.turns).toBe(3);

      const scoped = await get(`/api/v1/rag-metrics/summary?agentId=${String(other._id)}`);
      expect(scoped.body.current.turns).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Eval history
  // -------------------------------------------------------------------------
  describe("eval history", () => {
    let owner: RegisteredOwner;
    const original = env.rag.evalReportsDir;

    beforeEach(async () => {
      owner = await createOrgWithOwner(app, { email: `e-${Date.now()}@example.com` });
    });

    afterAll(() => {
      env.rag.evalReportsDir = original;
    });

    it("reports unavailable rather than 500 when there is no reports directory", async () => {
      env.rag.evalReportsDir = path.join(tmpdir(), `nope-${Date.now()}`);
      const res = await request(app)
        .get("/api/v1/rag-metrics/eval-runs")
        .set("Authorization", `Bearer ${owner.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ available: false, runs: [] });
    });

    it("returns the newest runs first and survives an unreadable report", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "evalreports-"));
      await writeFile(
        path.join(dir, "2026-01-01T00-00-00-000Z.json"),
        JSON.stringify({
          startedAt: "2026-01-01T00:00:00.000Z",
          dataset: "golden",
          summary: { cases: 40, errored: 0, retrieval: { mrr: 0.8 }, generation: { faithfulness: 0.9 } },
        }),
      );
      await writeFile(
        path.join(dir, "2026-02-01T00-00-00-000Z.json"),
        JSON.stringify({
          startedAt: "2026-02-01T00:00:00.000Z",
          dataset: "golden",
          summary: { cases: 45, errored: 1, retrieval: { mrr: 0.6 }, generation: { faithfulness: 0.7 } },
        }),
      );
      await writeFile(path.join(dir, "broken.json"), "{ not json");
      env.rag.evalReportsDir = dir;

      const res = await request(app)
        .get("/api/v1/rag-metrics/eval-runs")
        .set("Authorization", `Bearer ${owner.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.available).toBe(true);
      // Newest first, and the unparseable file is skipped rather than fatal.
      expect(res.body.runs).toHaveLength(2);
      expect(res.body.runs[0].cases).toBe(45);
      expect(res.body.runs[1].cases).toBe(40);
    });
  });

  // -------------------------------------------------------------------------
  // Index coverage, from MongoDB's own profiler
  // -------------------------------------------------------------------------
  describe("index coverage", () => {
    let owner: RegisteredOwner;

    beforeEach(async () => {
      owner = await createOrgWithOwner(app, { email: `idx-${Date.now()}@example.com` });
      const agent = await createAgent({ orgId: owner.orgId, name: "Agent" });
      await RagTurnMetric.createIndexes();
      await seedTurns(
        owner.orgId,
        String(agent._id),
        Array.from({ length: 40 }, (_, i) => ({
          ranked: [SRC_A, SRC_B],
          cited: [SRC_A],
          noHits: i % 4 === 0,
          lowConfidence: i % 5 === 0,
          query: `q-${i % 7}`,
          daysAgo: (i % 20) + 1,
        })),
      );
    });

    it("runs every dashboard aggregation on an index, never a collection scan", async () => {
      const db = mongoose.connection.db!;
      // Profile the REAL endpoints. Explaining a pipeline written in the test
      // would only prove the test's copy is indexed.
      await db.command({ profile: 2 });
      try {
        for (const url of ENDPOINTS) {
          const res = await request(app)
            .get(`${url}?days=30`)
            .set("Authorization", `Bearer ${owner.accessToken}`);
          expect(res.status).toBe(200);
        }
      } finally {
        await db.command({ profile: 0 });
      }

      const profiled = await db
        .collection("system.profile")
        .find({ ns: { $regex: "ragturnmetrics$" }, planSummary: { $exists: true } })
        .toArray();

      // The assertion is worthless if nothing was recorded.
      expect(profiled.length).toBeGreaterThan(0);

      const scans = profiled
        .filter((p) => String(p.planSummary).includes("COLLSCAN"))
        .map((p) => ({ plan: String(p.planSummary), command: JSON.stringify(p.command).slice(0, 400) }));

      expect(scans, `collection scans:\n${scans.map((s) => s.command).join("\n")}`).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Definitions match the spec, word for word
  // -------------------------------------------------------------------------
  describe("metric definitions", () => {
    /**
     * Every `| Metric | Definition | ...` table on the spec page, as a map from
     * metric name to its definition and note, with markdown emphasis and code
     * ticks stripped so the comparison is about words rather than formatting.
     */
    function parseSpecTables(): Map<string, { definition: string; note: string }> {
      const clean = (cell: string) =>
        cell.replace(/[*`]/g, "").replace(/\s+/g, " ").trim();

      const out = new Map<string, { definition: string; note: string }>();
      const lines = readFileSync(SPEC, "utf8").split("\n");
      let inTable = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("|")) {
          inTable = false;
          continue;
        }
        const cells = trimmed.slice(1, trimmed.endsWith("|") ? -1 : undefined).split("|");
        const first = clean(cells[0] ?? "");
        const second = clean(cells[1] ?? "");

        if (first === "Metric" && second === "Definition") {
          inTable = true;
          continue;
        }
        if (!inTable) continue;
        if (/^-+$/.test(first.replace(/\s/g, ""))) continue; // separator row

        out.set(first, { definition: second, note: clean(cells[2] ?? "") });
      }
      return out;
    }

    const spec = parseSpecTables();

    it("finds the spec's metric tables at all", () => {
      // A parser that silently matches nothing would make every test below pass.
      expect(spec.size).toBeGreaterThan(15);
      expect(spec.get("Precision@K")?.definition).toBe(
        "Relevant results in the top K, divided by K",
      );
    });

    it.each(Object.entries(METRIC_DEFINITIONS))(
      "%s matches __specs/39 word for word",
      (_key, def) => {
        const row = spec.get(def.spec);
        expect(row, `no "${def.spec}" row in __specs/39-rag-evaluation.md`).toBeDefined();
        expect(def.definition).toBe(row!.definition);
        if (def.note) expect(def.note).toBe(row!.note);
      },
    );

    it("serves the same definitions the page renders", async () => {
      const owner = await createOrgWithOwner(app, { email: `d-${Date.now()}@example.com` });
      const res = await request(app)
        .get("/api/v1/rag-metrics/definitions")
        .set("Authorization", `Bearer ${owner.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.definitions.precisionAtK.definition).toBe(
        METRIC_DEFINITIONS.precisionAtK!.definition,
      );
      // Every tile key the page can render has a definition to render with it.
      for (const key of Object.keys(METRIC_DEFINITIONS)) {
        expect(res.body.definitions[key]?.definition).toBeTruthy();
      }
    });
  });
});
