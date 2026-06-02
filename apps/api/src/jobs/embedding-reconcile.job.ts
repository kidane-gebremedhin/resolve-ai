// Embedding reconciliation job — runs every 60s.
// - Retries sources stuck in `error` (retryCount < 3) by re-queueing ingestion.
// - Finalises sources marked `deleting` by purging their Pinecone vectors and
//   removing the document.
//
// Each iteration is wrapped in its own try/catch so a single bad source can't
// kill the loop. Batches are limited to 20 sources per status per tick to keep
// the cycle bounded.

import { KnowledgeSource } from "../models/index.js";
import { logger } from "../config/logger.js";
import { ingestSource, purgeSourceVectors } from "../services/kb/ingestion.service.js";

const BATCH = 20;
const MAX_RETRIES = 3;
// A source that's been `processing` longer than this was almost certainly
// interrupted (e.g. the API restarted mid-ingest), leaving partial vectors.
// Re-ingesting is idempotent (same vector ids are overwritten).
const STUCK_PROCESSING_MS = 15 * 60 * 1000;

export async function reconcileOnce(): Promise<void> {
  // 1) Retry errored sources that haven't exhausted their retry budget.
  try {
    const errored = await KnowledgeSource.find({
      embeddingStatus: "error",
      retryCount: { $lt: MAX_RETRIES },
    })
      .limit(BATCH)
      .select({ _id: 1, retryCount: 1 });

    for (const src of errored) {
      const id = src._id.toString();
      try {
        await KnowledgeSource.updateOne(
          { _id: src._id },
          { $set: { embeddingStatus: "pending" }, $inc: { retryCount: 1 } },
        );
        await ingestSource(id);
        logger.info("[reconcile] retried errored source", { sourceId: id });
      } catch (err) {
        logger.error("[reconcile] retry failed", { sourceId: id, err: (err as Error).message });
      }
    }
  } catch (err) {
    logger.error("[reconcile] errored-batch query failed", { err: (err as Error).message });
  }

  // 1b) Recover ingests interrupted by a restart — sources stuck in
  //     `processing` well past any reasonable ingest time get re-queued.
  try {
    const cutoff = new Date(Date.now() - STUCK_PROCESSING_MS);
    const stuck = await KnowledgeSource.find({
      embeddingStatus: "processing",
      updatedAt: { $lt: cutoff },
    })
      .limit(BATCH)
      .select({ _id: 1 });

    for (const src of stuck) {
      const id = src._id.toString();
      try {
        await ingestSource(id);
        logger.info("[reconcile] recovered stuck 'processing' source", { sourceId: id });
      } catch (err) {
        logger.error("[reconcile] stuck-processing recovery failed", {
          sourceId: id,
          err: (err as Error).message,
        });
      }
    }
  } catch (err) {
    logger.error("[reconcile] processing-batch query failed", { err: (err as Error).message });
  }

  // 2) Finalise deletions — purge vectors then drop the document.
  try {
    const deleting = await KnowledgeSource.find({ embeddingStatus: "deleting" })
      .limit(BATCH)
      .select({ _id: 1, pineconeIds: 1 });

    for (const src of deleting) {
      const id = src._id.toString();
      try {
        await purgeSourceVectors(id);
        await KnowledgeSource.deleteOne({ _id: src._id });
        logger.info("[reconcile] purged source", { sourceId: id });
      } catch (err) {
        logger.error("[reconcile] purge failed", { sourceId: id, err: (err as Error).message });
      }
    }
  } catch (err) {
    logger.error("[reconcile] deleting-batch query failed", { err: (err as Error).message });
  }
}
