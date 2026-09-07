// Index health: finding weak parts of the index, and repairing them safely.
//
// The two assertions worth the most here are the ones that cannot be satisfied
// by reading the code:
//
//   ISOLATION    a targeted reindex is verified by RECORDING every vector
//                operation it performs and checking whose ids they carry, not
//                by inspecting the query that produced them.
//   SAFETY       the automated path is verified by running it against content
//                and comparing the content before and after, and by actively
//                TRYING to delete without a review token.

import mongoose from "mongoose";
import request from "supertest";
import type { Express } from "express";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// --- recording Pinecone stub -------------------------------------------------
//
// Every upsert and delete is captured so a reindex can be checked by counting
// what it touched.
type VectorOp = { op: "upsert" | "delete"; ids: string[] };
const vectorOps: VectorOp[] = [];

vi.mock("../config/pinecone.js", () => ({
  getPineconeIndex: () => ({
    upsert: async (vectors: { id: string }[]) => {
      vectorOps.push({ op: "upsert", ids: vectors.map((v) => v.id) });
    },
    deleteMany: async (ids: string[]) => {
      vectorOps.push({ op: "delete", ids: [...ids] });
    },
    query: async () => ({ matches: [] }),
  }),
}));

// The embedding provider, stubbed.
//
// `config/env.ts` pulls in `dotenv/config`, so the project's real
// `EMBEDDING_API_KEY` is present under vitest and `embed()` would make a live
// network call — which makes a test about VECTOR ISOLATION depend on a third
// party having credits. Deterministic vectors here; the clustering tests inject
// their own embedder separately.
vi.mock("../services/ai/embedding.service.js", () => ({
  embed: async (texts: string[]): Promise<number[][]> =>
    texts.map((t, i) => {
      const v = new Array(8).fill(0);
      v[i % 8] = 1;
      v[(t.length + 1) % 8] += 0.5;
      return v;
    }),
}));

import { createApp } from "../test/app.js";
import { createAgent, createOrgWithOwner, grantPlan, type RegisteredOwner } from "../test/factories.js";
import {
  KbChunk,
  KnowledgeGap,
  KnowledgeSource,
  MessageFeedback,
  RagTurnMetric,
} from "../models/index.js";
import {
  clusterByEmbedding,
  clusterGaps,
  cosine,
  flagChunk,
  rankClusters,
  scoreChunks,
  CHUNK_SCAN_LIMIT,
  type ChunkStats,
} from "../services/kb/index-health.service.js";
import { findDriftedSources, indexHealthOnce, isOffPeak } from "../jobs/index-health.job.js";
import { hashContent } from "../services/kb/ingestion.service.js";
import { env } from "../config/env.js";

// --- helpers -----------------------------------------------------------------

const OID = () => new mongoose.Types.ObjectId();

function stats(over: Partial<ChunkStats> = {}): ChunkStats {
  return {
    chunkId: "c:0",
    sourceId: "s",
    retrievals: 10,
    meanRank: 0,
    meanScore: 0.8,
    meanRerankScore: null,
    citedCount: 8,
    citationRate: 0.8,
    escalatedCount: 0,
    escalationRate: 0,
    thumbsUp: 5,
    thumbsDown: 0,
    downvoteRate: 0,
    lastRetrieved: new Date(),
    ...over,
  };
}

async function seedSource(args: {
  orgId: string;
  agentId: mongoose.Types.ObjectId;
  title: string;
  text: string;
  chunks?: number;
  hash?: string;
}): Promise<mongoose.Types.ObjectId> {
  const chunkCount = args.chunks ?? 2;
  const source = await KnowledgeSource.create({
    organizationId: args.orgId,
    agentId: args.agentId,
    type: "text",
    title: args.title,
    content: args.text,
    extractedText: args.text,
    contentHash: args.hash ?? hashContent(args.text),
    embeddingStatus: "synced",
    chunkCount,
    pineconeIds: Array.from({ length: chunkCount }, (_, i) => `${String(args.title)}-placeholder:${i}`),
    createdBy: OID(),
    version: 1,
  });
  const id = source._id as mongoose.Types.ObjectId;
  await KnowledgeSource.updateOne(
    { _id: id },
    { $set: { pineconeIds: Array.from({ length: chunkCount }, (_, i) => `${id.toString()}:${i}`) } },
  );
  await KbChunk.insertMany(
    Array.from({ length: chunkCount }, (_, i) => ({
      organizationId: args.orgId,
      agentId: args.agentId,
      sourceId: id,
      chunkIndex: i,
      chunkId: `${id.toString()}:${i}`,
      text: `${args.text} — passage ${i}`,
      headingPath: [],
    })),
  );
  return id;
}

