// The per-process cap on concurrent customer turns (__specs/38 S5).

import { afterEach, describe, expect, it } from "vitest";
import { env } from "../config/env.js";
import { turnGateStats, withTurnSlot } from "../services/ai/turn-gate.js";

const original = env.ai.maxConcurrentTurns;
afterEach(() => {
  env.ai.maxConcurrentTurns = original;
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("withTurnSlot", () => {
  it("never runs more than the cap, queues the rest in order, and drops none", async () => {
    env.ai.maxConcurrentTurns = 2;
    const gates = Array.from({ length: 5 }, deferred);
    const started: number[] = [];
    let peak = 0;
    const runs = gates.map((g, n) =>
      withTurnSlot(async () => {
        started.push(n);
        peak = Math.max(peak, turnGateStats().running);
        await g.promise;
        return n;
      }),
    );
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    expect(turnGateStats()).toEqual({ running: 2, waiting: 3 });

    for (const g of gates) {
      g.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3, 4]);
    expect(started).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(turnGateStats()).toEqual({ running: 0, waiting: 0 });
  });

  it("frees the slot when a turn throws", async () => {
    env.ai.maxConcurrentTurns = 1;
    await expect(withTurnSlot(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await withTurnSlot(async () => "next")).toBe("next");
    expect(turnGateStats()).toEqual({ running: 0, waiting: 0 });
  });

  it("does not cap at 0", async () => {
    env.ai.maxConcurrentTurns = 0;
    const gates = Array.from({ length: 30 }, deferred);
    const runs = gates.map((g) => withTurnSlot(() => g.promise));
    await Promise.resolve();
    expect(turnGateStats().waiting).toBe(0);
    gates.forEach((g) => g.resolve());
    await Promise.all(runs);
  });
});
