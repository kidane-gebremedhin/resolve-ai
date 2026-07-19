// Per-session sliding-window rate limiter for the widget message endpoint.
// Uses an in-memory Map as primary store (fast, no external dependency) with
// optional Redis support via the shared ioredis instance in the future.
// Keyed on contactSessionId set by requireWidgetSession (must run after it).
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";

interface RateEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateEntry>();

// Prune stale entries periodically to avoid unbounded Map growth.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 60_000);

export function widgetRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = req.contactSessionId ?? req.ip ?? "unknown";
  const now = Date.now();
  const { max, windowMs } = env.widgetRateLimit;

  let entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }

  entry.count++;
  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count > max) {
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
