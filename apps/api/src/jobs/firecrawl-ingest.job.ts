// Firecrawl polling job — runs every 30s.
// Finds website-type sources currently being crawled, polls Firecrawl for
// status, and when complete pipes the resulting pages through chunk/embed/upsert
// via `ingestCrawlResults`.
//
// Crawl IDs are stashed on `embeddingError` as `firecrawl:<id>` by the
// `POST /knowledge/website` route (see `extractCrawlId` in firecrawl.service).

import type { Types } from "mongoose";
import { KnowledgeSource } from "../models/index.js";
import { logger } from "../config/logger.js";
import {
  extractCrawlId,
  ingestCrawlResults,
  pollCrawl,
} from "../services/kb/firecrawl.service.js";

const BATCH = 20;

type ProcessingSource = {
  _id: Types.ObjectId;
  embeddingError?: string | null;
  retryCount?: number | null;
};

export async function firecrawlPollOnce(): Promise<void> {
  let candidates: ProcessingSource[];
  try {
    candidates = (await KnowledgeSource.find({
      type: "website",
      embeddingStatus: "processing",
    })
      .limit(BATCH)
      .select({ _id: 1, embeddingError: 1, retryCount: 1 })
      .lean()) as ProcessingSource[];
  } catch (err) {
    logger.error("[firecrawl-job] query failed", { err: (err as Error).message });
    return;
  }

  for (const src of candidates) {
    const id = src._id.toString();
    const crawlId = extractCrawlId(src.embeddingError ?? undefined);
    if (!crawlId) {
      // No crawl ID stashed — nothing to poll. Leave for the reconcile job.
      logger.debug?.("[firecrawl-job] no crawlId on processing source", { sourceId: id });
      continue;
    }

    try {
      const status = await pollCrawl(crawlId);
      if (status.status === "scraping") {
        // Still working; check again next tick.
        continue;
      }

      if (status.status === "failed") {
        await KnowledgeSource.updateOne(
          { _id: src._id },
          {
            $set: { embeddingStatus: "error", embeddingError: `firecrawl crawl failed (${crawlId})` },
            $inc: { retryCount: 1 },
          },
        );
        logger.error("[firecrawl-job] crawl failed", { sourceId: id, crawlId });
        continue;
      }

      // status === "completed"
      const pages = status.data ?? [];
      await ingestCrawlResults(id, pages);
    } catch (err) {
      const message = (err as Error).message;
      try {
        await KnowledgeSource.updateOne(
          { _id: src._id },
          {
            $set: { embeddingStatus: "error", embeddingError: message },
            $inc: { retryCount: 1 },
          },
        );
      } catch (updateErr) {
        logger.error("[firecrawl-job] failed to mark source errored", {
          sourceId: id,
          err: (updateErr as Error).message,
        });
      }
      logger.error("[firecrawl-job] poll/ingest failed", { sourceId: id, err: message });
    }
  }
}