/** One turn of telemetry with explicit per-chunk records. */
async function seedTurn(args: {
  orgId: string;
  agentId: mongoose.Types.ObjectId;
  chunks: { chunkId: string; sourceId: string; rank: number; score: number; cited: boolean }[];
  escalated?: boolean;
  noHits?: boolean;
  query?: string;
  messageId?: mongoose.Types.ObjectId;
}): Promise<mongoose.Types.ObjectId> {
  const messageId = args.messageId ?? OID();
  await RagTurnMetric.create({
    organizationId: args.orgId,
    agentId: args.agentId,
    conversationId: OID(),
    messageId,
    originalQuery: args.query ?? "a question",
    retrieval: {
      hitCount: args.chunks.length,
      topScore: args.chunks[0]?.score ?? null,
      sourceIds: [...new Set(args.chunks.map((c) => c.sourceId))],
      chunks: args.chunks.map((c) => ({ ...c, rerankScore: null })),
      searchCount: 1,
    },
    generation: {
      confidence: 0.9,
      action: args.escalated ? "escalate" : "reply",
      citationCount: args.chunks.filter((c) => c.cited).length,
    },
    flags: {
      noHits: args.noHits ?? args.chunks.length === 0,
      lowConfidence: false,
      escalated: Boolean(args.escalated),
      conflicted: false,
    },
    status: "ok",
    durationMs: 900,
  });
  return messageId;
}

