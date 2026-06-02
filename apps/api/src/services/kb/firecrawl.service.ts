// Firecrawl ingestion — submits crawl, polls, then ingests each discovered page
// as its own knowledge source. Phase 3 wiring; the call shape matches Firecrawl v1.

import { KnowledgeSource } from "../../models/index.js";
import { chunkText } from "../../utils/chunker.js";
import { embed } from "../ai/embedding.service.js";
import { getPineconeIndex } from "../../config/pinecone.js";
import { logger } from "../../config/logger.js";
import { hashContent } from "./ingestion.service.js";

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

export async function getCrawlStatus(id: string): Promise<CrawlStatus> {
  return fc<CrawlStatus>(`/crawl/${id}`);
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

  // Concatenate page markdown with a clear separator so chunking respects boundaries.
  const text = pages
    .filter((p) => p.markdown?.trim().length > 0)
    .map((p) => `# ${p.url}\n\n${p.markdown}`)
    .join("\n\n---\n\n");

  source.extractedText = text;
  source.contentHash = hashContent(text || `${source._id.toString()}:${pages.length}`);
  await source.save();

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    source.embeddingStatus = "synced";
    source.chunkCount = 0;
    source.lastSyncedAt = new Date();
    source.embeddingError = undefined;
    await source.save();
    logger.info("[kb] crawl produced no text", { sourceId, pages: pages.length });
    return;
  }

  const vectors = await embed(chunks.map((c) => c.text));
  const pinecone = getPineconeIndex();
  const ids = chunks.map((c) => `${source._id.toString()}:${c.index}`);
  // NOTE: per __specs/04-pinecone-firecrawl.md upsert into namespace=orgId
  // once the parallel pinecone.ts rewrite exposes `.namespace(orgId)`.
  await pinecone.upsert(
    chunks.map((c, i) => ({
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
        // Store the full chunk (capped at 8000) like the text/file path, not a
        // 500-char preview — retrieval returns this text to the model verbatim.
        text: c.text.slice(0, 8000),
      },
    })),
  );

  source.pineconeIds = ids;
  source.chunkCount = chunks.length;
  source.embeddingStatus = "synced";
  source.lastSyncedAt = new Date();
  source.embeddingError = undefined;
  await source.save();
  logger.info("[kb] crawl ingested", { sourceId, pages: pages.length, chunks: chunks.length });
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
