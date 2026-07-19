// Firecrawl ingestion — submits crawl, polls, then ingests each discovered page
// as its own knowledge source. Phase 3 wiring; the call shape matches Firecrawl v1.

import { KnowledgeSource } from "../../models/index.js";
import { chunkText } from "../../utils/chunker.js";
import { embed } from "../ai/embedding.service.js";
import { getPineconeIndex } from "../../config/pinecone.js";
import { logger } from "../../config/logger.js";
import { hashContent, emitKnowledgeUpdate } from "./ingestion.service.js";

const baseUrl = process.env.FIRECRAWL_BASE_URL ?? "https://api.firecrawl.dev/v1";
const apiKey = process.env.FIRECRAWL_API_KEY;
const maxPages = Number(process.env.FIRECRAWL_MAX_PAGES ?? "50");

async function fc<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not configured");
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Firecrawl ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export async function startCrawl(url: string): Promise<{ id: string }> {
  return fc<{ id: string }>("/crawl", {
    method: "POST",
    body: JSON.stringify({ url, limit: maxPages }),
  });
}

export type CrawlPage = { url: string; markdown: string };
export type CrawlStatus = {
  status: "scraping" | "completed" | "failed";
  data?: CrawlPage[];
};

// Firecrawl returns each page's URL under `metadata.sourceURL` (falling back to
// `metadata.url`/`metadata.ogUrl`), NOT a top-level `url`. Without this mapping
// every chunk's page URL is undefined and citations collapse to the site's base
// URL instead of the exact page (e.g. `/pricing`).
type RawCrawlPage = {
  markdown?: string;
  url?: string;
  metadata?: { sourceURL?: string; url?: string; ogUrl?: string };
};
type RawCrawlStatus = { status: CrawlStatus["status"]; data?: RawCrawlPage[] };

function pageUrl(p: RawCrawlPage): string {
  return p.metadata?.sourceURL ?? p.metadata?.url ?? p.metadata?.ogUrl ?? p.url ?? "";
}

export async function getCrawlStatus(id: string): Promise<CrawlStatus> {
  const raw = await fc<RawCrawlStatus>(`/crawl/${id}`);
  return {
    status: raw.status,
    data: raw.data?.map((p) => ({ url: pageUrl(p), markdown: p.markdown ?? "" })),
  };
}

/**
 * Convenience wrapper used by the polling job — same as `getCrawlStatus` but
 * named to read naturally at the call site (`await pollCrawl(id)`).
 */
export async function pollCrawl(id: string): Promise<CrawlStatus> {
  return getCrawlStatus(id);
}

/**
 * Ingest a completed crawl's pages into Pinecone for a website KnowledgeSource.
 * Each page is chunked, embedded, and upserted; the resulting vector IDs are
 * stored on the source document along with the concatenated extracted text.
 *
 * On success: status='synced', chunkCount + pineconeIds set, lastSyncedAt now.
 * On failure: status='error', retryCount++ — the caller (the job) handles the
 * outer try/catch so it can log per-source.
 */
