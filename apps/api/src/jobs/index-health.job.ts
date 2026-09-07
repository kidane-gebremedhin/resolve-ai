// Index health, on a timer. Conservative by construction.
//
// TWO THINGS ONLY:
//   1. Re-embed sources whose stored text no longer matches the hash the
//      embeddings were built from. This is drift repair, not a reindex: the
//      query selects on the mismatch, so a corpus that has not drifted costs
//      one indexed find and nothing else.
//   2. Notify an operator that weak chunks are waiting for review.
//
// IT NEVER DELETES AND NEVER EDITS CUSTOMER KNOWLEDGE. The destructive repairs
// live behind operator-confirmed routes it does not import, and
// `index-health.test.ts` asserts the absence rather than trusting this comment.
//
// OFF BY DEFAULT (`KB_INDEX_HEALTH_ENABLED`). The scoring has to be watched
// against real traffic before a job is allowed to act on it.

import mongoose from "mongoose";
import {
  KnowledgeSource,
  Notification,
  RagTurnMetric,
} from "../models/index.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { createNotification } from "../services/notification.service.js";
import { hashContent, ingestSource } from "../services/kb/ingestion.service.js";
import { scoreChunks } from "../services/kb/index-health.service.js";

/** One alert per org per day, so a corpus that stays weak is not a pager loop. */
const REVIEW_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * How many sources one nightly pass will examine for drift.
 *
 * Bounds the WORK, not the memory — the scan streams (see `findDriftedSources`),
 * so a bigger number costs time rather than heap. A corpus larger than this is
 * checked over successive nights, newest first.
 */
const MAX_DRIFT_SCAN = 5000;

/**
 * Whether this tick is inside the configured off-peak hour.
 *
 * Re-embedding competes with live retrieval for the same provider quota, and a
 * repair that slows the thing it is repairing is not a repair.
 */
export function isOffPeak(now: Date = new Date(), hourUtc = env.kb.indexHealthHourUtc): boolean {
  return now.getUTCHours() === hourUtc;
}

/**
 * Sources whose stored text has moved on from the hash their vectors were built
 * from.
 *
 * Compared in the API rather than with a `$expr` because the hash is a
 * normalising one (lowercased, whitespace collapsed) and MongoDB cannot compute
 * it. The candidate set is bounded by the same cap that bounds the repair.
 */
export async function findDriftedSources(limit: number): Promise<
  { _id: mongoose.Types.ObjectId; organizationId: mongoose.Types.ObjectId; currentHash: string }[]
> {
  const drifted: {
    _id: mongoose.Types.ObjectId;
    organizationId: mongoose.Types.ObjectId;
    currentHash: string;
  }[] = [];

  // STREAMED, one document at a time.
  //
  // The obvious version — `.find(...).limit(1000).lean()` — loads a thousand
  // documents INCLUDING their full `extractedText`. A crawled website's text is
  // routinely megabytes, so that is an unbounded memory spike in a job nobody is
  // watching, sized by the customer's largest documents rather than by anything
  // this code chose. A cursor holds one document at a time regardless.
  //
  // The scan is still capped, and it stops the moment enough drift is found:
  // the common case on a healthy corpus is that nothing has drifted, and that
  // case costs one indexed pass and no repairs.
  const cursor = KnowledgeSource.find(
    { embeddingStatus: { $in: ["synced", "empty"] } },
    { contentHash: 1, extractedText: 1, content: 1, organizationId: 1 },
  )
    .sort({ updatedAt: -1 })
    .limit(MAX_DRIFT_SCAN)
    .lean()
    .cursor();

  try {
    for await (const s of cursor) {
      const text = (s.extractedText as string | undefined) ?? (s.content as string | undefined) ?? "";
      if (!text) continue;
      const currentHash = hashContent(text);
      if (currentHash === s.contentHash) continue;
      drifted.push({
        _id: s._id as mongoose.Types.ObjectId,
        organizationId: s.organizationId as mongoose.Types.ObjectId,
        currentHash,
      });
      if (drifted.length >= limit) break;
    }
  } finally {
    // Break leaves the cursor open on the server otherwise.
    await cursor.close();
  }

  return drifted;
}

