// Embedding reconciliation job — runs every 60s.
//
// Three responsibilities, and the first two predate the ingestion-observability
// work: retrying failed sources, recovering ones interrupted mid-ingest, and
// finalising deletions. What changed is that the retry is no longer blind and no
// longer invisible.
//
// BEFORE: every failure was retried identically, up to three times, on a flat
// 60s loop. An unsupported file type burned its three attempts in three minutes
// and then sat silent forever, indistinguishable from a rate limit that would
// have succeeded on the fourth. Nothing was surfaced to an operator.
//
// NOW the taxonomy decides: permanent classes consume no attempts and go
// straight to a terminal state, transient ones back off exponentially, and
// budget-exceeded waits without burning attempts. Every retry and recovery emits
// an ingestion event, so an operator can see that a source has been silently
// re-ingested four times rather than only its latest status.
//
// Each iteration is wrapped in its own try/catch so a single bad source can't
// kill the loop. Batches are limited per status per tick to keep the cycle
// bounded.

import { KnowledgeSource } from "../models/index.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";
import { ingestSource, purgeSourceVectors } from "../services/kb/ingestion.service.js";
import { recordIngestionEvent } from "../services/kb/ingestion-events.js";
import {
  describeError,
  isDeferred,
  isPermanent,
  type IngestionErrorCode,
} from "../services/kb/ingestion-errors.js";
import { alertOnIngestionFailures } from "../services/kb/ingestion-health.service.js";

const BATCH = 20;

/**
 * How long to wait before retrying attempt N.
 *
 * Exponential, because the flat 60s loop retried a rate-limited provider at
 * exactly the rate that got us limited in the first place.
 */
function backoffFor(attempt: number): number {
  return env.kb.ingestRetryBackoffMs * 2 ** Math.max(0, attempt - 1);
}

/** Whether enough time has passed since the last attempt to try again. */
function backoffElapsed(source: { updatedAt?: Date; retryCount?: number }): boolean {
  const last = source.updatedAt ? new Date(source.updatedAt).getTime() : 0;
  return Date.now() - last >= backoffFor(source.retryCount ?? 1);
}