export async function ingestCrawlResults(sourceId: string, pages: CrawlPage[]): Promise<void> {
  const source = await KnowledgeSource.findById(sourceId);
  if (!source) throw new Error(`KB source not found: ${sourceId}`);

  // Chunk each page SEPARATELY so every chunk keeps the exact page URL it came
  // from — this is what powers per-page citations in the widget (not just the
  // site's base URL). We still persist a concatenated extractedText for display
  // and re-ingest dedup.
  const validPages = pages.filter((p) => p.markdown?.trim().length > 0);
  const text = validPages
    .map((p) => `# ${p.url}\n\n${p.markdown}`)
    .join("\n\n---\n\n");

  source.extractedText = text;
  source.contentHash = hashContent(text || `${source._id.toString()}:${pages.length}`);
  await source.save();

  // Flatten per-page chunks into a single indexed list, carrying each chunk's
  // originating page URL alongside its text.
  const taggedChunks: { index: number; text: string; url: string }[] = [];
  let globalIdx = 0;
  for (const page of validPages) {
    for (const c of chunkText(page.markdown)) {
      taggedChunks.push({ index: globalIdx++, text: c.text, url: page.url });
    }
  }

  if (taggedChunks.length === 0) {
    // A re-crawl that now yields no text must drop the previous run's vectors,
    // else stale content keeps surfacing in RAG.
    const prev = source.pineconeIds ?? [];
    if (prev.length > 0) {
      try {
        await getPineconeIndex().deleteMany(prev);
      } catch (err) {
        logger.warn("[kb] crawl empty-result cleanup failed", { sourceId, err: (err as Error).message });
      }
    }
    source.pineconeIds = [];
    source.embeddingStatus = "synced";
    source.chunkCount = 0;
    source.lastSyncedAt = new Date();
    source.embeddingError = undefined;
    await source.save();
    emitKnowledgeUpdate(source);
    logger.info("[kb] crawl produced no text", { sourceId, pages: pages.length });
    return;
  }

  const vectors = await embed(taggedChunks.map((c) => c.text));
  const pinecone = getPineconeIndex();
  const previousIds = source.pineconeIds ?? [];
  const ids = taggedChunks.map((c) => `${source._id.toString()}:${c.index}`);
  // NOTE: per __specs/04-pinecone-firecrawl.md upsert into namespace=orgId
  // once the parallel pinecone.ts rewrite exposes `.namespace(orgId)`.
  await pinecone.upsert(
    taggedChunks.map((c, i) => ({
      id: ids[i]!,
      values: vectors[i]!,
      metadata: {
        organizationId: source.organizationId.toString(),
        // MUST tag `agentId` to match the text/file ingestion path: knowledge is
        // keyed by (organizationId, agentId) and `searchKb` filters on agentId,
        // so crawl vectors without it were silently invisible to the agent's RAG.
        agentId: source.agentId.toString(),
        sourceId: source._id.toString(),
        chunkIndex: c.index,
        // Exact page URL this chunk came from — surfaced as the citation link.
        url: c.url,
        // Store the full chunk (capped at 8000) like the text/file path, not a
        // 500-char preview — retrieval returns this text to the model verbatim.
        text: c.text.slice(0, 8000),
      },
    })),
  );

  // Re-crawl cleanup: per-page chunking can yield a different chunk count than a
  // previous run, so drop any vectors from the old run the new set no longer
  // covers — otherwise stale chunks (with old text/URLs) linger and pollute
  // citations. Upsert first, then delete, so a failure never leaves zero vectors.
  const newIdSet = new Set(ids);
  const staleIds = previousIds.filter((id) => !newIdSet.has(id));
  if (staleIds.length > 0) {
    try {
      await pinecone.deleteMany(staleIds);
    } catch (err) {
      logger.warn("[kb] crawl stale-vector cleanup failed", { sourceId, err: (err as Error).message });
    }
  }

  source.pineconeIds = ids;
  source.chunkCount = taggedChunks.length;
  source.embeddingStatus = "synced";
  source.lastSyncedAt = new Date();
  source.embeddingError = undefined;
  await source.save();
  emitKnowledgeUpdate(source);
  logger.info("[kb] crawl ingested", { sourceId, pages: pages.length, chunks: taggedChunks.length });
}

/**
 * Pull the Firecrawl crawl ID out of a source. The existing
 * `POST /knowledge/website` route stashes it on `embeddingError` as
 * `firecrawl:<id>` while the crawl is in flight (the field is repurposed for
 * status until error reporting is needed). Returns null if no crawl is
 * pending for this source.
 */
export function extractCrawlId(embeddingError: string | null | undefined): string | null {
  if (!embeddingError) return null;
  const match = /^firecrawl:(.+)$/.exec(embeddingError);
  return match ? match[1]! : null;
}
