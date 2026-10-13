// Per-process cap on concurrent customer turns (__specs/38 S5).
//
// Every turn holds a model stream, tool calls and Mongo work for seconds. With
// no cap, a burst of widget messages runs all of them at once in one container.
// Turns past the cap wait in arrival order; none is dropped.

import { env } from "../../config/env.js";

let running = 0;
const waiting: (() => void)[] = [];

/** Run `fn` once a slot is free. `env.ai.maxConcurrentTurns <= 0` means no cap. */
export async function withTurnSlot<T>(fn: () => Promise<T>): Promise<T> {
  const limit = env.ai.maxConcurrentTurns;
  if (limit > 0 && running >= limit) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running += 1;
  }
  try {
    return await fn();
  } finally {
    // Hand the slot straight to the next waiter, so `running` never dips and
    // lets a newcomer jump the queue.
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

/** Current load, for tests and diagnostics. */
export function turnGateStats(): { running: number; waiting: number } {
  return { running, waiting: waiting.length };
}
