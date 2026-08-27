// Sweeps orgs with recent AI traffic and raises RAG quality alerts.
//
// A job rather than a per-turn check: the rates are computed over a rolling
// window, so evaluating them after every turn would recompute nearly the same
// aggregate hundreds of times an hour, on the tail of the reply path, to reach
// the same conclusion.

import { logger } from "../config/logger.js";
import { sweepRagQualityAlerts } from "../services/ai/telemetry/rag-alerts.service.js";

export async function ragQualityAlertsOnce(): Promise<void> {
  try {
    await sweepRagQualityAlerts();
  } catch (err) {
    logger.error("[jobs] rag quality alert sweep failed", { err: (err as Error).message });
  }
}
