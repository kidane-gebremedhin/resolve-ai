import { logger } from "../config/logger.js";

/**
 * Keeps a `setInterval` job from running on top of itself.
 *
 * Every background loop here is fire-and-forget: the tick starts an async run
 * and returns immediately, so the timer does not wait for it. When a run takes
 * longer than its interval, the next tick starts anyway and the two overlap.
 *
 * That is not merely untidy. None of these jobs claim their work atomically:
 * `reconcileOnce` selects up to 20 sources by `embeddingStatus` and re-ingests
 * them, and the status does not change until the ingest finishes. Two
 * overlapping ticks therefore select the SAME sources and embed them twice,
 * which is a duplicated provider bill and a duplicated write, not a race that
 * resolves itself. One slow source is enough to trigger it: the reconcile
 * interval is 60s and a large PDF can exceed that on its own.
 *
 * So a tick that finds a run still in flight skips rather than stacks. Skipping
 * is safe because every one of these loops is a sweep, not a queue consumer:
 * whatever it would have picked up is still there on the next tick.
 *
 * The skip is logged, and an overrun is logged with its duration, because a
 * loop that quietly never keeps up looks exactly like a loop with nothing to do.
 */
export type JobLoop = {
  /** Safe to hand straight to setInterval. */
  run: () => void;
  /** Ticks dropped because the previous run had not finished. */
  readonly skipped: number;
  /** Whether a run is in flight right now. */
  readonly inFlight: boolean;
  /** Resolves when the current run settles; immediate when idle. Used by tests. */
  settled: () => Promise<void>;
};

export function serialLoop(
  name: string,
  // The return value is ignored: some jobs report a summary, some report
  // nothing, and the loop only cares that the promise settles.
  tick: () => Promise<unknown>,
  opts: { intervalMs?: number } = {},
): JobLoop {
  let inFlight: Promise<void> | null = null;
  let skipped = 0;
  let startedAt = 0;

  const run = (): void => {
    if (inFlight) {
      skipped += 1;
      logger.warn("[jobs] tick skipped, previous run still in flight", {
        job: name,
        skipped,
        runningForMs: Date.now() - startedAt,
      });
      return;
    }

    startedAt = Date.now();
    // Started synchronously, so the first tick behaves exactly as it did before
    // the latch existed. A synchronous throw is normalised into a rejection so
    // it cannot escape past the latch and leave it stuck set.
    let started: Promise<unknown>;
    try {
      started = Promise.resolve(tick());
    } catch (err) {
      started = Promise.reject(err as Error);
    }
    inFlight = started
      .catch((err: unknown) => {
        logger.error("[jobs] tick crashed", { job: name, err: (err as Error).message });
      })
      .then(() => {
        const durationMs = Date.now() - startedAt;
        inFlight = null;
        if (opts.intervalMs && durationMs > opts.intervalMs) {
          logger.warn("[jobs] tick overran its interval", {
            job: name,
            durationMs,
            intervalMs: opts.intervalMs,
          });
        }
      });
  };

  return {
    run,
    get skipped() {
      return skipped;
    },
    get inFlight() {
      return inFlight !== null;
    },
    settled: async () => {
      await inFlight;
    },
  };
}