async function alertedRecently(organizationId: string): Promise<boolean> {
  const existing = await Notification.findOne({
    organizationId: new mongoose.Types.ObjectId(organizationId),
    type: "kb_weak_chunks",
    createdAt: { $gte: new Date(Date.now() - REVIEW_ALERT_COOLDOWN_MS) },
  })
    .select("_id")
    .lean();
  return Boolean(existing);
}

/** Score one org's chunks and raise a review notification if anything is weak. */
async function flagWeakChunksForOrg(organizationId: string): Promise<number> {
  const report = await scoreChunks({ organizationId, limit: 1 });
  const { misleading, retrievedNotCited, deadWeight, truncated } = report.totals;
  const actionable = misleading + retrievedNotCited;
  if (actionable === 0) return 0;
  if (await alertedRecently(organizationId)) return actionable;

  await createNotification({
    organizationId,
    type: "kb_weak_chunks",
    level: "warning",
    title: `${actionable} knowledge passages need review`,
    body:
      `${misleading} passage(s) are being cited in answers customers thumbed down, and ` +
      `${retrievedNotCited} are retrieved but never quoted, which usually means they are split badly. ` +
      `${deadWeight} more were never retrieved at all. Nothing has been changed.` +
      // An operator reading "0 were never retrieved" should not be left thinking
      // the whole index was examined when only the first slice of it was.
      (truncated
        ? ` Note: this covers the first ${report.totals.scanLimit.toLocaleString("en-US")} passages of a larger index.`
        : ""),
    link: "/app/analytics/rag",
  });
  return actionable;
}

/**
 * One tick. Never throws: the orchestrator treats a throw here as an
 * orchestrator bug, and this job's failures are its own business.
 */
export async function indexHealthOnce(now: Date = new Date()): Promise<{
  ran: boolean;
  reembedded: number;
  orgsFlagged: number;
}> {
  const idle = { ran: false, reembedded: 0, orgsFlagged: 0 };
  if (!env.kb.indexHealthEnabled) return idle;
  if (!isOffPeak(now)) return idle;

  let reembedded = 0;
  let orgsFlagged = 0;

  try {
    // ---- Drift repair ----
    const drifted = await findDriftedSources(env.kb.indexHealthMaxReembedPerRun);
    for (const source of drifted) {
      const sourceId = source._id.toString();
      try {
        // Stamp the new hash BEFORE re-embedding. `sourceUpdatedAt` moves with
        // it because the content genuinely changed, which is what conflict
        // resolution reads. Without this the next tick would find the same
        // source drifted and re-embed it forever.
        await KnowledgeSource.updateOne(
          { _id: source._id },
          { $set: { contentHash: source.currentHash, sourceUpdatedAt: new Date() } },
        );
        await ingestSource(sourceId);
        reembedded += 1;
        logger.info("[jobs] re-embedded drifted source", { sourceId });
      } catch (err) {
        logger.error("[jobs] drift re-embed failed", { sourceId, err: (err as Error).message });
      }
    }

    // ---- Weak chunk review ----
    const since = new Date(Date.now() - env.kb.healthWindowDays * 24 * 60 * 60 * 1000);
    const orgIds = await RagTurnMetric.distinct("organizationId", { createdAt: { $gte: since } });
    for (const id of orgIds) {
      try {
        if ((await flagWeakChunksForOrg(String(id))) > 0) orgsFlagged += 1;
      } catch (err) {
        logger.warn("[jobs] weak chunk scoring failed", {
          organizationId: String(id),
          err: (err as Error).message,
        });
      }
    }
  } catch (err) {
    logger.error("[jobs] index health tick failed", { err: (err as Error).message });
  }

  logger.info("[jobs] index health tick", { reembedded, orgsFlagged });
  return { ran: true, reembedded, orgsFlagged };
}
