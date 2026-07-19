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
    const sourceUrl = (source.sourceUrl as string | undefined) ?? undefined;

    // Attribute every chunk to a specific page URL. Website sources keep their
    // per-page structure (parsed back out of the stored text) so each chunk links
    // to the exact page it came from — mirroring the live-crawl path in
    // firecrawl.service.ts, and crucially surviving a reconcile/reingest that only
    // has the stored text. Non-website sources (files, pasted text, single URL)
    // tag every chunk with the source URL, if any.
    const pages = source.type === "website" ? splitCrawledPages(text) : [];
    let taggedChunks: { index: number; text: string; url?: string }[];
    if (pages.length > 0) {
      taggedChunks = [];
      let globalIdx = 0;
      for (const page of pages) {
        for (const c of chunkText(page.markdown)) {
          taggedChunks.push({ index: globalIdx++, text: c.text, url: page.url || sourceUrl });
        }
      }
    } else {
      taggedChunks = chunkText(text).map((c) => ({ index: c.index, text: c.text, url: sourceUrl }));
    }

    if (taggedChunks.length === 0) {
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
    logger.info("[kb] embedding source", { sourceId, chunks: taggedChunks.length, pages: pages.length });
    const vectors = await embed(taggedChunks.map((c) => c.text));
    const pinecone = getPineconeIndex();
    const previousIds = source.pineconeIds ?? [];
    const ids = taggedChunks.map((c) => `${source._id.toString()}:${c.index}`);
    // NOTE: per __specs/04-pinecone-firecrawl.md vectors should be upserted
    // into the org-scoped namespace. The current pinecone client stub doesn't
    // expose a `.namespace()` method — once the parallel rewrite lands we
    // should switch to `pinecone.namespace(orgId).upsert(...)`.
    // Pinecone metadata rejects null, so only include `url` when present.
    await pinecone.upsert(
      taggedChunks.map((c, i) => ({
        id: ids[i]!,
        values: vectors[i]!,
        metadata: {
          organizationId: source.organizationId.toString(),
          agentId: source.agentId.toString(),
          sourceId: source._id.toString(),
          chunkIndex: c.index,
          ...(c.url ? { url: c.url } : {}),
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
    source.chunkCount = taggedChunks.length;
    source.embeddingStatus = "synced";
    source.lastSyncedAt = new Date();
    source.embeddingError = undefined;
    await source.save();
    emitKnowledgeUpdate(source);
    logger.info("[kb] ingested", { sourceId, chunks: taggedChunks.length });
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
