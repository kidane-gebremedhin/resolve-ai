// MongoDB-backed store for express-rate-limit. The default store is process
// memory, so with N API replicas every IP got N times each limit (login,
// password reset, coupon brute-force, signup). Counters here are shared.
import type { Options, Store, IncrementResponse } from "express-rate-limit";
import { RateCounter } from "../models/index.js";
import { hitRateCounter } from "./widgetRateLimit.js";

export class MongoRateStore implements Store {
  windowMs = 60_000;
  localKeys = false;
  constructor(public prefix: string) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const { count, resetAt } = await hitRateCounter(`${this.prefix}:${key}`, this.windowMs);
    return { totalHits: count, resetTime: resetAt };
  }

  async decrement(key: string): Promise<void> {
    await RateCounter.updateOne({ key: `${this.prefix}:${key}`, count: { $gt: 0 } }, { $inc: { count: -1 } });
  }

  async resetKey(key: string): Promise<void> {
    await RateCounter.deleteOne({ key: `${this.prefix}:${key}` });
  }
}