describe("index health", () => {
  let app: Express;
  let owner: RegisteredOwner;
  let agentId: mongoose.Types.ObjectId;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(async () => {
    vectorOps.length = 0;
    owner = await createOrgWithOwner(app, { email: `ih-${Date.now()}-${Math.random()}@example.com` });
    const agent = await createAgent({ orgId: owner.orgId, name: "Agent" });
    agentId = agent._id as mongoose.Types.ObjectId;
  });

  const auth = () => `Bearer ${owner.accessToken}`;

  // =========================================================================
  // 1. Weak chunk detection — one test per flag
  // =========================================================================

  describe("flagChunk", () => {
    it("flags a never-retrieved chunk as dead weight and says nothing else about it", () => {
      const flags = flagChunk(stats({ retrievals: 0, citedCount: 0, citationRate: null, meanScore: null }));
      expect(flags).toEqual(["dead_weight"]);
    });

    it("flags a downvoted, frequently-cited chunk as misleading", () => {
      expect(
        flagChunk(stats({ retrievals: 20, thumbsUp: 2, thumbsDown: 8, downvoteRate: 0.8 })),
      ).toContain("misleading");
    });

    it("flags a high-scoring chunk the model never quotes", () => {
      expect(
        flagChunk(stats({ retrievals: 20, citedCount: 1, citationRate: 0.05, meanScore: 0.82 })),
      ).toContain("retrieved_not_cited");
    });

    it("does not call a weak-scoring uncited chunk a chunking problem", () => {
      // It scraped into the prompt on a thin query and was ignored, which is
      // the system working, not a defect in the passage.
      expect(
        flagChunk(stats({ retrievals: 20, citedCount: 0, citationRate: 0, meanScore: 0.21 })),
      ).toEqual([]);
    });

    it("holds every rate behind a volume floor", () => {
      // One downvote out of two retrievals is not an 50 percent downvote rate.
      expect(
        flagChunk(stats({ retrievals: 2, thumbsUp: 0, thumbsDown: 1, downvoteRate: 1 })),
      ).toEqual([]);
    });

    it("reports both problems when a chunk has both", () => {
      const flags = flagChunk(
        stats({
          retrievals: 30,
          citedCount: 2,
          citationRate: 0.066,
          meanScore: 0.7,
          thumbsUp: 0,
          thumbsDown: 2,
          downvoteRate: 1,
        }),
      );
      expect(flags).toEqual(expect.arrayContaining(["misleading", "retrieved_not_cited"]));
    });

    it("prefers the calibrated rerank score over the raw one when it exists", () => {
      // Raw cosine says "weak", the cross-encoder says "this answers it". The
      // calibrated number is the one that is comparable across queries.
      expect(
        flagChunk(
          stats({ retrievals: 20, citedCount: 0, citationRate: 0, meanScore: 0.1, meanRerankScore: 0.9 }),
        ),
      ).toContain("retrieved_not_cited");
    });

    it("treats no thumbs at all as unknown rather than as approval", () => {
      expect(
        flagChunk(stats({ retrievals: 50, thumbsUp: 0, thumbsDown: 0, downvoteRate: null })),
      ).not.toContain("misleading");
    });
  });

  describe("scoreChunks against seeded telemetry", () => {
    it("produces all three flag types from one seeded corpus", async () => {
      const good = await seedSource({ orgId: owner.orgId, agentId, title: "Refunds", text: "refund policy", chunks: 1 });
      const bad = await seedSource({ orgId: owner.orgId, agentId, title: "Old pricing", text: "2019 pricing", chunks: 1 });
      const ignored = await seedSource({ orgId: owner.orgId, agentId, title: "Split badly", text: "half a sentence", chunks: 1 });
      await seedSource({ orgId: owner.orgId, agentId, title: "Never asked about", text: "partner handbook", chunks: 1 });

      const badChunk = `${bad.toString()}:0`;
      const ignoredChunk = `${ignored.toString()}:0`;
      const goodChunk = `${good.toString()}:0`;

      // The misleading one: cited every time, and the answers get thumbed down.
      for (let i = 0; i < 8; i++) {
        const messageId = await seedTurn({
          orgId: owner.orgId,
          agentId,
          chunks: [{ chunkId: badChunk, sourceId: bad.toString(), rank: 0, score: 0.8, cited: true }],
        });
        await MessageFeedback.create({
          messageId,
          conversationId: OID(),
          organizationId: new mongoose.Types.ObjectId(owner.orgId),
          contactSessionId: OID(),
          rating: "down",
        });
      }

      // The ignored one: retrieved with a strong score, never quoted.
      for (let i = 0; i < 8; i++) {
        await seedTurn({
          orgId: owner.orgId,
          agentId,
          chunks: [
            { chunkId: ignoredChunk, sourceId: ignored.toString(), rank: 0, score: 0.75, cited: false },
            { chunkId: goodChunk, sourceId: good.toString(), rank: 1, score: 0.7, cited: true },
          ],
        });
      }

      const report = await scoreChunks({ organizationId: owner.orgId, agentId: agentId.toString() });

      expect(report.totals.chunks).toBe(4);
      expect(report.totals.retrieved).toBe(3);
      expect(report.totals.misleading).toBe(1);
      expect(report.totals.retrievedNotCited).toBe(1);
      expect(report.totals.deadWeight).toBe(1);

      const byId = new Map(report.chunks.map((c) => [c.chunkId, c]));
      expect(byId.get(badChunk)!.flags).toContain("misleading");
      expect(byId.get(badChunk)!.downvoteRate).toBe(1);
      expect(byId.get(ignoredChunk)!.flags).toContain("retrieved_not_cited");
      expect(byId.get(ignoredChunk)!.citationRate).toBe(0);
      // The healthy one earns no flag and is left out of the report entirely.
      expect(byId.has(goodChunk)).toBe(false);
      // Worst first: the misleading passage outranks the ignored one.
      expect(report.chunks[0]!.chunkId).toBe(badChunk);
    });

    it("reports a complete scan as complete", async () => {
      const report = await scoreChunks({ organizationId: owner.orgId, agentId: agentId.toString() });
      expect(report.totals.truncated).toBe(false);
      expect(report.totals.scanLimit).toBe(CHUNK_SCAN_LIMIT);
    });

    it("says so when the index is larger than one scan", async () => {
      // Dead weight is defined by the ABSENCE of telemetry, so the scan has to
      // list every chunk and therefore needs a cap. The cap was silent: an org
      // past it was told it had exactly CHUNK_SCAN_LIMIT chunks, with a
      // dead-weight count computed from an arbitrary slice and nothing marking
      // either number as partial.
      const oversized = Array.from({ length: CHUNK_SCAN_LIMIT + 1 }, (_, i) => ({
        chunkId: `over:${i}`,
        sourceId: new mongoose.Types.ObjectId(),
      }));
      // Only the index scan is faked. withPreviews issues its own KbChunk.find
      // for the flagged rows and must keep hitting the real collection.
      const real = KbChunk.find.bind(KbChunk) as (...args: unknown[]) => unknown;
      const fake = (...args: unknown[]) => {
        const proj = args[1] as Record<string, number> | undefined;
        if (proj && proj.sourceId === 1 && proj.text === undefined) {
          return { limit: () => ({ lean: async () => oversized }) };
        }
        return real(...args);
      };
      const spy = vi
        .spyOn(KbChunk, "find")
        .mockImplementation(fake as unknown as typeof KbChunk.find);
      try {
        const report = await scoreChunks({ organizationId: owner.orgId, agentId: agentId.toString() });
        expect(report.totals.truncated).toBe(true);
        expect(report.totals.scanLimit).toBe(CHUNK_SCAN_LIMIT);
        // The probe row must not leak into the counts.
        expect(report.totals.chunks).toBe(CHUNK_SCAN_LIMIT);
      } finally {
        spy.mockRestore();
      }
    });

    it("attributes a downvote only to the chunk the answer actually cited", async () => {
      const cited = await seedSource({ orgId: owner.orgId, agentId, title: "Cited", text: "cited text", chunks: 1 });
      const alsoRetrieved = await seedSource({ orgId: owner.orgId, agentId, title: "Context", text: "context text", chunks: 1 });

      for (let i = 0; i < 6; i++) {
        const messageId = await seedTurn({
          orgId: owner.orgId,
          agentId,
          chunks: [
            { chunkId: `${cited.toString()}:0`, sourceId: cited.toString(), rank: 0, score: 0.8, cited: true },
            { chunkId: `${alsoRetrieved.toString()}:0`, sourceId: alsoRetrieved.toString(), rank: 1, score: 0.6, cited: false },
          ],
        });
        await MessageFeedback.create({
          messageId,
          conversationId: OID(),
          organizationId: new mongoose.Types.ObjectId(owner.orgId),
          contactSessionId: OID(),
          rating: "down",
        });
      }

      const report = await scoreChunks({ organizationId: owner.orgId, agentId: agentId.toString(), limit: 500 });
      const flaggedIds = report.chunks.filter((c) => c.flags.includes("misleading")).map((c) => c.chunkId);
      expect(flaggedIds).toEqual([`${cited.toString()}:0`]);
    });

    it("returns a preview for the chunks it reports, without scanning text for all of them", async () => {
      // The preview is fetched for the returned page only. Carrying `text`
      // through the full index scan would size a dashboard request by the
      // customer's corpus rather than by the page.
      const bad = await seedSource({ orgId: owner.orgId, agentId, title: "Bad", text: "a misleading passage", chunks: 1 });
      const badChunk = `${bad.toString()}:0`;
      for (let i = 0; i < 8; i++) {
        const messageId = await seedTurn({
          orgId: owner.orgId,
          agentId,
          chunks: [{ chunkId: badChunk, sourceId: bad.toString(), rank: 0, score: 0.8, cited: true }],
        });
        await MessageFeedback.create({
          messageId,
          conversationId: OID(),
          organizationId: new mongoose.Types.ObjectId(owner.orgId),
          contactSessionId: OID(),
          rating: "down",
        });
      }

      const report = await scoreChunks({ organizationId: owner.orgId, agentId: agentId.toString() });
      const flagged = report.chunks.find((c) => c.chunkId === badChunk);
      expect(flagged).toBeDefined();
      expect(flagged!.preview).toContain("a misleading passage");
    });

    it("scopes to the caller's org", async () => {
      const other = await createOrgWithOwner(app, { email: `other-${Date.now()}@example.com` });
      const otherAgent = await createAgent({ orgId: other.orgId, name: "Other" });
      await seedSource({
        orgId: other.orgId,
        agentId: otherAgent._id as mongoose.Types.ObjectId,
        title: "Other org secret doc",
        text: "secret",
      });

      const res = await request(app).get("/api/v1/index-health/chunks").set("Authorization", auth());
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain("Other org secret doc");
      expect(res.body.totals.chunks).toBe(0);
    });
  });

  // =========================================================================
  // 2. Gap clustering
  // =========================================================================

  describe("clusterByEmbedding", () => {
    it("keeps vectors below the threshold apart and merges those above it", () => {
      const items = [
        { id: "a", text: "a", weight: 3, embedding: [1, 0, 0] },
        { id: "b", text: "b", weight: 2, embedding: [0.98, 0.2, 0] },
        { id: "c", text: "c", weight: 1, embedding: [0, 1, 0] },
      ];
      const clusters = clusterByEmbedding(items, 0.9);
      expect(clusters).toHaveLength(2);
      expect(clusters[0]!.members.map((m) => m.id).sort()).toEqual(["a", "b"]);
      expect(clusters[0]!.volume).toBe(5);
    });

    it("labels a cluster with its highest-weight member, not its first", () => {
      const clusters = clusterByEmbedding(
        [
          { id: "small", text: "rare phrasing", weight: 1, embedding: [1, 0] },
          { id: "big", text: "the common phrasing", weight: 50, embedding: [1, 0.01] },
        ],
        0.9,
      );
      expect(clusters).toHaveLength(1);
      expect(clusters[0]!.label).toBe("the common phrasing");
    });

    it("is deterministic regardless of input order", () => {
      const items = [
        { id: "a", text: "a", weight: 5, embedding: [1, 0, 0] },
        { id: "b", text: "b", weight: 4, embedding: [0.99, 0.1, 0] },
        { id: "c", text: "c", weight: 3, embedding: [0, 0, 1] },
      ];
      const forward = clusterByEmbedding(items, 0.9).map((c) => c.label);
      const backward = clusterByEmbedding([...items].reverse(), 0.9).map((c) => c.label);
      expect(forward).toEqual(backward);
    });

    it("cosine handles a zero vector without producing NaN", () => {
      expect(cosine([0, 0], [1, 1])).toBe(0);
    });
  });

  describe("clusterGaps", () => {
    /**
     * A stand-in embedder that places paraphrases of one topic close together.
     *
     * The unit under test is the CLUSTERING, not the embedding model. Injecting
     * this keeps the test from silently becoming an assertion about
     * `text-embedding-3-small`, and lets it run with no API key — the real
     * `embed()` falls back to a hash-based pseudo-embedding in that case, under
     * which paraphrases are orthogonal and nothing would ever cluster.
     */
    const topicEmbedder = async (texts: string[]): Promise<number[][]> =>
      texts.map((t) => {
        const eu = /eu|europe|european/i.test(t) && /refund/i.test(t);
        const base = eu ? [1, 0, 0] : /password|login/i.test(t) ? [0, 1, 0] : [0, 0, 1];
        // Deterministic jitter, so members are near but not identical.
        const jitter = (t.length % 7) / 100;
        return base.map((v, i) => v + (i === 0 ? jitter : jitter / 3));
      });

    it("collapses 23 paraphrases of one question into a single cluster", async () => {
      const paraphrases = [
        "how long do EU refunds take",
        "eu refund timeline",
        "when will my european refund arrive",
        "refund processing time in europe",
        "how many days for an EU refund",
        "european refund how long",
        "time to get refund in EU",
        "eu customers refund duration",
        "refund wait time europe",
        "how long until refund eu",
        "european union refund timeline",
        "refund speed for EU orders",
        "eu refund how many business days",
        "when do EU refunds clear",
        "duration of refund in european union",
        "eu refunds processing duration",
        "how quickly are european refunds paid",
        "refund turnaround eu",
        "eu order refund timing",
        "european refund processing window",
        "how long for a refund in the EU",
        "eu refund arrival time",
        "refund timeline for european customers",
      ];
      expect(paraphrases).toHaveLength(23);

      await KnowledgeGap.insertMany(
        paraphrases.map((q, i) => ({
          organizationId: owner.orgId,
          agentId,
          question: q,
          queryUsed: q,
          maxKbScore: 0.1,
          occurrenceCount: i === 0 ? 9 : 1,
          status: "open",
          kind: "gap",
        })),
      );
      // A genuinely different topic must survive as its own cluster.
      await KnowledgeGap.create({
        organizationId: owner.orgId,
        agentId,
        question: "how do I reset my password",
        queryUsed: "how do I reset my password",
        maxKbScore: 0.1,
        occurrenceCount: 4,
        status: "open",
        kind: "gap",
      });

      const clusters = await clusterGaps(
        { organizationId: owner.orgId, agentId: agentId.toString(), threshold: 0.9 },
        { embed: topicEmbedder },
      );

      expect(clusters).toHaveLength(2);
      const eu = clusters.find((c) => c.queries.length === 23);
      expect(eu, "the 23 paraphrases did not collapse into one cluster").toBeDefined();
      expect(eu!.volume).toBe(9 + 22);
      expect(eu!.label).toBe("how long do EU refunds take");
      // Ranked above the smaller topic.
      expect(clusters[0]!.queries).toHaveLength(23);
    });

    it("caches the embedding on the gap so a second call embeds nothing", async () => {
      await KnowledgeGap.create({
        organizationId: owner.orgId,
        agentId,
        question: "eu refund timeline",
        queryUsed: "eu refund timeline",
        maxKbScore: 0.1,
        occurrenceCount: 3,
        status: "open",
        kind: "gap",
      });

      const spy = vi.fn(topicEmbedder);
      await clusterGaps({ organizationId: owner.orgId, threshold: 0.9 }, { embed: spy });
      expect(spy).toHaveBeenCalledTimes(1);

      await clusterGaps({ organizationId: owner.orgId, threshold: 0.9 }, { embed: spy });
      // The page will be reloaded. Re-embedding every open gap each time is a
      // cost that grows with the thing the page exists to reduce.
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("ranks by volume scaled by escalation, so a handful of escalations cannot outrank real volume", () => {
      const ranked = rankClusters([
        { id: "a", label: "small but escalating", volume: 3, queries: [], escalationRate: 1, impact: 3 * 2 },
        { id: "b", label: "large and handled", volume: 40, queries: [], escalationRate: 0, impact: 40 },
        { id: "c", label: "large and escalating", volume: 40, queries: [], escalationRate: 0.5, impact: 60 },
      ]);
      expect(ranked.map((c) => c.label)).toEqual([
        "large and escalating",
        "large and handled",
        "small but escalating",
      ]);
    });

    it("returns an empty list for an org with no open gaps", async () => {
      const res = await request(app).get("/api/v1/index-health/gap-clusters").set("Authorization", auth());
      expect(res.status).toBe(200);
      expect(res.body.clusters).toEqual([]);
    });
  });

  // =========================================================================
  // 3. Targeted reindex — asserted by counting what changed
  // =========================================================================

  describe("targeted reindex", () => {
    it("touches only the intended source's vectors", async () => {
      const target = await seedSource({
        orgId: owner.orgId,
        agentId,
        title: "Target",
        text: "the document being repaired",
        chunks: 3,
      });
      const bystander = await seedSource({
        orgId: owner.orgId,
        agentId,
        title: "Bystander",
        text: "a document nobody asked to touch",
        chunks: 4,
      });

      const bystanderBefore = await KnowledgeSource.findById(bystander).lean();
      const bystanderChunksBefore = await KbChunk.find({ sourceId: bystander }).sort({ chunkIndex: 1 }).lean();

      vectorOps.length = 0;
      const res = await request(app)
        .post(`/api/v1/index-health/sources/${target.toString()}/reindex`)
        .set("Authorization", auth());
      expect(res.status).toBe(202);

      // The reindex is fire-and-forget; wait for it to settle.
      await vi.waitFor(
        async () => {
          const s = await KnowledgeSource.findById(target).lean();
          expect(`${s?.embeddingStatus} ${s?.embeddingError ?? ""}`.trim()).toBe("synced");
        },
        { timeout: 15000, interval: 100 },
      );

      // ---- Count what changed, rather than reading the query that changed it.
      const touched = vectorOps.flatMap((o) => o.ids);
      expect(touched.length).toBeGreaterThan(0);
      const foreign = touched.filter((id) => !id.startsWith(`${target.toString()}:`));
      expect(foreign, `these vector ids do not belong to the target: ${foreign.join(", ")}`).toEqual([]);

      // The bystander's row, its vector ids and every one of its chunks are
      // byte-identical.
      const bystanderAfter = await KnowledgeSource.findById(bystander).lean();
      expect(bystanderAfter!.pineconeIds).toEqual(bystanderBefore!.pineconeIds);
      expect(bystanderAfter!.chunkCount).toBe(bystanderBefore!.chunkCount);
      expect(bystanderAfter!.contentHash).toBe(bystanderBefore!.contentHash);

      const bystanderChunksAfter = await KbChunk.find({ sourceId: bystander }).sort({ chunkIndex: 1 }).lean();
      expect(bystanderChunksAfter).toHaveLength(bystanderChunksBefore.length);
      expect(bystanderChunksAfter.map((c) => c.chunkId)).toEqual(bystanderChunksBefore.map((c) => c.chunkId));
      expect(bystanderChunksAfter.map((c) => String(c.updatedAt))).toEqual(
        bystanderChunksBefore.map((c) => String(c.updatedAt)),
      );
    });

    it("404s for a source belonging to another org", async () => {
      const other = await createOrgWithOwner(app, { email: `x-${Date.now()}@example.com` });
      const otherAgent = await createAgent({ orgId: other.orgId, name: "Other" });
      const foreign = await seedSource({
        orgId: other.orgId,
        agentId: otherAgent._id as mongoose.Types.ObjectId,
        title: "Not yours",
        text: "nope",
      });

      vectorOps.length = 0;
      const res = await request(app)
        .post(`/api/v1/index-health/sources/${foreign.toString()}/reindex`)
        .set("Authorization", auth());
      expect(res.status).toBe(404);
      expect(vectorOps).toEqual([]);
    });
  });

  // =========================================================================
  // 4. Nothing destructive happens without confirmation
  // =========================================================================

  describe("deletion requires a review step", () => {
    async function twoDeadSources(): Promise<string[]> {
      const a = await seedSource({ orgId: owner.orgId, agentId, title: "Dead A", text: "unused a" });
      const b = await seedSource({ orgId: owner.orgId, agentId, title: "Dead B", text: "unused b" });
      return [a.toString(), b.toString()];
    }

    it("refuses a delete with no review token", async () => {
      const ids = await twoDeadSources();
      const res = await request(app)
        .post("/api/v1/index-health/sources/bulk-delete")
        .set("Authorization", auth())
        .send({ sourceIds: ids, confirm: true });
      expect(res.status).toBe(400);
      await expect(KnowledgeSource.countDocuments({ organizationId: owner.orgId })).resolves.toBe(2);
    });

    it("refuses a delete with confirm omitted, even holding a valid token", async () => {
      const ids = await twoDeadSources();
      const preview = await request(app)
        .post("/api/v1/index-health/sources/bulk-delete/preview")
        .set("Authorization", auth());
      expect(preview.status).toBe(200);

      const res = await request(app)
        .post("/api/v1/index-health/sources/bulk-delete")
        .set("Authorization", auth())
        .send({ sourceIds: ids, token: preview.body.token });
      expect(res.status).toBe(400);
      await expect(KnowledgeSource.countDocuments({ organizationId: owner.orgId })).resolves.toBe(2);
    });

    it("refuses a token issued for a DIFFERENT set of sources", async () => {
      const ids = await twoDeadSources();
      const preview = await request(app)
        .post("/api/v1/index-health/sources/bulk-delete/preview")
        .set("Authorization", auth());

      // The operator reviewed two sources and then tried to delete one of them.
      // That is a different claim, and the token does not cover it.
      const res = await request(app)
        .post("/api/v1/index-health/sources/bulk-delete")
        .set("Authorization", auth())
        .send({ sourceIds: [ids[0]!], token: preview.body.token, confirm: true });
      expect(res.status).toBe(400);
      await expect(KnowledgeSource.countDocuments({ organizationId: owner.orgId })).resolves.toBe(2);
    });

    it("refuses a forged token", async () => {
      const ids = await twoDeadSources();
      const res = await request(app)
        .post("/api/v1/index-health/sources/bulk-delete")
        .set("Authorization", auth())
        .send({ sourceIds: ids, token: `${Date.now()}.${"0".repeat(64)}`, confirm: true });
      expect(res.status).toBe(400);
      await expect(KnowledgeSource.countDocuments({ organizationId: owner.orgId })).resolves.toBe(2);
    });

    it("refuses to delete a source that started being retrieved after the review", async () => {
      const ids = await twoDeadSources();
      const preview = await request(app)
        .post("/api/v1/index-health/sources/bulk-delete/preview")
        .set("Authorization", auth());
      expect(preview.body.sources).toHaveLength(2);

      // Between the review and the confirm, a customer question retrieved it.
      // The token is a receipt for a review, not a licence to delete something
      // that has since stopped being dead.
      await seedTurn({
        orgId: owner.orgId,
        agentId,
        chunks: [{ chunkId: `${ids[0]}:0`, sourceId: ids[0]!, rank: 0, score: 0.7, cited: true }],
      });

      const res = await request(app)
        .post("/api/v1/index-health/sources/bulk-delete")
        .set("Authorization", auth())
        .send({ sourceIds: ids, token: preview.body.token, confirm: true });
      expect(res.status).toBe(400);
      expect(res.body.error?.message ?? res.body.message ?? "").toMatch(/retrieved since/i);
      await expect(KnowledgeSource.countDocuments({ organizationId: owner.orgId })).resolves.toBe(2);
    });

    it("deletes, and purges the vectors, only after a matching review", async () => {
      const ids = await twoDeadSources();
      const preview = await request(app)
        .post("/api/v1/index-health/sources/bulk-delete/preview")
        .set("Authorization", auth());

      vectorOps.length = 0;
      const res = await request(app)
        .post("/api/v1/index-health/sources/bulk-delete")
        .set("Authorization", auth())
        .send({ sourceIds: ids, token: preview.body.token, confirm: true });

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(2);
      await expect(KnowledgeSource.countDocuments({ organizationId: owner.orgId })).resolves.toBe(0);
      // The mirror goes with the vectors, or a deleted source stays lexically
      // retrievable.
      await expect(KbChunk.countDocuments({ sourceId: { $in: ids } })).resolves.toBe(0);
      const deletedIds = vectorOps.filter((o) => o.op === "delete").flatMap((o) => o.ids);
      expect(deletedIds.length).toBeGreaterThan(0);
      expect(deletedIds.every((id) => ids.some((s) => id.startsWith(`${s}:`)))).toBe(true);
    });

    it("will not delete another org's source even with a valid-looking request", async () => {
      const other = await createOrgWithOwner(app, { email: `y-${Date.now()}@example.com` });
      const otherAgent = await createAgent({ orgId: other.orgId, name: "Other" });
      const foreign = await seedSource({
        orgId: other.orgId,
        agentId: otherAgent._id as mongoose.Types.ObjectId,
        title: "Not yours either",
        text: "nope",
      });
      const preview = await request(app)
        .post("/api/v1/index-health/sources/bulk-delete/preview")
        .set("Authorization", auth());

      const res = await request(app)
        .post("/api/v1/index-health/sources/bulk-delete")
        .set("Authorization", auth())
        .send({ sourceIds: [foreign.toString()], token: preview.body.token, confirm: true });
      expect(res.status).toBe(400);
      await expect(KnowledgeSource.exists({ _id: foreign })).resolves.toBeTruthy();
    });
  });

  // =========================================================================
  // 5. The automated path is not a back door
  // =========================================================================

  describe("the scheduled job", () => {
    it("does nothing at all while the flag is off", async () => {
      await seedSource({ orgId: owner.orgId, agentId, title: "Doc", text: "content", hash: "stale-hash" });
      const before = await KnowledgeSource.find().lean();

      const result = await indexHealthOnce(new Date(Date.UTC(2026, 0, 1, env.kb.indexHealthHourUtc)));

      expect(result).toEqual({ ran: false, reembedded: 0, orgsFlagged: 0 });
      expect(await KnowledgeSource.find().lean()).toEqual(before);
    });

    it("only works inside the configured off-peak hour", () => {
      const hour = env.kb.indexHealthHourUtc;
      expect(isOffPeak(new Date(Date.UTC(2026, 0, 1, hour)), hour)).toBe(true);
      expect(isOffPeak(new Date(Date.UTC(2026, 0, 1, (hour + 6) % 24)), hour)).toBe(false);
    });

    it("never deletes or edits customer knowledge, even with everything enabled", async () => {
      const original = env.kb.indexHealthEnabled;
      env.kb.indexHealthEnabled = true;
      try {
        // A drifted source (content moved on), a healthy one, and a corpus with
        // weak chunks — every branch the job has.
        const drifted = await seedSource({
          orgId: owner.orgId,
          agentId,
          title: "Drifted",
          text: "this text no longer matches its hash",
          hash: "0".repeat(64),
        });
        const healthy = await seedSource({ orgId: owner.orgId, agentId, title: "Healthy", text: "unchanged text" });
        const deadWeight = await seedSource({ orgId: owner.orgId, agentId, title: "Dead", text: "never retrieved" });

        const contentBefore = new Map(
          (await KnowledgeSource.find().lean()).map((s) => [String(s._id), s.extractedText]),
        );
        const countBefore = await KnowledgeSource.countDocuments();
        // Only the sources the job does NOT touch. Re-embedding the drifted one
        // re-chunks it, so its chunk count legitimately changes; the property
        // under test is that everything else is left exactly alone.
        const untouchedChunksBefore = await KbChunk.find({
          sourceId: { $in: [healthy, deadWeight] },
        })
          .sort({ chunkId: 1 })
          .lean();

        await indexHealthOnce(new Date(Date.UTC(2026, 0, 1, env.kb.indexHealthHourUtc)));

        // NOTHING was deleted.
        await expect(KnowledgeSource.countDocuments()).resolves.toBe(countBefore);
        await expect(KnowledgeSource.exists({ _id: deadWeight })).resolves.toBeTruthy();
        await expect(KnowledgeSource.exists({ _id: healthy })).resolves.toBeTruthy();
        const untouchedChunksAfter = await KbChunk.find({
          sourceId: { $in: [healthy, deadWeight] },
        })
          .sort({ chunkId: 1 })
          .lean();
        expect(untouchedChunksAfter.map((c) => c.chunkId)).toEqual(
          untouchedChunksBefore.map((c) => c.chunkId),
        );
        expect(untouchedChunksAfter.map((c) => c.text)).toEqual(
          untouchedChunksBefore.map((c) => c.text),
        );

        // NOTHING had its content edited. Re-embedding rebuilds vectors from the
        // operator's text; it must never rewrite the text itself.
        for (const s of await KnowledgeSource.find().lean()) {
          expect(s.extractedText).toBe(contentBefore.get(String(s._id)));
        }

        // The drifted source's hash caught up, which is what stops the job
        // re-embedding the same source every night forever.
        const after = await KnowledgeSource.findById(drifted).lean();
        expect(after!.contentHash).toBe(hashContent("this text no longer matches its hash"));
      } finally {
        env.kb.indexHealthEnabled = original;
      }
    });

    it("re-embeds only the drifted sources, never the whole corpus", async () => {
      await seedSource({ orgId: owner.orgId, agentId, title: "Fine 1", text: "one" });
      await seedSource({ orgId: owner.orgId, agentId, title: "Fine 2", text: "two" });
      const drifted = await seedSource({
        orgId: owner.orgId,
        agentId,
        title: "Drifted",
        text: "three",
        hash: "f".repeat(64),
      });

      const found = await findDriftedSources(10);
      expect(found.map((f) => f._id.toString())).toEqual([drifted.toString()]);
    });

    it("imports no destructive repair path", async () => {
      // Structural, not aspirational. The job must not be able to reach the
      // routes that delete or rewrite knowledge, whatever a future edit intends.
      const { readFileSync } = await import("node:fs");
      const path = await import("node:path");
      const src = readFileSync(
        path.resolve(process.cwd(), "src/jobs/index-health.job.ts"),
        "utf8",
      );
      expect(src).not.toMatch(/purgeSourceVectors|deleteOne|deleteMany|findOneAndDelete/);
      expect(src).not.toMatch(/index-health\.routes/);
    });
  });

  // =========================================================================
  // 6. Repair actions reachable over HTTP
  // =========================================================================

  describe("repair actions", () => {
    it("answers a gap cluster with a high-priority Q&A source and closes the gaps", async () => {
      // Creating knowledge consumes plan quota, which is 0 without a plan.
      await grantPlan(owner.orgId);
      const gaps = await KnowledgeGap.insertMany([
        { organizationId: owner.orgId, agentId, question: "eu refund timeline", queryUsed: "eu refund timeline", maxKbScore: 0.1, occurrenceCount: 9, status: "open", kind: "gap" },
        { organizationId: owner.orgId, agentId, question: "how long eu refund", queryUsed: "how long eu refund", maxKbScore: 0.1, occurrenceCount: 4, status: "open", kind: "gap" },
      ]);

      const res = await request(app)
        .post("/api/v1/index-health/gap-clusters/answer")
        .set("Authorization", auth())
        .send({
          agentId: agentId.toString(),
          question: "How long do EU refunds take?",
          answer: "EU refunds are returned to the original payment method within 14 days.",
          gapIds: gaps.map((g) => String(g._id)),
        });

      expect(res.status).toBe(201);
      expect(res.body.gapsAddressed).toBe(2);
      // Defaults high: a hand-written answer to a question customers actually
      // asked should outrank whatever the crawler happened to pick up.
      expect(res.body.source.priority).toBe(5);
      // The customer's own words are stored with the answer, because their
      // vocabulary is exactly what failed to match anything.
      expect(res.body.source.content).toContain("Q: How long do EU refunds take?");
      await expect(KnowledgeGap.countDocuments({ organizationId: owner.orgId, status: "open" })).resolves.toBe(0);
    });

    it("marks a source stale and lowers its priority without re-ingesting it", async () => {
      const id = await seedSource({ orgId: owner.orgId, agentId, title: "Old policy", text: "outdated" });
      const before = await KnowledgeSource.findById(id).lean();
      vectorOps.length = 0;

      const res = await request(app)
        .post(`/api/v1/index-health/sources/${id.toString()}/mark`)
        .set("Authorization", auth())
        .send({ stale: true, priority: -5 });

      expect(res.status).toBe(200);
      expect(res.body.stale).toBe(true);
      expect(res.body.priority).toBe(-5);
      // Mirrored onto the chunks, which is where conflict resolution reads it.
      const chunks = await KbChunk.find({ sourceId: id }).lean();
      expect(chunks.every((c) => c.priority === -5)).toBe(true);
      // Metadata only: no re-embed, and content authority is untouched.
      expect(vectorOps).toEqual([]);
      const after = await KnowledgeSource.findById(id).lean();
      expect(after!.contentHash).toBe(before!.contentHash);
      expect(String(after!.sourceUpdatedAt)).toBe(String(before!.sourceUpdatedAt));
    });

    it("rejects a mark with nothing to change", async () => {
      const id = await seedSource({ orgId: owner.orgId, agentId, title: "Doc", text: "text" });
      const res = await request(app)
        .post(`/api/v1/index-health/sources/${id.toString()}/mark`)
        .set("Authorization", auth())
        .send({});
      expect(res.status).toBe(400);
    });

    it("requires admin or above for every repair", async () => {
      const id = await seedSource({ orgId: owner.orgId, agentId, title: "Doc", text: "text" });
      const { Membership } = await import("../models/index.js");
      await Membership.updateOne(
        { organizationId: owner.orgId, userId: owner.user.id },
        { $set: { role: "viewer" } },
      );
      const viewer = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: owner.user.email, password: "Password1234!" });
      const token = `Bearer ${viewer.body.accessToken}`;

      for (const url of [
        `/api/v1/index-health/sources/${id.toString()}/reindex`,
        `/api/v1/index-health/sources/${id.toString()}/mark`,
        "/api/v1/index-health/sources/bulk-delete/preview",
        "/api/v1/index-health/gap-clusters/answer",
      ]) {
        const res = await request(app).post(url).set("Authorization", token).send({ stale: true });
        expect(res.status, `${url} allowed a viewer`).toBe(403);
      }
    });
  });
});
