// Background jobs orchestrator.
//
// `startJobs()` is called once from src/index.ts after the HTTP server starts.
// It schedules the embedding reconciliation loop (60s) and the Firecrawl poll
// loop (30s) on plain setInterval timers — no external queue infrastructure
// required for Phase 3. Each job iteration is self-contained (per-source
// try/catch lives inside the job module) so a thrown error here would only
// indicate a bug in the orchestrator itself.
//
// Every loop is wrapped in `serialLoop`, which drops a tick whose predecessor is
// still running. Without it a run that outlasts its interval overlaps itself,
// and because these jobs select their work by status rather than claiming it,
// overlapping runs re-ingest the same sources and pay the embedding bill twice.
//
// We delay the first tick by 5s after boot so any in-flight Mongo handshake
// from connectDb() has time to settle before we start hammering the DB.

import { logger } from "../config/logger.js";
import { reconcileOnce } from "./embedding-reconcile.job.js";
import { firecrawlPollOnce } from "./firecrawl-ingest.job.js";
import { startOAuthTokenRefresh } from "./refreshOAuthTokens.js";
import { ragQualityAlertsOnce } from "./rag-quality-alerts.job.js";
import { indexHealthOnce } from "./index-health.job.js";
import { serialLoop } from "./serial-loop.js";
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
    // Reconciliation loop. The slowest of the four: one large source can take
    // longer than the whole 60s interval on its own.
    const reconcile = serialLoop("reconcile", reconcileOnce, {
      intervalMs: RECONCILE_INTERVAL_MS,
    });
    reconcile.run();
    setInterval(reconcile.run, RECONCILE_INTERVAL_MS).unref();

    // Firecrawl polling loop.
    const firecrawl = serialLoop("firecrawl", firecrawlPollOnce, {
      intervalMs: FIRECRAWL_INTERVAL_MS,
    });
    firecrawl.run();
    setInterval(firecrawl.run, FIRECRAWL_INTERVAL_MS).unref();

    // OAuth token refresh loop.
    startOAuthTokenRefresh();

    // RAG quality alert sweep. Skipped entirely when telemetry is off, since
    // there would be nothing in the collection to aggregate.
    if (env.rag.telemetryEnabled && env.rag.alertsEnabled) {
      const ragAlerts = serialLoop("rag-quality-alerts", ragQualityAlertsOnce, {
        intervalMs: env.rag.alertIntervalMs,
      });
      ragAlerts.run();
      setInterval(ragAlerts.run, env.rag.alertIntervalMs).unref();
    }

    // Index health loop. The tick is frequent; the WORK is gated to the
    // configured off-peak hour inside the job, so a restart at any time of day
    // cannot miss the window and cannot re-embed during business hours either.
    // Off by default (`KB_INDEX_HEALTH_ENABLED`).
    if (env.kb.indexHealthEnabled) {
      const indexHealth = serialLoop("index-health", indexHealthOnce, {
        intervalMs: INDEX_HEALTH_INTERVAL_MS,
      });
      indexHealth.run();
      setInterval(indexHealth.run, INDEX_HEALTH_INTERVAL_MS).unref();
    }
  }, STARTUP_DELAY_MS).unref();
}
