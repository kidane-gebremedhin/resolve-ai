// Per-session fixed-window rate limiter for widget endpoints that cost money or
// write data. Keyed on contactSessionId (set by requireWidgetSession, which must
// run first). Counters live in MongoDB so the limit holds across replicas.
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { RateCounter } from "../models/index.js";

/** Counts one hit for `key` and returns the window's state after it. */
export async function hitRateCounter(
  key: string,
  windowMs: number,
): Promise<{ count: number; resetAt: Date }> {
  const now = new Date();
  const live = await RateCounter.findOneAndUpdate(
    { key, resetAt: { $gt: now } },
    { $inc: { count: 1 } },
    { new: true },
  ).lean();
  if (live) return { count: live.count, resetAt: live.resetAt };
  const resetAt = new Date(now.getTime() + windowMs);
  // Restart an expired window. Atomic per document: of two racing requests,
  // only the first still sees the old `resetAt` and matches.
  const restarted = await RateCounter.findOneAndUpdate(
    { key, resetAt: { $lte: now } },
    { $set: { count: 1, resetAt } },
    { new: true },
  ).lean();
  if (restarted) return { count: restarted.count, resetAt: restarted.resetAt };
  try {
    await RateCounter.create({ key, count: 1, resetAt });
    return { count: 1, resetAt };
  } catch {
    // Another request opened the window first (duplicate key). Count this hit
    // against that window instead of resetting it.
    const again = await RateCounter.findOneAndUpdate({ key }, { $inc: { count: 1 } }, { new: true }).lean();
    return { count: again?.count ?? 1, resetAt: again?.resetAt ?? resetAt };
  }
}

export async function widgetRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = `widget:${req.contactSessionId ?? req.ip ?? "unknown"}`;
  const { max, windowMs } = env.widgetRateLimit;
  let state: { count: number; resetAt: Date };
  try {
    state = await hitRateCounter(key, windowMs);
  } catch {
    // The limiter is a guard, not a dependency: a database hiccup lets the
    // request through rather than taking the widget down.
    next();
    return;
  }

  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - state.count)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(state.resetAt.getTime() / 1000)));

  if (state.count > max) {
    res.status(429).json({
      error: {
        code: "rate_limit_exceeded",
        message: `Widget message limit: ${max} messages per ${windowMs / 1000}s. Please wait before sending more.`,
      },
    });
    return;
  }
  next();
}
