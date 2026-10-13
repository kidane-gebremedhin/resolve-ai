// Query plans that must not grow with OTHER tenants' data or with the whole
// platform's corpus (__specs/38 S3, S9). Asserted from MongoDB's own explain
// output on the shipped query shapes, next to a much larger neighbour.

import mongoose from "mongoose";
import { beforeAll, describe, expect, it } from "vitest";
import { KbChunk, KnowledgeSource } from "../models/index.js";
import { lexicalSearch } from "../services/kb/lexical-search.service.js";

const orgA = new mongoose.Types.ObjectId();
const agentA = new mongoose.Types.ObjectId();
const orgB = new mongoose.Types.ObjectId();
const agentB = new mongoose.Types.ObjectId();

const chunk = (org: mongoose.Types.ObjectId, agent: mongoose.Types.ObjectId, i: number) => ({
  organizationId: org,
  agentId: agent,
  sourceId: new mongoose.Types.ObjectId(),
  chunkIndex: i,
  chunkId: `${org.toString()}-${i}`,
  text: `How refunds work for order ${i}. Refund policy section ${i % 50}.`,
  headingPath: [],
});

describe("index plans at scale", () => {
  beforeAll(async () => {
    await KbChunk.syncIndexes();
    await KnowledgeSource.syncIndexes();
  }, 120_000);

  // The shared setup empties every collection before each test, so each test
  // seeds its own corpus. Tenant B is 100x tenant A, and all of it matches.
  async function seedCorpus(): Promise<void> {
    await KbChunk.collection.insertMany(Array.from({ length: 20_000 }, (_, i) => chunk(orgB, agentB, i)));
    await KbChunk.collection.insertMany(Array.from({ length: 200 }, (_, i) => chunk(orgA, agentA, i)));
  }

  it("scans only the querying tenant's chunks for a lexical search", async () => {
    await seedCorpus();
    // The exact shape `lexicalSearch()` sends.
    const plan = (await KbChunk.find(
      { organizationId: orgA, agentId: agentA, $text: { $search: "refund policy" } },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(8)
      .explain("executionStats")) as unknown as {
      executionStats: { totalKeysExamined: number; totalDocsExamined: number; nReturned: number };
    };
    const stats = plan.executionStats;
    expect(stats.nReturned).toBe(8);
    // Before the prefix: 20,200+ keys (every tenant's matches). Now bounded by
    // tenant A's own 200 chunks (two terms, so up to two keys per chunk).
    expect(stats.totalKeysExamined).toBeLessThanOrEqual(400);
    expect(stats.totalDocsExamined).toBeLessThanOrEqual(200);
  });

  it("still returns the tenant's results through the real service", async () => {
    await seedCorpus();
    const hits = await lexicalSearch({
      query: "refund policy",
      organizationId: orgA.toString(),
      agentId: agentA.toString(),
      topK: 5,
    });
    expect(hits).toHaveLength(5);
    expect(hits.every((h) => h.chunkId.startsWith(orgA.toString()))).toBe(true);
  });

  it("walks the drift scan from an index instead of sorting in memory", async () => {
    await KnowledgeSource.collection.insertMany(
      Array.from({ length: 2_000 }, (_, i) => ({
        organizationId: orgB,
        agentId: agentB,
        type: "text",
        title: "t",
        contentHash: `h${i}`,
        embeddingStatus: i % 3 === 0 ? "error" : "synced",
        createdBy: orgB,
        createdAt: new Date(),
        updatedAt: new Date(Date.now() - i * 1000),
      })),
    );
    // The shape in `jobs/index-health.job.ts` findDriftedSources.
    const explained = (await KnowledgeSource.find(
      { embeddingStatus: { $in: ["synced", "empty"] } },
      { contentHash: 1 },
    )
      .sort({ updatedAt: -1 })
      .limit(50)
      .explain("queryPlanner")) as unknown as { queryPlanner: { winningPlan: unknown } };
    // The winning plan only: rejected candidates legitimately include a sort.
    const plan = JSON.stringify(explained.queryPlanner.winningPlan);
    expect(plan).toContain("embeddingStatus_1_updatedAt_-1");
    // A streaming merge of two index ranges, not a blocking in-memory sort.
    expect(plan).toContain("SORT_MERGE");
    expect(plan).not.toMatch(/"stage":"SORT"/);
  });
});
