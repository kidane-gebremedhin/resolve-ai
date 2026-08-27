// Background jobs orchestrator.
//
// `startJobs()` is called once from src/index.ts after the HTTP server starts.
// It schedules the embedding reconciliation loop (60s) and the Firecrawl poll
// loop (30s) on plain setInterval timers — no external queue infrastructure
// required for Phase 3. Each job iteration is self-contained (per-source
// try/catch lives inside the job module) so a thrown error here would only
// indicate a bug in the orchestrator itself.
//
// We delay the first tick by 5s after boot so any in-flight Mongo handshake
// from connectDb() has time to settle before we start hammering the DB.

import { logger } from "../config/logger.js";
import { reconcileOnce } from "./embedding-reconcile.job.js";
import { firecrawlPollOnce } from "./firecrawl-ingest.job.js";
import { startOAuthTokenRefresh } from "./refreshOAuthTokens.js";
import { ragQualityAlertsOnce } from "./rag-quality-alerts.job.js";
import { indexHealthOnce } from "./index-health.job.js";
import { env } from "../config/env.js";

const STARTUP_DELAY_MS = 5_000;
const RECONCILE_INTERVAL_MS = 60_000;
const FIRECRAWL_INTERVAL_MS = 30_000;
const INDEX_HEALTH_INTERVAL_MS = env.kb.indexHealthIntervalMs;

let started = false;

export function startJobs(): void {
  if (started) return;
  started = true;

  logger.info("[jobs] scheduling background jobs", {
    startupDelayMs: STARTUP_DELAY_MS,
    reconcileIntervalMs: RECONCILE_INTERVAL_MS,
    firecrawlIntervalMs: FIRECRAWL_INTERVAL_MS,
  });

  setTimeout(() => {
    // Reconciliation loop.
    const reconcileTick = (): void => {
      reconcileOnce().catch((err) =>
        logger.error("[jobs] reconcile tick crashed", { err: (err as Error).message }),
      );
    };
    reconcileTick();
    setInterval(reconcileTick, RECONCILE_INTERVAL_MS).unref();

    // Firecrawl polling loop.
    const firecrawlTick = (): void => {
      firecrawlPollOnce().catch((err) =>
        logger.error("[jobs] firecrawl tick crashed", { err: (err as Error).message }),
      );
    };
    firecrawlTick();
    setInterval(firecrawlTick, FIRECRAWL_INTERVAL_MS).unref();

    // OAuth token refresh loop.
    startOAuthTokenRefresh();

    // RAG quality alert sweep. Skipped entirely when telemetry is off, since
    // there would be nothing in the collection to aggregate.
    if (env.rag.telemetryEnabled && env.rag.alertsEnabled) {
      const ragAlertTick = (): void => {
        void ragQualityAlertsOnce();
      };
      ragAlertTick();
      setInterval(ragAlertTick, env.rag.alertIntervalMs).unref();
    }

    // Index health loop. The tick is frequent; the WORK is gated to the
    // configured off-peak hour inside the job, so a restart at any time of day
    // cannot miss the window and cannot re-embed during business hours either.
    // Off by default (`KB_INDEX_HEALTH_ENABLED`).
    if (env.kb.indexHealthEnabled) {
      const indexHealthTick = (): void => {
        void indexHealthOnce();
      };
      indexHealthTick();
      setInterval(indexHealthTick, INDEX_HEALTH_INTERVAL_MS).unref();
    }
  }, STARTUP_DELAY_MS).unref();
}
