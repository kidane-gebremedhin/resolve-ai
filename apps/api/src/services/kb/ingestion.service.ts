import crypto from "node:crypto";
import { KnowledgeSource } from "../../models/index.js";
import { chunkText } from "../../utils/chunker.js";
import { embed } from "../ai/embedding.service.js";
import { getPineconeIndex } from "../../config/pinecone.js";
import { logger } from "../../config/logger.js";
import { getIoServer } from "../../socket/index.js";
import { parseFile, type ParseInput } from "./parsers.js";

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

export async function ingestSource(sourceId: string, payload?: IngestPayload): Promise<void> {
  const source = await KnowledgeSource.findById(sourceId);
  if (!source) throw new Error(`KB source not found: ${sourceId}`);

  try {
    source.embeddingStatus = "processing";
    await source.save();
    emitKnowledgeUpdate(source);

    // Step 1: ensure extractedText exists. If a file payload was provided and
    // we don't yet have extracted text, parse it now.
    if (payload?.kind === "file" && !source.extractedText) {
      const parsed = await parseFile(payload.file);
      source.extractedText = parsed.text;
      source.contentHash = hashContent(parsed.text);
      await source.save();
    } else if (payload?.kind === "text" && !source.extractedText) {
      source.extractedText = payload.text;
      source.contentHash = hashContent(payload.text);
      await source.save();
    }

    const text = source.extractedText ?? source.content ?? "";
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      source.embeddingStatus = "synced";
      source.chunkCount = 0;
      source.lastSyncedAt = new Date();
      source.embeddingError = undefined;
      await source.save();
      emitKnowledgeUpdate(source);
      return;
    }

    // Large sources take a while (embed + upsert are batched and run
    // sequentially); log so progress is observable in the server logs.
    logger.info("[kb] embedding source", { sourceId, chunks: chunks.length });
    const vectors = await embed(chunks.map((c) => c.text));
    const pinecone = getPineconeIndex();
    const previousIds = source.pineconeIds ?? [];
    const ids = chunks.map((c) => `${source._id.toString()}:${c.index}`);
    // NOTE: per __specs/04-pinecone-firecrawl.md vectors should be upserted
    // into the org-scoped namespace. The current pinecone client stub doesn't
    // expose a `.namespace()` method — once the parallel rewrite lands we
    // should switch to `pinecone.namespace(orgId).upsert(...)`.
    // Single-URL sources (a doc or a single page) tag every chunk with the
    // source URL so citations link to it. Website crawls tag per-page URLs in
    // firecrawl.service.ts. Pinecone metadata rejects null, so only include
    // `url` when present.
    const sourceUrl = (source.sourceUrl as string | undefined) ?? undefined;
    await pinecone.upsert(
      chunks.map((c, i) => ({
        id: ids[i]!,
        values: vectors[i]!,
        metadata: {
          organizationId: source.organizationId.toString(),
          agentId: source.agentId.toString(),
          sourceId: source._id.toString(),
          chunkIndex: c.index,
          ...(sourceUrl ? { url: sourceUrl } : {}),
          // Store the FULL chunk text (not a 500-char preview) so retrieval
          // returns the whole chunk to the model and the on-disk vectors show
          // complete, overlapping content. Chunks are ~1200 chars; the 8000
          // cap is just a guard against Pinecone's ~40KB/vector metadata limit.
          text: c.text.slice(0, 8000),
        },
      })),
    );

    // Re-ingest cleanup: drop any vectors from a previous run that the new
    // chunking no longer produces (e.g. the doc got shorter, or chunk size
    // changed and yields fewer chunks). We upsert the new set first, then
    // delete only the now-stale ids, so a failure never leaves zero vectors.
    const newIdSet = new Set(ids);
    const staleIds = previousIds.filter((id) => !newIdSet.has(id));
    if (staleIds.length > 0) {
      await pinecone.deleteMany(staleIds);
    }

    source.pineconeIds = ids;
    source.chunkCount = chunks.length;
    source.embeddingStatus = "synced";
    source.lastSyncedAt = new Date();
    source.embeddingError = undefined;
    await source.save();
    emitKnowledgeUpdate(source);
    logger.info("[kb] ingested", { sourceId, chunks: chunks.length });
  } catch (err) {
    const message = (err as Error).message;
    source.embeddingStatus = "error";
    source.embeddingError = message;
    source.retryCount = (source.retryCount ?? 0) + 1;
    await source.save();
    emitKnowledgeUpdate(source);
    logger.error("[kb] ingestion failed", { sourceId, err: message });
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
  if (ids.length === 0) return;
  const pinecone = getPineconeIndex();
  try {
    await pinecone.deleteMany(ids);
  } catch (err) {
    logger.error("[kb] pinecone deleteMany failed", { sourceId, err: (err as Error).message });
    throw err;
  }
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
