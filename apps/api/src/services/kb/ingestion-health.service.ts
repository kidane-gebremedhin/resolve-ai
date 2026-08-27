// Org-level ingestion health, and the alert that fires when it degrades.
//
// Feeds the operator dashboard and answers the question a status column cannot:
// not "is this source broken" but "is something systematically wrong with this
// workspace's knowledge base".
import mongoose from "mongoose";
import { IngestionEvent, KnowledgeSource } from "../../models/index.js";
import { createNotification } from "../notification.service.js";
import { logger } from "../../config/logger.js";
import { env } from "../../config/env.js";
import { describeError, type IngestionErrorCode } from "./ingestion-errors.js";

export type IngestionHealth = {
  byStatus: Record<string, number>;
  totalSources: number;
  failing: number;
  failureRate: number;
  byErrorClass: { code: string; count: number; message: string; action: string }[];
  meanDurationMsByType: { type: string; meanMs: number; runs: number }[];
  /** Sources the reconcile job is actively retrying or recovering right now. */
  inRecovery: { retrying: number; stuckProcessing: number; exhausted: number };
};

export async function ingestionHealth(organizationId: string): Promise<IngestionHealth> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [statusCounts, errorClasses, durations, exhausted, stuck] = await Promise.all([
    KnowledgeSource.aggregate<{ _id: string; count: number }>([
      { $match: { organizationId: toId(organizationId) } },
      { $group: { _id: "$embeddingStatus", count: { $sum: 1 } } },
    ]),
    IngestionEvent.aggregate<{ _id: string; count: number }>([
      { $match: { organizationId: toId(organizationId), status: "error", createdAt: { $gte: since } } },
      { $group: { _id: "$errorCode", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    // Mean duration by source type needs the type, which lives on the source.
    IngestionEvent.aggregate<{ _id: string; meanMs: number; runs: number }>([
      { $match: { organizationId: toId(organizationId), status: "ok", durationMs: { $gt: 0 }, createdAt: { $gte: since } } },
      {
        $lookup: {
          from: "knowledgesources",
          localField: "sourceId",
          foreignField: "_id",
          as: "source",
        },
      },
      { $unwind: "$source" },
      { $group: { _id: "$source.type", meanMs: { $avg: "$durationMs" }, runs: { $sum: 1 } } },
      { $sort: { meanMs: -1 } },
    ]),
    KnowledgeSource.countDocuments({
      organizationId,
      embeddingStatus: "error",
      retryCount: { $gte: env.kb.ingestMaxRetries },
    }),
    KnowledgeSource.countDocuments({
      organizationId,
      embeddingStatus: "processing",
      updatedAt: { $lt: new Date(Date.now() - env.kb.ingestStuckProcessingMs) },
    }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of statusCounts) byStatus[row._id] = row.count;

  const totalSources = Object.values(byStatus).reduce((a, b) => a + b, 0);
  // `empty` counts as failing: it retrieves nothing, which is the whole point of
  // giving it its own status rather than leaving it to look like a success.
  const failing = (byStatus.error ?? 0) + (byStatus.empty ?? 0);

  return {
    byStatus,
    totalSources,
    failing,
    failureRate: totalSources === 0 ? 0 : failing / totalSources,
    byErrorClass: errorClasses.map((e) => {
      const described = describeError((e._id as IngestionErrorCode) ?? "unknown");
      return { code: e._id ?? "unknown", count: e.count, message: described.message, action: described.action };
    }),
    meanDurationMsByType: durations.map((d) => ({
      type: d._id,
      meanMs: Math.round(d.meanMs),
      runs: d.runs,
    })),
    inRecovery: {
      retrying: Math.max(0, (byStatus.error ?? 0) - exhausted),
      stuckProcessing: stuck,
      exhausted,
    },
  };
}

/**
 * Aggregations need a real ObjectId.
 *
 * `find({ organizationId })` coerces a string, `$match` does not — it compares
 * the raw BSON type and silently matches nothing, which is the kind of bug that
 * shows up as an empty dashboard rather than an error.
 */
function toId(id: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(id);
}

/**
 * Raise an operator alert when an org's ingestion is broadly failing.
 *
 * Rate rather than count, with a floor: one broken upload in a workspace of
 * three is noise, a third of a hundred-source corpus failing is not. The floor
 * is what stops a brand-new workspace alerting on its first bad PDF.
 */
export async function alertOnIngestionFailures(organizationId: string): Promise<void> {
  try {
    const health = await ingestionHealth(organizationId);
    if (health.totalSources < env.kb.ingestFailureAlertMinSources) return;
    if (health.failureRate < env.kb.ingestFailureAlertRate) return;

    const worst = health.byErrorClass[0];
    await createNotification({
      organizationId,
      type: "kb_ingestion_failing",
      level: "warning",
      title: `${health.failing} of ${health.totalSources} knowledge sources are not indexed`,
      body: worst
        ? `Most common cause: ${worst.message} ${worst.action}`
        : "Open Knowledge to see which sources failed and why.",
      link: "/app/knowledge",
    });
    logger.warn("[kb] ingestion failure alert raised", {
      organizationId,
      failing: health.failing,
      total: health.totalSources,
    });
  } catch (err) {
    // An alert must never break the loop that noticed the problem.
    logger.warn("[kb] ingestion failure alert failed", { err: (err as Error).message });
  }
}
