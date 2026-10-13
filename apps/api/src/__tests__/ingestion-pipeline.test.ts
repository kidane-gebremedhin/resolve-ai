// One ingestion pipeline for every source type, and what it leaves in the
// index when a run is shorter, empty, or dies halfway (__specs/37 I1, I3, I4).
//
// The Pinecone stub is a real in-memory index, so "what is left in it" is the
// assertion, not "which calls were made".

import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const index = vi.hoisted(() => ({
  vectors: new Map<string, { metadata: Record<string, unknown> }>(),
  upsertCalls: [] as number[],
  failUpsertCall: 0, // 1-based call number to throw on; 0 never
}));

vi.mock("../config/pinecone.js", () => ({
  getPineconeIndex: () => ({
    upsert: async (records: { id: string; metadata: Record<string, unknown> }[]) => {
      index.upsertCalls.push(records.length);
      if (index.upsertCalls.length === index.failUpsertCall) throw new Error("Pinecone 503: unavailable");
      for (const r of records) index.vectors.set(r.id, { metadata: r.metadata });
    },
    deleteMany: async (ids: string[]) => {
      for (const id of ids) index.vectors.delete(id);
    },
    query: async () => ({ matches: [] }),
  }),
}));

const budget = vi.hoisted(() => ({ exceeded: false }));

vi.mock("../services/budget-alert.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/budget-alert.service.js")>();
  return {
    ...actual,
    orgBudgetStatus: async (organizationId: string) =>
      budget.exceeded ? { exceeded: true, spent: 10, limit: 10 } : actual.orgBudgetStatus(organizationId),
  };
});

import { IngestionEvent, KbChunk, KnowledgeSource } from "../models/index.js";
import { ingestCrawlResults } from "../services/kb/firecrawl.service.js";
import { ingestSource, purgeSourceVectors } from "../services/kb/ingestion.service.js";
import { reconcileOnce } from "../jobs/embedding-reconcile.job.js";

const vectorsOf = (sourceId: unknown) =>
  [...index.vectors.keys()].filter((id) => id.startsWith(`${String(sourceId)}:`));

async function websiteSource() {
  return KnowledgeSource.create({
    organizationId: new mongoose.Types.ObjectId(),
    agentId: new mongoose.Types.ObjectId(),
    type: "website",
    title: "example.com",
    sourceUrl: "https://example.com",
    contentHash: `pending-${new mongoose.Types.ObjectId()}`,
    embeddingStatus: "processing",
    embeddingError: "firecrawl:crawl_1",
    createdBy: new mongoose.Types.ObjectId(),
  });
}

const page = (url: string, body: string) => ({ url, markdown: body });

describe("crawl ingestion", () => {
  beforeEach(() => {
    index.vectors.clear();
    index.upsertCalls.length = 0;
    index.failUpsertCall = 0;
  });

  it("goes through the shared pipeline: mirror rows, page URLs, heading paths, events", async () => {
    const src = await websiteSource();
    await ingestCrawlResults(src._id.toString(), [
      page("https://example.com/refunds", "# Refunds\n\nRefunds take 30 days."),
      page("https://example.com/shipping", "# Shipping\n\nWe ship in 5 days."),
    ]);

    const after = await KnowledgeSource.findById(src._id).lean();
    expect(after!.embeddingStatus).toBe("synced");
    expect(after!.embeddingError).toBeUndefined();
    expect(after!.sourceUpdatedAt).toBeInstanceOf(Date);

    // The mirror is what the lexical leg and hydration read. The old crawl
    // path never wrote it.
    const rows = await KbChunk.find({ sourceId: src._id }).sort({ chunkIndex: 1 }).lean();
    expect(rows.map((r) => r.url)).toEqual(["https://example.com/refunds", "https://example.com/shipping"]);
    expect(rows[0]!.headingPath).toEqual(["Refunds"]);
    expect(vectorsOf(src._id)).toHaveLength(2);
    expect(index.vectors.get(`${src._id}:1`)!.metadata.url).toBe("https://example.com/shipping");

    expect(await IngestionEvent.countDocuments({ sourceId: src._id })).toBeGreaterThan(0);
  });

  it("a re-crawl with fewer pages leaves nothing of the old run behind", async () => {
    const src = await websiteSource();
    await ingestCrawlResults(src._id.toString(), [
      page("https://example.com/a", "Alpha page."),
      page("https://example.com/b", "Beta page."),
      page("https://example.com/c", "Gamma page."),
    ]);
    expect(vectorsOf(src._id)).toHaveLength(3);

    await ingestCrawlResults(src._id.toString(), [page("https://example.com/a", "Alpha page, edited.")]);
    expect(vectorsOf(src._id)).toEqual([`${src._id}:0`]);
    expect(await KbChunk.countDocuments({ sourceId: src._id })).toBe(1);
    expect((await KnowledgeSource.findById(src._id).lean())!.pineconeIds).toEqual([`${src._id}:0`]);
  });

  it("a crawl that now yields no text is `empty` and removes the old content", async () => {
    const src = await websiteSource();
    await ingestCrawlResults(src._id.toString(), [page("https://example.com/a", "Old refund rule: 90 days.")]);
    expect(vectorsOf(src._id)).toHaveLength(1);

    await ingestCrawlResults(src._id.toString(), [page("https://example.com/a", "   ")]);
    const after = await KnowledgeSource.findById(src._id).lean();
    // Was `synced` with chunkCount 0 on this path.
    expect(after!.embeddingStatus).toBe("empty");
    expect(after!.pineconeIds).toEqual([]);
    expect(vectorsOf(src._id)).toEqual([]);
    expect(await KbChunk.countDocuments({ sourceId: src._id })).toBe(0);
  });
});

