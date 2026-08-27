// Operator alerts on live RAG quality.
//
// Telemetry nobody reads is a table. These are the three rates worth waking an
// operator for, and each one has a different fix, which is why they alert
// separately rather than as one "quality" number:
//
//   no-hit         the knowledge base is missing the topics being asked about
//                  → write documents
//   low-confidence the answers are being produced but the model does not trust
//                  them → usually retrieval quality, not missing content
//   escalation     the bot is handing off → could be either, and is the one an
//                  operator feels in their own inbox before any dashboard
//
// Rate over a rolling window with a turn floor, exactly like the ingestion
// failure alert: three turns of which one missed is not a 33 percent no-hit
// rate, it is three turns.

import mongoose from "mongoose";
import { Notification, RagTurnMetric } from "../../../models/index.js";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { createNotification } from "../../notification.service.js";

export type RagQualityWindow = {
  turns: number;
  noHits: number;
  lowConfidence: number;
  escalated: number;
  noHitRate: number;
  lowConfidenceRate: number;
  escalationRate: number;
};

const EMPTY: RagQualityWindow = {
  turns: 0,
  noHits: 0,
  lowConfidence: 0,
  escalated: 0,
  noHitRate: 0,
  lowConfidenceRate: 0,
  escalationRate: 0,
};

/**
 * The three rates over one org's recent turns.
 *
 * `$match` on a real ObjectId, never a string: an aggregation compares raw BSON
 * types and a coerced string silently matches nothing, which surfaces as an
 * empty dashboard rather than an error.
 */
export async function ragQualityWindow(
  organizationId: string,
  since: Date,
): Promise<RagQualityWindow> {
  const [agg] = await RagTurnMetric.aggregate<{
    turns: number;
    noHits: number;
    lowConfidence: number;
    escalated: number;
  }>([
    {
      $match: {
        organizationId: new mongoose.Types.ObjectId(organizationId),
        createdAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: null,
        turns: { $sum: 1 },
        noHits: { $sum: { $cond: ["$flags.noHits", 1, 0] } },
        lowConfidence: { $sum: { $cond: ["$flags.lowConfidence", 1, 0] } },
        escalated: { $sum: { $cond: ["$flags.escalated", 1, 0] } },
      },
    },
  ]);

  if (!agg || agg.turns === 0) return EMPTY;
  return {
    turns: agg.turns,
    noHits: agg.noHits,
    lowConfidence: agg.lowConfidence,
    escalated: agg.escalated,
    noHitRate: agg.noHits / agg.turns,
    lowConfidenceRate: agg.lowConfidence / agg.turns,
    escalationRate: agg.escalated / agg.turns,
  };
}

type AlertSpec = {
  type: string;
  rate: number;
  threshold: number;
  count: number;
  title: string;
  body: string;
};

/**
 * One alert of a given type per org per cooldown.
 *
 * Deduped against the notifications already written rather than against a new
 * bookkeeping collection: the notification IS the record that the alert fired,
 * and a second store of the same fact is one more thing to keep in sync.
 */
async function recentlyAlerted(organizationId: string, type: string): Promise<boolean> {
  const since = new Date(Date.now() - env.rag.alertCooldownMinutes * 60_000);
  const existing = await Notification.findOne({
    organizationId: new mongoose.Types.ObjectId(organizationId),
    type,
    createdAt: { $gte: since },
  })
    .select("_id")
    .lean();
  return Boolean(existing);
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;

/** Which thresholds this window crossed, worst first. */
export function alertsForWindow(window: RagQualityWindow): AlertSpec[] {
  if (window.turns < env.rag.alertMinTurns) return [];

  const specs: AlertSpec[] = [];

  if (window.noHitRate >= env.rag.alertNoHitRate) {
    specs.push({
      type: "rag_no_hit_rate",
      rate: window.noHitRate,
      threshold: env.rag.alertNoHitRate,
      count: window.noHits,
      title: `${pct(window.noHitRate)} of recent questions found nothing in your knowledge base`,
      body:
        `${window.noHits} of the last ${window.turns} conversations retrieved no passages, so the ` +
        "assistant had nothing to answer from. Knowledge gaps lists what was asked.",
    });
  }

  if (window.lowConfidenceRate >= env.rag.alertLowConfidenceRate) {
    specs.push({
      type: "rag_low_confidence_rate",
      rate: window.lowConfidenceRate,
      threshold: env.rag.alertLowConfidenceRate,
      count: window.lowConfidence,
      title: `${pct(window.lowConfidenceRate)} of recent replies were low confidence`,
      body:
        `${window.lowConfidence} of the last ${window.turns} replies scored below the confidence ` +
        "threshold. The content is usually there but hard to retrieve: check for near-duplicate " +
        "or out-of-date documents competing with the right one.",
    });
  }

  if (window.escalationRate >= env.rag.alertEscalationRate) {
    specs.push({
      type: "rag_escalation_rate",
      rate: window.escalationRate,
      threshold: env.rag.alertEscalationRate,
      count: window.escalated,
      title: `${pct(window.escalationRate)} of recent conversations were handed to a human`,
      body:
        `${window.escalated} of the last ${window.turns} conversations escalated. That is the ` +
        "assistant declining rather than guessing, but at this rate it is doing little for you.",
    });
  }

  return specs.sort((a, b) => b.rate - a.rate);
}

/** Evaluate one org's window and raise whatever it crossed. Never throws. */
export async function checkRagQualityAlerts(organizationId: string): Promise<void> {
  if (!env.rag.alertsEnabled) return;
  try {
    const since = new Date(Date.now() - env.rag.alertWindowMinutes * 60_000);
    const window = await ragQualityWindow(organizationId, since);
    for (const spec of alertsForWindow(window)) {
      if (await recentlyAlerted(organizationId, spec.type)) continue;
      await createNotification({
        organizationId,
        type: spec.type,
        level: "warning",
        title: spec.title,
        body: spec.body,
        link: "/app/knowledge",
      });
      logger.warn("[rag-telemetry] quality alert raised", {
        organizationId,
        type: spec.type,
        rate: Number(spec.rate.toFixed(3)),
        threshold: spec.threshold,
        turns: window.turns,
      });
    }
  } catch (err) {
    // An alert must never break the loop that noticed the problem.
    logger.warn("[rag-telemetry] quality alert check failed", { err: (err as Error).message });
  }
}

/**
 * Every org with traffic in the window, checked once.
 *
 * Swept on a timer rather than evaluated after each turn: the aggregation is
 * over a window, so running it per turn would recompute nearly the same answer
 * hundreds of times an hour and put a group-by on the reply path's tail.
 */
export async function sweepRagQualityAlerts(): Promise<void> {
  if (!env.rag.alertsEnabled || !env.rag.telemetryEnabled) return;
  const since = new Date(Date.now() - env.rag.alertWindowMinutes * 60_000);
  const orgIds = await RagTurnMetric.distinct("organizationId", { createdAt: { $gte: since } });
  for (const id of orgIds) {
    await checkRagQualityAlerts(String(id));
  }
}
