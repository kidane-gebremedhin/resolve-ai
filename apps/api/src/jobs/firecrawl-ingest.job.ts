// Firecrawl polling job — runs every 30s.
// Finds website-type sources currently being crawled, polls Firecrawl for
// status, and when complete pipes the resulting pages through chunk/embed/upsert
// via `ingestCrawlResults`.
//
// Crawl IDs are stashed on `embeddingError` as `firecrawl:<id>` by the
// `POST /knowledge/website` route (see `extractCrawlId` in firecrawl.service).

import type { Types } from "mongoose";
import { Agent, KnowledgeSource, WidgetSettings } from "../models/index.js";
import { logger } from "../config/logger.js";
import {
  extractCrawlId,
  ingestCrawlResults,
  pollCrawl,
} from "../services/kb/firecrawl.service.js";
import { resolveFaviconUrl } from "../services/kb/favicon.service.js";
import { emitKnowledgeUpdate } from "../services/kb/ingestion.service.js";

type CrawlPage = { metadata?: Record<string, unknown> | null };

// Best-effort: store the site favicon on the source and adopt it as the agent's
// default widget avatar when the agent has no avatar yet. The agent's *name* is
// never touched — the widget shows only the operator-configured Agent Name.
// Never throws — must not regress the synced status.
async function applySiteDefaults(sourceId: Types.ObjectId, pages: CrawlPage[]): Promise<void> {
  try {
    const source = await KnowledgeSource.findById(sourceId)
      .select({ sourceUrl: 1, agentId: 1, organizationId: 1 })
      .lean();
    if (!source) return;
    const favicon = resolveFaviconUrl(pages, source.sourceUrl);

    // Persist favicon on the knowledge-source document regardless.
    if (favicon) {
      await KnowledgeSource.updateOne({ _id: sourceId }, { $set: { faviconUrl: favicon } });
    }

    const [agent, settings] = await Promise.all([
      Agent.findById(source.agentId).select({ avatarUrl: 1, name: 1 }),
      WidgetSettings.findOne({
        organizationId: source.organizationId,
        agentId: source.agentId,
      }).select({ avatarUrl: 1 }),
    ]);

    // --- Avatar: only set when no avatar is configured anywhere ---
    const hasAvatar =
      (agent?.avatarUrl && agent.avatarUrl.length > 0) ||
      (settings?.avatarUrl && settings.avatarUrl.length > 0);
    if (agent && !hasAvatar && favicon) {
      agent.avatarUrl = favicon;
      await agent.save();
      logger.info("[firecrawl-job] set default agent avatar from favicon", {
        agentId: source.agentId.toString(),
        favicon,
      });
    }

    // NOTE: we intentionally do NOT derive the agent's name from the website
    // <title>. The widget must refer only to the agent's own identity (the
    // "Agent Name" configured in Widget Studio), never the organization or
    // website name — so scraping never touches `agent.name`.
  } catch (err) {
    logger.warn("[firecrawl-job] site-defaults step failed (non-fatal)", {
      sourceId: sourceId.toString(),
      err: (err as Error).message,
    });
  }
}

const BATCH = 20;

type ProcessingSource = {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
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
      .select({ _id: 1, organizationId: 1, embeddingError: 1, retryCount: 1 })
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
        const errMsg = `firecrawl crawl failed (${crawlId})`;
        await KnowledgeSource.updateOne(
          { _id: src._id },
          { $set: { embeddingStatus: "error", embeddingError: errMsg }, $inc: { retryCount: 1 } },
        );
        emitKnowledgeUpdate({
          _id: src._id,
          organizationId: src.organizationId,
          embeddingStatus: "error",
          embeddingError: errMsg,
        });
        logger.error("[firecrawl-job] crawl failed", { sourceId: id, crawlId });
        continue;
      }

      // status === "completed"
      const pages = status.data ?? [];
      await ingestCrawlResults(id, pages);
      // Best-effort site defaults → widget title + agent avatar (never regresses sync status).
      await applySiteDefaults(src._id, pages as CrawlPage[]);
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
        emitKnowledgeUpdate({
          _id: src._id,
          organizationId: src.organizationId,
          embeddingStatus: "error",
          embeddingError: message,
        });
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