describe("ingestion writes", () => {
  beforeEach(() => {
    index.vectors.clear();
    index.upsertCalls.length = 0;
    index.failUpsertCall = 0;
  });

  async function bigTextSource() {
    // ~600 chunks: three upsert batches.
    const text = Array.from({ length: 600 }, (_, n) => `Paragraph ${n}. ${"Refunds take thirty days. ".repeat(40)}`).join("\n\n");
    return KnowledgeSource.create({
      organizationId: new mongoose.Types.ObjectId(),
      agentId: new mongoose.Types.ObjectId(),
      type: "text",
      title: "Big",
      extractedText: text,
      contentHash: `big-${new mongoose.Types.ObjectId()}`,
      createdBy: new mongoose.Types.ObjectId(),
    });
  }

  it("embeds and upserts in bounded batches instead of all at once", async () => {
    const src = await bigTextSource();
    await ingestSource(src._id.toString());
    const after = await KnowledgeSource.findById(src._id).lean();
    expect(after!.embeddingStatus).toBe("synced");
    expect(index.upsertCalls.length).toBeGreaterThan(1);
    expect(Math.max(...index.upsertCalls)).toBeLessThanOrEqual(256);
    expect(vectorsOf(src._id)).toHaveLength(after!.chunkCount!);
  });

  it("a run that dies after some batches landed leaves no vector the source does not know about", async () => {
    const src = await bigTextSource();
    index.failUpsertCall = 2; // first batch lands, second throws
    await expect(ingestSource(src._id.toString())).rejects.toThrow(/503/);

    const after = await KnowledgeSource.findById(src._id).lean();
    expect(after!.embeddingStatus).toBe("error");
    expect(after!.embeddingErrorCode).toBe("partial_upsert");
    const landed = vectorsOf(src._id);
    expect(landed.length).toBeGreaterThan(0);
    // Before: pineconeIds was written only on success, so these were orphans.
    expect(landed.every((id) => after!.pineconeIds!.includes(id))).toBe(true);

    // And deleting the source reaches them.
    await purgeSourceVectors(src._id.toString());
    expect(vectorsOf(src._id)).toEqual([]);
  });

  it("an over-budget run is coded budget_exceeded, so reconcile waits instead of burning retries", async () => {
    const src = await bigTextSource();
    // A stale code from an earlier failure must not survive into this one.
    await KnowledgeSource.updateOne({ _id: src._id }, { embeddingErrorCode: "embedding_provider_error" });
    budget.exceeded = true;
    try {
      await ingestSource(src._id.toString());
    } finally {
      budget.exceeded = false;
    }

    const after = await KnowledgeSource.findById(src._id).lean();
    expect(after!.embeddingStatus).toBe("error");
    expect(after!.embeddingErrorCode).toBe("budget_exceeded");
    expect(index.upsertCalls).toEqual([]);
  });
});

