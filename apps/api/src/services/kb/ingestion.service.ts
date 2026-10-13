import crypto from "node:crypto";
import { KbChunk, KnowledgeSource } from "../../models/index.js";
import { chunkText, embeddableText } from "../../utils/chunker.js";
import { EMBEDDING_MODEL, embed } from "../ai/embedding.service.js";
import { orgBudgetStatus } from "../budget-alert.service.js";
import { getPineconeIndex } from "../../config/pinecone.js";
import { env } from "../../config/env.js";
import { IngestionRun, type IngestionStage } from "./ingestion-events.js";
import { classifyError, describeError } from "./ingestion-errors.js";
import { logger } from "../../config/logger.js";
import { getIoServer } from "../../socket/index.js";
import { parseFile, type ParseInput } from "./parsers.js";

// Chunks embedded, upserted and mirrored per step. Holding every vector (1536
// numbers per chunk) and hydrating every mirror row at once is what made a large
// ingest's memory grow with the document. A step's work is dropped before the
// next is built.
const INGEST_BATCH = 256;

// Extracted text lives on the KnowledgeSource document, and MongoDB rejects a
// document over 16MB. Past this the save threw a raw BSON RangeError, and the
// catch block's own save threw again on the same oversized field, so the source
// sat in `processing` until the reconcile job noticed. Leaves 1MB of headroom
// for the rest of the document. Not configurable: the limit is MongoDB's.
export const MAX_EXTRACTED_TEXT_BYTES = 15 * 1024 * 1024;

/** Throws a classifiable error when `text` cannot be stored on a source. */
export function assertStorableText(text: string): void {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_EXTRACTED_TEXT_BYTES) {
    throw new Error(
      `extracted text too large: ${(bytes / 1048576).toFixed(1)}MB, limit ${MAX_EXTRACTED_TEXT_BYTES / 1048576}MB`,
    );
  }
}

// Broadcast a KB source status change to the org room so the dashboard list
// can swap the badge live (no router.refresh). Best-effort: tests + workers
// run before the socket server is attached, so a null `io` is normal.
export function emitKnowledgeUpdate(source: {
  _id: { toString(): string };
  organizationId: { toString(): string };
  embeddingStatus?: string | null;
  chunkCount?: number | null;
  lastSyncedAt?: Date | null;
  embeddingError?: string | null;
}): void {
  const io = getIoServer();
  if (!io) return;
  io.to(`org:${source.organizationId.toString()}`).emit("knowledge:updated", {
    sourceId: source._id.toString(),
    embeddingStatus: source.embeddingStatus ?? undefined,
    chunkCount: source.chunkCount ?? undefined,
    lastSyncedAt: source.lastSyncedAt ?? undefined,
    embeddingError: source.embeddingError ?? undefined,
  });
}

/**
 * Optional pre-ingest payload: if the source is a freshly uploaded file we
 * receive the buffer here so we can extract text, persist `extractedText` +
 * `contentHash`, and then continue down the normal chunk/embed pipeline.
 *
 * Pre-parsed text (`parsedText`) is also supported for callers that want to
 * supply text directly (e.g. the website-crawl reconciliation job).
 */
export type IngestPayload =
  | { kind: "file"; file: ParseInput }
  | { kind: "text"; text: string }
  | undefined;

