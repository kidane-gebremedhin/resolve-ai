// Firecrawl ingestion — submits crawl, polls, then ingests each discovered page
// as its own knowledge source. Phase 3 wiring; the call shape matches Firecrawl v1.

import { KnowledgeSource } from "../../models/index.js";
import { logger } from "../../config/logger.js";
import { assertStorableText, emitKnowledgeUpdate, hashContent, ingestSource } from "./ingestion.service.js";
import { classifyError } from "./ingestion-errors.js";

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
 * Ingest a completed crawl's pages for a website KnowledgeSource.
 *
 * Stores the pages as one text ("# <pageUrl>" blocks, which `splitCrawledPages`
 * reads back so every chunk keeps its exact page URL for citations), then runs
 * the same `ingestSource` pipeline as every other source type.
 *
 * This used to chunk, embed and upsert on its own. That copy never wrote the
 * KbChunk mirror (so crawled pages were invisible to the lexical leg and served
 * truncated text), recorded no ingestion events, dropped heading paths, and
 * reported an empty crawl as `synced` (__specs/37 I1). One pipeline means a
 * fix to ingestion is a fix for crawls too.
 *
 * Failures inside `ingestSource` are already recorded on the source (status,
 * classified error, retry count) before it rethrows.
 */
export async function ingestCrawlResults(sourceId: string, pages: CrawlPage[]): Promise<void> {
  const source = await KnowledgeSource.findById(sourceId);
  if (!source) throw new Error(`KB source not found: ${sourceId}`);

  const validPages = pages.filter((p) => p.markdown?.trim().length > 0);
  const text = validPages
    .map((p) => `# ${p.url}\n\n${p.markdown}`)
    .join("\n\n---\n\n");

  try {
    assertStorableText(text);
  } catch (err) {
    // Recorded here, classified, because the row cannot reach `ingestSource`.
    const e = classifyError(err, "parse");
    source.embeddingStatus = "error";
    source.embeddingError = e.message;
    source.embeddingErrorCode = e.code;
    source.embeddingErrorAction = e.action;
    await source.save();
    emitKnowledgeUpdate(source);
    logger.warn("[kb] crawl text too large to store", { sourceId, pages: pages.length });
    return;
  }

  source.extractedText = text;
  source.contentHash = hashContent(text || `${source._id.toString()}:${pages.length}`);
  // `ingestSource` reloads the row, so it cannot see that the hash moved.
  // Stamp content recency here, where the change is known.
  if (source.isModified("contentHash") || !source.sourceUpdatedAt) {
    source.sourceUpdatedAt = new Date();
  }
  await source.save();

  await ingestSource(sourceId);
  logger.info("[kb] crawl ingested", { sourceId, pages: pages.length, withText: validPages.length });
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