describe("re-embed resume", () => {
  it("stamps the embedding model on a successful ingest", async () => {
    const { EMBEDDING_MODEL } = await import("../services/ai/embedding.service.js");
    const src = await KnowledgeSource.create({
      organizationId: new mongoose.Types.ObjectId(),
      agentId: new mongoose.Types.ObjectId(),
      type: "text",
      title: "Small",
      extractedText: "Refunds take thirty days.",
      contentHash: `small-${new mongoose.Types.ObjectId()}`,
      createdBy: new mongoose.Types.ObjectId(),
    });
    await ingestSource(src._id.toString());
    expect((await KnowledgeSource.findById(src._id).lean())!.embeddingModel).toBe(EMBEDDING_MODEL);
  });

  it("skips only sources that are complete AND on the current model", async () => {
    const { isAlreadyCurrent } = await import("../services/kb/reembed-plan.js");
    const done = { mirrored: 4, chunkCount: 4, embeddingModel: "m-new" };
    expect(isAlreadyCurrent(done, "m-new")).toBe(true);
    // The case the old check got wrong: complete mirror, old-model vectors.
    expect(isAlreadyCurrent({ ...done, embeddingModel: "m-old" }, "m-new")).toBe(false);
    expect(isAlreadyCurrent({ ...done, embeddingModel: undefined }, "m-new")).toBe(false);
    expect(isAlreadyCurrent({ ...done, mirrored: 3 }, "m-new")).toBe(false);
    expect(isAlreadyCurrent({ mirrored: 0, chunkCount: 0, embeddingModel: "m-new" }, "m-new")).toBe(false);
  });
});

describe("reconcile retries", () => {
  beforeEach(async () => {
    index.vectors.clear();
    index.upsertCalls.length = 0;
    index.failUpsertCall = 0;
    await KnowledgeSource.deleteMany({});
    await IngestionEvent.deleteMany({});
  });

  async function erroredSource(over: Record<string, unknown> = {}) {
    const doc = await KnowledgeSource.create({
      organizationId: new mongoose.Types.ObjectId(),
      agentId: new mongoose.Types.ObjectId(),
      type: "text",
      title: "Errored",
      extractedText: "Refunds take thirty days.",
      contentHash: `e-${new mongoose.Types.ObjectId()}`,
      createdBy: new mongoose.Types.ObjectId(),
      embeddingStatus: "error",
      ...over,
    });
    // Past any backoff window. `timestamps` would overwrite it on create.
    await KnowledgeSource.updateOne({ _id: doc._id }, { $set: { updatedAt: new Date(0) } }, { timestamps: false });
    return doc;
  }

  it("a retry that fails again spends one attempt, not two", async () => {
    const src = await erroredSource({ embeddingErrorCode: "pinecone_upsert_failure", retryCount: 1 });
    index.failUpsertCall = 1;

    await reconcileOnce();

    const after = await KnowledgeSource.findById(src._id).lean();
    expect(after!.embeddingStatus).toBe("error");
    expect(after!.retryCount).toBe(2);
  });

  it("budget-paused sources do not crowd other retries out of the batch", async () => {
    const pausedOrg = new mongoose.Types.ObjectId();
    for (let n = 0; n < 25; n++) {
      await erroredSource({ organizationId: pausedOrg, embeddingErrorCode: "budget_exceeded", retryCount: 0 });
    }
    const other = await erroredSource({ embeddingErrorCode: "pinecone_upsert_failure", retryCount: 0 });

    budget.exceeded = true;
    try {
      await reconcileOnce();
    } finally {
      budget.exceeded = false;
    }

    // Reached and attempted. (The mock puts every org over budget, so the
    // attempt itself parks at the gate; what matters is that it got a turn.)
    expect(await IngestionEvent.countDocuments({ sourceId: other._id, stage: "retry", status: "ok" })).toBe(1);
  });

  it("a long budget pause does not write an event every tick", async () => {
    const src = await erroredSource({ embeddingErrorCode: "budget_exceeded", retryCount: 0 });

    budget.exceeded = true;
    try {
      for (let tick = 0; tick < 5; tick++) await reconcileOnce();
    } finally {
      budget.exceeded = false;
    }

    expect((await KnowledgeSource.findById(src._id).lean())!.retryCount).toBe(0);
    expect(await IngestionEvent.countDocuments({ sourceId: src._id })).toBeLessThanOrEqual(1);
  });
});