export async function reconcileOnce(): Promise<void> {
  // 1) Retry errored sources — but only the ones retrying can actually help.
  try {
    const errored = await KnowledgeSource.find({
      embeddingStatus: "error",
      retryCount: { $lt: env.kb.ingestMaxRetries },
    })
      .limit(BATCH)
      .select({
        _id: 1,
        organizationId: 1,
        agentId: 1,
        retryCount: 1,
        updatedAt: 1,
        embeddingErrorCode: 1,
      });

    for (const src of errored) {
      const id = src._id.toString();
      const code = (src.embeddingErrorCode as IngestionErrorCode | undefined) ?? "unknown";

      // Permanent: retrying cannot help, so stop consuming the loop and make it
      // terminal and visible instead of leaving it to churn and then go quiet.
      if (isPermanent(code)) {
        const classified = describeError(code);
        await KnowledgeSource.updateOne(
          { _id: src._id },
          {
            $set: {
              retryCount: env.kb.ingestMaxRetries,
              embeddingErrorAction: classified.action,
            },
          },
        );
        await recordIngestionEvent({
          sourceId: id,
          organizationId: src.organizationId.toString(),
          agentId: src.agentId?.toString(),
          stage: "retry",
          status: "skipped",
          errorCode: code,
          errorMessage: `Not retried: ${classified.message}`,
          errorAction: classified.action,
        });
        // Latch and alert here rather than letting the exhausted-retries branch
        // pick it up on the same tick: that would record the same failure twice
        // and describe a permanent error as "ran out of attempts", which is the
        // wrong diagnosis to hand an operator.
        await KnowledgeSource.updateOne({ _id: src._id }, { $set: { ingestAlerted: true } });
        await alertOnIngestionFailures(src.organizationId.toString());
        logger.info("[kb] permanent failure, not retrying", { sourceId: id, code });
        continue;
      }

      // Budget: an external condition we are waiting on, not a failure to retry
      // against. Burning attempts here would exhaust them before the budget ever
      // resets, leaving the source stranded for the rest of the month.
      if (isDeferred(code)) {
        await recordIngestionEvent({
          sourceId: id,
          organizationId: src.organizationId.toString(),
          agentId: src.agentId?.toString(),
          stage: "retry",
          status: "skipped",
          errorCode: code,
          errorMessage: "Waiting for the AI budget to reset. No retries consumed.",
        });
        continue;
      }

      if (!backoffElapsed(src as { updatedAt?: Date; retryCount?: number })) continue;

      const attempt = (src.retryCount ?? 0) + 1;
      try {
        await KnowledgeSource.updateOne(
          { _id: src._id },
          { $set: { embeddingStatus: "pending" }, $inc: { retryCount: 1 } },
        );
        await recordIngestionEvent({
          sourceId: id,
          organizationId: src.organizationId.toString(),
          agentId: src.agentId?.toString(),
          stage: "retry",
          status: "ok",
          attempt,
          errorMessage: `Retrying after ${code} (attempt ${attempt} of ${env.kb.ingestMaxRetries})`,
        });
        await ingestSource(id);
        logger.info("[kb] retried errored source", { sourceId: id, attempt, code });
      } catch (err) {
        logger.error("[kb] retry failed", { sourceId: id, err: (err as Error).message });
      }
    }
  } catch (err) {
    logger.error("[kb] errored-batch query failed", { err: (err as Error).message });
  }

  // 1a) A source that has exhausted its retries must raise something rather
  //     than going quiet, which is precisely what used to happen.
  try {
    const exhausted = await KnowledgeSource.find({
      embeddingStatus: "error",
      retryCount: { $gte: env.kb.ingestMaxRetries },
      ingestAlerted: { $ne: true },
    })
      .limit(BATCH)
      .select({ _id: 1, organizationId: 1, agentId: 1, title: 1, embeddingErrorCode: 1 });

    for (const src of exhausted) {
      const code = (src.embeddingErrorCode as IngestionErrorCode | undefined) ?? "unknown";
      await recordIngestionEvent({
        sourceId: src._id.toString(),
        organizationId: src.organizationId.toString(),
        agentId: src.agentId?.toString(),
        stage: "retry",
        status: "error",
        errorCode: code,
        errorMessage: describeError(code).message,
        errorAction: describeError(code).action,
      });
      // Latch, so an unresolved source does not re-alert every 60 seconds.
      await KnowledgeSource.updateOne({ _id: src._id }, { $set: { ingestAlerted: true } });
      await alertOnIngestionFailures(src.organizationId.toString());
    }
  } catch (err) {
    logger.error("[kb] exhausted-batch query failed", { err: (err as Error).message });
  }

  // 2) Recover ingests interrupted by a restart — sources stuck in `processing`
  //    well past any reasonable ingest time get re-queued.
  try {
    const cutoff = new Date(Date.now() - env.kb.ingestStuckProcessingMs);
    const stuck = await KnowledgeSource.find({
      embeddingStatus: "processing",
      updatedAt: { $lt: cutoff },
    })
      .limit(BATCH)
      .select({ _id: 1, organizationId: 1, agentId: 1, type: 1, embeddingError: 1 });

    for (const src of stuck) {
      const id = src._id.toString();

      // A website source mid-crawl is NOT stuck. `POST /knowledge/website`
      // parks the crawl id in `embeddingError` as `firecrawl:<id>` and leaves
      // the source in `processing` while the poll job waits for Firecrawl —
      // which routinely takes longer than the stuck threshold. Re-ingesting it
      // here would clobber the crawl id and strand the crawl permanently.
      if (src.type === "website" && (src.embeddingError ?? "").startsWith("firecrawl:")) {
        continue;
      }

      try {
        await recordIngestionEvent({
          sourceId: id,
          organizationId: src.organizationId.toString(),
          agentId: src.agentId?.toString(),
          stage: "recover",
          status: "ok",
          errorMessage: "Ingest was interrupted (likely a restart) and has been re-queued.",
        });
        await ingestSource(id);
        logger.info("[kb] recovered stuck 'processing' source", { sourceId: id });
      } catch (err) {
        logger.error("[kb] stuck-processing recovery failed", {
          sourceId: id,
          err: (err as Error).message,
        });
      }
    }
  } catch (err) {
    logger.error("[kb] processing-batch query failed", { err: (err as Error).message });
  }

  // 3) Finalise deletions — purge vectors then drop the document.
  try {
    const deleting = await KnowledgeSource.find({ embeddingStatus: "deleting" })
      .limit(BATCH)
      .select({ _id: 1, pineconeIds: 1 });

    for (const src of deleting) {
      const id = src._id.toString();
      try {
        await purgeSourceVectors(id);
        await KnowledgeSource.deleteOne({ _id: src._id });
        logger.info("[kb] purged source", { sourceId: id });
      } catch (err) {
        logger.error("[kb] purge failed", { sourceId: id, err: (err as Error).message });
      }
    }
  } catch (err) {
    logger.error("[kb] deleting-batch query failed", { err: (err as Error).message });
  }
}