// Reconstruct per-page { url, markdown } blocks from a crawled website's stored
// extractedText. `firecrawl.service.ts` persists it as "# <pageUrl>\n\n<markdown>"
// blocks joined by "\n\n---\n\n". We split on the page-URL headers (NOT the "---"
// separators, which also legitimately appear inside markdown) so a reconcile /
// reingest — which only has the stored text, not the live crawl — can still
// re-attribute every chunk to its exact page instead of collapsing them all to
// the site's base URL (which is what made citations show only the homepage).
export function splitCrawledPages(text: string): { url: string; markdown: string }[] {
  if (!text) return [];
  const heads = [...text.matchAll(/^# (https?:\/\/\S+)[ \t]*$/gm)];
  if (heads.length === 0) return [];
  const pages: { url: string; markdown: string }[] = [];
  for (let i = 0; i < heads.length; i++) {
    const url = heads[i]![1]!;
    const bodyStart = heads[i]!.index! + heads[i]![0].length;
    const bodyEnd = i + 1 < heads.length ? heads[i + 1]!.index! : text.length;
    const markdown = text
      .slice(bodyStart, bodyEnd)
      .replace(/\n\n---\n\n\s*$/, "") // drop the trailing page separator
      .trim();
    if (markdown) pages.push({ url, markdown });
  }
  return pages;
}

export async function ingestSource(sourceId: string, payload?: IngestPayload): Promise<void> {
  const source = await KnowledgeSource.findById(sourceId);
  if (!source) throw new Error(`KB source not found: ${sourceId}`);

  // One run id ties every stage of this attempt together, including when the
  // reconcile job is the caller. Without it a timeline is a pile of rows with no
  // way to tell which attempt each belonged to.
  const run = new IngestionRun({
    sourceId,
    organizationId: source.organizationId.toString(),
    agentId: source.agentId?.toString(),
    attempt: (source.retryCount ?? 0) + 1,
  });

  // Which stage is running, so a thrown error can be attributed. Assigned
  // rather than inferred because the failure surfaces in one catch block far
  // from where it happened.
  let currentStage: IngestionStage = "parse";
  // Set once any vector of this run is in the index. An embed failure on a
  // later batch is then a partial write, not a clean one.
  let wroteVectors = false;

  try {
    source.embeddingStatus = "processing";
    await source.save();
    emitKnowledgeUpdate(source);

    // Step 1: ensure extractedText exists. If a file payload was provided and
    // we don't yet have extracted text, parse it now.
    if (payload?.kind === "file" && !source.extractedText) {
      const parsed = await parseFile(payload.file);
      assertStorableText(parsed.text);
      source.extractedText = parsed.text;
      source.contentHash = hashContent(parsed.text);
      await source.save();
    } else if (payload?.kind === "text" && !source.extractedText) {
      assertStorableText(payload.text);
      source.extractedText = payload.text;
      source.contentHash = hashContent(payload.text);
      await source.save();
    }

    // `sourceUpdatedAt` tracks CONTENT, not the row. `updatedAt` moves on every
    // reingest, retry and status change, so it says nothing about which of two
    // documents is more current — which is exactly what conflict resolution
    // needs it for. Stamp it only when the hash actually changed, and seed it
    // for sources that predate the field.
    if (!source.sourceUpdatedAt || source.isModified("contentHash")) {
      source.sourceUpdatedAt = new Date();
    }

    currentStage = "chunk";
    run.ok("parse", { byteSize: (source.extractedText ?? source.content ?? "").length });

    const text = source.extractedText ?? source.content ?? "";
    const sourceUrl = (source.sourceUrl as string | undefined) ?? undefined;

    // Attribute every chunk to a specific page URL. Website sources keep their
    // per-page structure (parsed back out of the stored text) so each chunk links
    // to the exact page it came from — mirroring the live-crawl path in
    // firecrawl.service.ts, and crucially surviving a reconcile/reingest that only
    // has the stored text. Non-website sources (files, pasted text, single URL)
    // tag every chunk with the source URL, if any.
    const pages = source.type === "website" ? splitCrawledPages(text) : [];
    let taggedChunks: { index: number; text: string; url?: string; headingPath: string[] }[];
    if (pages.length > 0) {
      taggedChunks = [];
      let globalIdx = 0;
      for (const page of pages) {
        for (const c of chunkText(page.markdown)) {
          taggedChunks.push({
            index: globalIdx++,
            text: c.text,
            url: page.url || sourceUrl,
            headingPath: c.headingPath ?? [],
          });
        }
      }
    } else {
      taggedChunks = chunkText(text).map((c) => ({
        index: c.index,
        text: c.text,
        url: sourceUrl,
        headingPath: c.headingPath ?? [],
      }));
    }

    if (taggedChunks.length === 0) {
      // Was `synced`. A source that retrieves nothing is not a success, and
      // reporting it as one is why these were invisible: the reconcile job only
      // revisits `error` and `processing`, so a zero-chunk source was never
      // looked at again by anything.
      //
      // A re-ingest that now yields nothing (a page emptied, a file replaced by
      // a scan) must also drop the previous run's vectors and mirror rows, or the
      // old content keeps answering questions under a source marked `empty`.
      const previous = source.pineconeIds ?? [];
      if (previous.length > 0) await getPineconeIndex().deleteMany(previous);
      await KbChunk.deleteMany({ sourceId: source._id });
      source.pineconeIds = [];
      const classified = describeError("empty_extraction");
      source.embeddingStatus = "empty";
      source.chunkCount = 0;
      source.lastSyncedAt = new Date();
      source.embeddingErrorCode = classified.code;
      source.embeddingError = classified.message;
      await source.save();
      emitKnowledgeUpdate(source);
      run.failed("chunk", classified);
      await run.flush();
      logger.warn("[kb] ingest produced no chunks", {
        runId: run.runId,
        sourceId,
        type: source.type,
      });
      return;
    }

    currentStage = "embed";
    run.ok("chunk", { chunkCount: taggedChunks.length });

    // Budget gate: don't spend on embeddings when the org is over its monthly AI
    // budget. Park the source in "error" with a clear reason (a retry after the
    // budget resets, or a plan upgrade, will pick it up and succeed).
    const budget = await orgBudgetStatus(source.organizationId.toString());
    if (budget.exceeded) {
      // The code is what the reconcile job reads to wait instead of spending
      // attempts; without it this read as `unknown` and burned all three.
      const paused = describeError("budget_exceeded");
      source.embeddingStatus = "error";
      source.embeddingError = paused.message;
      source.embeddingErrorCode = paused.code;
      source.embeddingErrorAction = paused.action;
      await source.save();
      emitKnowledgeUpdate(source);
      // The one timeline entry for the pause. The reconcile job does not
      // re-record it while it waits.
      run.skipped("embed", paused.message);
      await run.flush();
      logger.warn("[kb] ingestion skipped — org over budget", { sourceId });
      return;
    }

    // Large sources take a while (embed + upsert are batched and run
    // sequentially); log so progress is observable in the server logs.
    logger.info("[kb] embedding source", { sourceId, chunks: taggedChunks.length, pages: pages.length });

    const pinecone = getPineconeIndex();
    const previousIds = source.pineconeIds ?? [];
    const ids = taggedChunks.map((c) => `${source._id.toString()}:${c.index}`);

    // Record every id this run may write BEFORE writing any. If the run dies
    // halfway, the vectors that landed are still listed on the source, so a
    // delete or the next re-ingest's cleanup reaches them. Recording only on
    // success left them orphaned in the index (__specs/37 I4).
    source.pineconeIds = [...new Set([...previousIds, ...ids])];
    await source.save();

    // NOTE: per __specs/04-pinecone-firecrawl.md vectors should be upserted
    // into the org-scoped namespace. The current pinecone client stub doesn't
    // expose a `.namespace()` method — once the parallel rewrite lands we
    // should switch to `pinecone.namespace(orgId).upsert(...)`.
    for (let start = 0; start < taggedChunks.length; start += INGEST_BATCH) {
      const batch = taggedChunks.slice(start, start + INGEST_BATCH);
      currentStage = "embed";
      // Embed the heading path WITH the text. An isolated chunk about "14 days"
      // never names its subject; "Refunds > EU" in front of it does, and that is
      // the cheapest part of what structure-aware chunking would have bought.
      // The stored text stays clean, so citations show the passage rather than
      // our annotation of it.
      const vectors = await embed(
        batch.map((c) =>
          env.kb.headingPathEmbedding ? embeddableText({ index: c.index, text: c.text, headingPath: c.headingPath }) : c.text,
        ),
        { organizationId: source.organizationId.toString() },
      );
      currentStage = "upsert";
      // Pinecone metadata rejects null, so only include `url` when present.
      await pinecone.upsert(
        batch.map((c, i) => ({
          id: ids[start + i]!,
          values: vectors[i]!,
          metadata: {
            organizationId: source.organizationId.toString(),
            agentId: source.agentId.toString(),
            sourceId: source._id.toString(),
            chunkIndex: c.index,
            ...(c.url ? { url: c.url } : {}),
            ...(c.headingPath.length > 0 ? { headingPath: c.headingPath.join(" > ") } : {}),
            // Written for completeness. Retrieval reads these from the Mongo
            // mirror, not from here — see the note in `hydrate()`.
            priority: source.priority ?? 0,
            ...(source.sourceUpdatedAt
              ? { sourceUpdatedAt: source.sourceUpdatedAt.toISOString() }
              : {}),
            // A FALLBACK copy, no longer the source of truth: retrieval hydrates
            // text from the `KbChunk` mirror, which is not truncated. This stays
            // so a deployment whose mirror has not been backfilled degrades to the
            // old behaviour instead of returning empty passages. The 8000 cap
            // guards Pinecone's ~40KB/vector metadata limit.
            text: c.text.slice(0, 8000),
          },
        })),
      );
      wroteVectors = true;
    }
    run.ok("embed", { chunkCount: taggedChunks.length });

    currentStage = "cleanup";
    run.ok("upsert", { chunkCount: taggedChunks.length });

    // Re-ingest cleanup: drop any vectors from a previous run that the new
    // chunking no longer produces (e.g. the doc got shorter, or chunk size
    // changed and yields fewer chunks). We upsert the new set first, then
    // delete only the now-stale ids, so a failure never leaves zero vectors.
    const newIdSet = new Set(ids);
    const staleIds = previousIds.filter((id) => !newIdSet.has(id));
    if (staleIds.length > 0) {
      await pinecone.deleteMany(staleIds);
    }
    run.ok("cleanup", { chunkCount: staleIds.length });

    // Mirror every chunk to Mongo: the lexical leg queries it, and retrieval
    // reads passage text from it. Written after the Pinecone upsert so a failure
    // here leaves searchable vectors rather than orphaned rows, and replaced
    // wholesale per source so a shorter re-ingest cannot leave stale chunks
    // behind.
    await KbChunk.deleteMany({ sourceId: source._id });
    // In batches: Mongoose hydrates every row it inserts, and one call for a
    // 15MB document's ~15k chunks was the single largest allocation of the run.
    for (let start = 0; start < taggedChunks.length; start += INGEST_BATCH) {
      await KbChunk.insertMany(
        taggedChunks.slice(start, start + INGEST_BATCH).map((c, i) => ({
          organizationId: source.organizationId,
          agentId: source.agentId,
          sourceId: source._id,
          chunkIndex: c.index,
          chunkId: ids[start + i]!,
          text: c.text,
          headingPath: c.headingPath,
          ...(c.url ? { url: c.url } : {}),
          tokenCount: Math.ceil(c.text.length / 4),
          priority: source.priority ?? 0,
          sourceUpdatedAt: source.sourceUpdatedAt ?? null,
        })),
        { ordered: false },
      );
    }

    source.pineconeIds = ids;
    source.chunkCount = taggedChunks.length;
    source.embeddingModel = EMBEDDING_MODEL;
    source.embeddingStatus = "synced";
    source.lastSyncedAt = new Date();
    source.embeddingError = undefined;
    source.embeddingErrorCode = undefined;
    await source.save();
    emitKnowledgeUpdate(source);
    await run.flush();
    logger.info("[kb] ingested", { runId: run.runId, sourceId, chunks: taggedChunks.length });
  } catch (err) {
    const message = (err as Error).message;
    // Classify rather than storing the raw provider string as the diagnosis.
    // The stage matters: an unrecognised failure during `embed` is an embedding
    // provider error, not a generic unknown.
    const classified = classifyError(err, currentStage);

    // Vectors may have landed before the failure while `pineconeIds` still
    // holds the previous run's set. Say so explicitly instead of leaving the
    // index and our record of it silently disagreeing — the next retry
    // re-indexes the whole source, which repairs it.
    const partial = wroteVectors || currentStage === "upsert" || currentStage === "cleanup";
    const finalError = partial ? describeError("partial_upsert", message) : classified;

    source.embeddingStatus = "error";
    source.embeddingError = finalError.message;
    source.embeddingErrorCode = finalError.code;
    source.embeddingErrorAction = finalError.action;
    // A permanent failure must not consume a retry: the reconcile job reads the
    // code, and burning attempts on an unsupported file type is what made these
    // sources go quiet after three minutes.
    if (finalError.retry === "backoff") {
      source.retryCount = (source.retryCount ?? 0) + 1;
    }
    await source.save();
    emitKnowledgeUpdate(source);
    run.failed(currentStage, finalError);
    await run.flush();
    logger.error("[kb] ingestion failed", {
      runId: run.runId,
      sourceId,
      stage: currentStage,
      code: finalError.code,
      err: message,
    });
    throw err;
  }
}

/**
 * Tear down a source's Pinecone vectors. Used by the deletion job and by
 * `PUT /knowledge/:id` before a re-ingest. Tolerates an empty vector list.
 */
export async function purgeSourceVectors(sourceId: string): Promise<void> {
  const source = await KnowledgeSource.findById(sourceId);
  if (!source) return;
  const ids = source.pineconeIds ?? [];
  // Only the vector call depends on recorded ids. A source can reach here with
  // none (Pinecone not configured, an ingest that wrote the mirror and failed
  // before recording ids), and returning early in that case skipped the mirror
  // delete below and left the passages lexically retrievable.
  if (ids.length > 0) {
    const pinecone = getPineconeIndex();
    try {
      await pinecone.deleteMany(ids);
    } catch (err) {
      logger.error("[kb] pinecone deleteMany failed", { sourceId, err: (err as Error).message });
      throw err;
    }
  }
  // The mirror goes with the vectors: leaving rows behind would keep a deleted
  // source lexically retrievable, which is a knowledge leak with extra steps.
  await KbChunk.deleteMany({ sourceId: source._id });
  source.pineconeIds = [];
  source.chunkCount = 0;
  await source.save();
}

export function hashContent(text: string): string {
  return crypto
    .createHash("sha256")
    .update(text.toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex");
}
