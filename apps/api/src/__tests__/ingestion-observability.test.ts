// Ingestion failure classification, recovery, and the retry loop's judgement.
//
// The tests that earn their place are the retry-policy ones. Before this, every
// failure was retried identically: an unsupported file type burned three
// attempts in three minutes and then sat silent forever, indistinguishable from
// a rate limit that would have succeeded on the fourth. The assertions below are
// about which failures the loop is allowed to spend attempts on.

import { describe, expect, it, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { IngestionEvent, KnowledgeSource } from "../models/index.js";
import {
  allErrorCodes,
  classifyError,
  describeError,
  isDeferred,
  isPermanent,
  type IngestionErrorCode,
} from "../services/kb/ingestion-errors.js";
import { IngestionRun, recordIngestionEvent } from "../services/kb/ingestion-events.js";
import { ingestionHealth } from "../services/kb/ingestion-health.service.js";
import { reconcileOnce } from "../jobs/embedding-reconcile.job.js";
import { extractCrawlId } from "../services/kb/firecrawl.service.js";

const ORG = new mongoose.Types.ObjectId();
const AGENT = new mongoose.Types.ObjectId();
const USER = new mongoose.Types.ObjectId();

async function seedSource(over: Record<string, unknown> = {}) {
  const { updatedAt, ...fields } = over as { updatedAt?: Date };
  const doc = await KnowledgeSource.create({
    organizationId: ORG,
    agentId: AGENT,
    type: "text",
    title: "Fixture",
    contentHash: `hash-${Math.random()}`,
    createdBy: USER,
    embeddingStatus: "error",
    ...fields,
  });

  // `timestamps: true` overwrites `updatedAt` on create, so a seeded value is
  // silently replaced with "now" — which made the backoff and stuck-processing
  // windows never elapse. Set it afterwards with timestamps off.
  if (updatedAt) {
    await KnowledgeSource.updateOne(
      { _id: doc._id },
      { $set: { updatedAt } },
      { timestamps: false },
    );
  }
  return doc;
}

describe("error taxonomy", () => {
  // Every class must carry an operator-readable message AND something to do
  // about it. A classification with no action is a relabelled stack trace.
  for (const code of allErrorCodes()) {
    it(`${code}: has an operator message and a suggested action`, () => {
      const described = describeError(code);
      expect(described.code).toBe(code);
      expect(described.message.length).toBeGreaterThan(10);
      expect(described.action.length).toBeGreaterThan(10);
      // No provider jargon leaking into the operator-facing text.
      expect(described.message).not.toMatch(/undefined|null|Error:|stack/i);
      expect(["never", "backoff", "deferred"]).toContain(described.retry);
    });
  }

  describe("classification of real provider errors", () => {
    const cases: [string, IngestionErrorCode][] = [
      ["Unsupported file type: application/x-msdownload", "unsupported_file_type"],
      ["PDF is password-protected", "parse_failure"],
      ["bad zip file: not a docx", "parse_failure"],
      ["Parsed but produced no extractable text", "empty_extraction"],
      ["Embedding 429: Too Many Requests", "rate_limited"],
      ["Embedding 503: upstream unavailable", "embedding_provider_error"],
      ["AI budget reached — indexing paused", "budget_exceeded"],
      ["Pinecone upsert failed: index not found", "pinecone_upsert_failure"],
      ["Request timed out after 20000ms", "timeout"],
      ["something nobody has seen before", "unknown"],
    ];

    for (const [raw, expected] of cases) {
      it(`"${raw.slice(0, 34)}…" → ${expected}`, () => {
        expect(classifyError(new Error(raw)).code).toBe(expected);
      });
    }

    it("prefers the specific class over the general one", () => {
      // "Embedding 429" contains both the rate-limit and the embedding pattern.
      // Matching the general one would retry a rate limit on the wrong schedule.
      expect(classifyError(new Error("Embedding 429: rate limit")).code).toBe("rate_limited");
    });

    it("uses the stage when the message says nothing useful", () => {
      expect(classifyError(new Error("ECONNRESET"), "embed").code).toBe("embedding_provider_error");
    });

    it("defaults an unrecognised failure to retryable, not permanent", () => {
      // Defaulting to permanent would strand sources on a provider error whose
      // wording we simply have not seen yet.
      expect(isPermanent(classifyError(new Error("???")).code)).toBe(false);
    });
  });

  it("marks exactly the classes that retrying cannot help as permanent", () => {
    expect(isPermanent("unsupported_file_type")).toBe(true);
    expect(isPermanent("parse_failure")).toBe(true);
    expect(isPermanent("empty_extraction")).toBe(true);
    expect(isPermanent("rate_limited")).toBe(false);
    expect(isPermanent("timeout")).toBe(false);
    expect(isDeferred("budget_exceeded")).toBe(true);
  });
});

describe("ingestion events", () => {
  it("groups every stage of one run under a single run id", async () => {
    const source = await seedSource();
    const run = new IngestionRun({
      sourceId: source._id.toString(),
      organizationId: String(ORG),
      agentId: String(AGENT),
    });
    run.ok("parse", { byteSize: 1200 });
    run.ok("chunk", { chunkCount: 3 });
    run.failed("embed", describeError("rate_limited", "429"));
    await run.flush();

    const events = await IngestionEvent.find({ sourceId: source._id }).lean();
    expect(events).toHaveLength(3);
    expect(new Set(events.map((e) => e.runId)).size).toBe(1);
    const embed = events.find((e) => e.stage === "embed")!;
    expect(embed.status).toBe("error");
    expect(embed.errorCode).toBe("rate_limited");
    // The raw provider string is kept for support but is not the diagnosis.
    expect(embed.errorRaw).toBe("429");
    expect(embed.errorMessage).not.toBe("429");
  });

  it("never throws when the write fails", async () => {
    // A diagnostic that breaks the thing it is diagnosing is worse than none.
    const spy = vi.spyOn(IngestionEvent, "insertMany").mockRejectedValue(new Error("mongo down"));
    const run = new IngestionRun({ sourceId: String(new mongoose.Types.ObjectId()), organizationId: String(ORG) });
    run.ok("parse");
    await expect(run.flush()).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe("the reconcile job's retry policy", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("spends ZERO retries on a permanent failure and makes it terminal", async () => {
    // The behaviour this whole prompt exists to fix. An unsupported file type
    // used to burn three attempts and then go quiet.
    const source = await seedSource({
      embeddingErrorCode: "unsupported_file_type",
      retryCount: 0,
      updatedAt: new Date(0),
    });

    await reconcileOnce();

    const after = await KnowledgeSource.findById(source._id).lean();
    // Pushed to the ceiling so the loop stops considering it, not incremented.
    expect(after!.retryCount).toBe(env.kb.ingestMaxRetries);
    expect(after!.embeddingErrorAction).toMatch(/will not help/i);

    const events = await IngestionEvent.find({ sourceId: source._id, stage: "retry" }).lean();
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe("skipped");
    expect(events[0]!.errorMessage).toMatch(/Not retried/);
  });

  it("does not consume attempts while waiting for budget", async () => {
    // Burning attempts here would exhaust them before the budget ever resets,
    // stranding the source for the rest of the month.
    const source = await seedSource({
      embeddingErrorCode: "budget_exceeded",
      retryCount: 0,
      updatedAt: new Date(0),
    });

    await reconcileOnce();

    const after = await KnowledgeSource.findById(source._id).lean();
    expect(after!.retryCount).toBe(0);
    const events = await IngestionEvent.find({ sourceId: source._id, stage: "retry" }).lean();
    expect(events[0]!.status).toBe("skipped");
    expect(events[0]!.errorMessage).toMatch(/budget/i);
  });

  it("retries a transient failure, and records the attempt", async () => {
    const source = await seedSource({
      embeddingErrorCode: "rate_limited",
      retryCount: 0,
      // Old enough that the backoff window has passed.
      updatedAt: new Date(0),
    });

    await reconcileOnce();

    const after = await KnowledgeSource.findById(source._id).lean();
    expect(after!.retryCount).toBe(1);
    const events = await IngestionEvent.find({ sourceId: source._id, stage: "retry" }).lean();
    expect(events[0]!.status).toBe("ok");
    expect(events[0]!.errorMessage).toMatch(/attempt 1 of/);
  });

  it("waits for the backoff window instead of retrying every tick", async () => {
    // The flat 60s loop retried a rate-limited provider at exactly the rate
    // that got us limited.
    const source = await seedSource({
      embeddingErrorCode: "rate_limited",
      retryCount: 2,
      updatedAt: new Date(), // just attempted
    });

    await reconcileOnce();

    const after = await KnowledgeSource.findById(source._id).lean();
    expect(after!.retryCount).toBe(2);
    expect(await IngestionEvent.countDocuments({ sourceId: source._id })).toBe(0);
  });

  it("raises something when a source exhausts its retries", async () => {
    // It used to simply go quiet.
    const source = await seedSource({
      embeddingErrorCode: "embedding_provider_error",
      retryCount: env.kb.ingestMaxRetries,
    });

    await reconcileOnce();

    const events = await IngestionEvent.find({ sourceId: source._id, stage: "retry" }).lean();
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe("error");

    // Latched, so it does not re-alert every 60 seconds.
    const after = await KnowledgeSource.findById(source._id).lean();
    expect(after!.ingestAlerted).toBe(true);
    await reconcileOnce();
    expect(await IngestionEvent.countDocuments({ sourceId: source._id, stage: "retry" })).toBe(1);
  });
});

describe("the Firecrawl field has two readers", () => {
  it("a website mid-crawl is not treated as stuck and its crawl id survives", async () => {
    // `POST /knowledge/website` parks the crawl id in `embeddingError` and
    // leaves the source in `processing` while the poll job waits — routinely
    // longer than the stuck threshold. Re-ingesting it here would clobber the
    // crawl id and strand the crawl permanently.
    const source = await seedSource({
      type: "website",
      embeddingStatus: "processing",
      embeddingError: "firecrawl:crawl_abc123",
      updatedAt: new Date(Date.now() - env.kb.ingestStuckProcessingMs - 60_000),
    });

    await reconcileOnce();

    const after = await KnowledgeSource.findById(source._id).lean();
    expect(after!.embeddingStatus).toBe("processing");
    expect(after!.embeddingError).toBe("firecrawl:crawl_abc123");
    // And the poll job can still read it back.
    expect(extractCrawlId(after!.embeddingError ?? undefined)).toBe("crawl_abc123");
    // No recovery event: it was never stuck.
    expect(await IngestionEvent.countDocuments({ sourceId: source._id, stage: "recover" })).toBe(0);
  });

  it("a NON-website source stuck in processing is still recovered", async () => {
    const source = await seedSource({
      type: "text",
      embeddingStatus: "processing",
      updatedAt: new Date(Date.now() - env.kb.ingestStuckProcessingMs - 60_000),
    });

    await reconcileOnce();

    const events = await IngestionEvent.find({ sourceId: source._id, stage: "recover" }).lean();
    expect(events).toHaveLength(1);
    expect(events[0]!.errorMessage).toMatch(/interrupted/i);
  });
});

describe("org ingestion health", () => {
  it("counts empty sources as failing, because they retrieve nothing", async () => {
    await seedSource({ embeddingStatus: "synced" });
    await seedSource({ embeddingStatus: "synced" });
    await seedSource({ embeddingStatus: "empty", embeddingErrorCode: "empty_extraction" });
    await seedSource({ embeddingStatus: "error", embeddingErrorCode: "parse_failure" });

    const health = await ingestionHealth(String(ORG));
    expect(health.totalSources).toBe(4);
    // `empty` looks like success in a status column and is not one.
    expect(health.failing).toBe(2);
    expect(health.failureRate).toBe(0.5);
  });

  it("breaks failures down by class with the operator guidance attached", async () => {
    const source = await seedSource();
    await recordIngestionEvent({
      sourceId: source._id.toString(),
      organizationId: String(ORG),
      stage: "parse",
      status: "error",
      errorCode: "parse_failure",
      errorMessage: describeError("parse_failure").message,
    });

    const health = await ingestionHealth(String(ORG));
    const parse = health.byErrorClass.find((c) => c.code === "parse_failure");
    expect(parse?.count).toBe(1);
    expect(parse?.action).toMatch(/re-upload/i);
  });
});
