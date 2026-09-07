// The background loops are fire-and-forget on setInterval, so a run that
// outlasts its interval used to overlap itself. None of these jobs claim their
// work atomically (reconcileOnce selects sources by embeddingStatus and the
// status only changes once the ingest completes), so overlapping runs pick up
// the same sources and pay the embedding provider twice for them.

import { describe, expect, it, vi } from "vitest";
import { serialLoop } from "../jobs/serial-loop.js";

/** A tick the test can hold open and release on demand. */
function controllable() {
  let release!: () => void;
  let calls = 0;
  const tick = () => {
    calls += 1;
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  return {
    tick,
    get calls() {
      return calls;
    },
    release: () => release(),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("serialLoop", () => {
  it("runs the tick when idle", async () => {
    const c = controllable();
    const loop = serialLoop("t", c.tick);
    loop.run();
    expect(c.calls).toBe(1);
    c.release();
    await loop.settled();
  });

  it("drops ticks that arrive while a run is in flight", async () => {
    const c = controllable();
    const loop = serialLoop("t", c.tick);

    loop.run();
    loop.run();
    loop.run();

    // The overlap this whole module exists to prevent: three timer ticks, one run.
    expect(c.calls).toBe(1);
    expect(loop.skipped).toBe(2);
    expect(loop.inFlight).toBe(true);

    c.release();
    await loop.settled();
    expect(loop.inFlight).toBe(false);
  });

  it("accepts the next tick once the run finishes", async () => {
    const c = controllable();
    const loop = serialLoop("t", c.tick);

    loop.run();
    c.release();
    await loop.settled();
    await settle();

    loop.run();
    expect(c.calls).toBe(2);
    expect(loop.skipped).toBe(0);
    c.release();
    await loop.settled();
  });

  it("releases the latch when a tick rejects", async () => {
    // A crashed run that left the latch stuck would silently stop the loop
    // forever, which is worse than the overlap it prevents.
    let calls = 0;
    const loop = serialLoop("t", async () => {
      calls += 1;
      throw new Error("boom");
    });

    loop.run();
    await loop.settled();
    await settle();
    expect(loop.inFlight).toBe(false);

    loop.run();
    await loop.settled();
    expect(calls).toBe(2);
  });

  it("releases the latch when a tick throws synchronously", async () => {
    let calls = 0;
    const loop = serialLoop("t", (() => {
      calls += 1;
      throw new Error("sync boom");
    }) as () => Promise<void>);

    loop.run();
    await loop.settled();
    await settle();
    loop.run();
    await loop.settled();
    expect(calls).toBe(2);
  });

  it("reports an overrun so a loop that never keeps up is visible", async () => {
    const { logger } = await import("../config/logger.js");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    try {
      const loop = serialLoop("slow", async () => {
        await new Promise((r) => setTimeout(r, 25));
      }, { intervalMs: 5 });
      loop.run();
      await loop.settled();
      await settle();
      expect(
        warn.mock.calls.some(([msg]) => String(msg).includes("overran its interval")),
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
