// Aggregation helpers used by platform-admin and billing endpoints.
// All time-bucket aggregations are anchored to UTC days so that callers across
// time zones see consistent series.

import mongoose from "mongoose";
import type { Model } from "mongoose";
import { Conversation, Membership, Message, Subscription, User } from "../models/index.js";

/** Hardcoded fallback plan prices in USD/month. Env overrides take priority. */
export const PLAN_PRICE = { free: 0, starter: 19, pro: 99, enterprise: 499 } as const;
export type PlanKey = keyof typeof PLAN_PRICE;

function planPrice(plan: string | null | undefined): number {
  if (!plan) return 0;
  const envKey = `PADDLE_PRICE_${plan.toUpperCase()}_AMOUNT` as const;
  const raw = process.env[envKey];
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return PLAN_PRICE[(plan as PlanKey)] ?? 0;
}

export type DailyPoint = { date: string; value: number };

/** Returns the YYYY-MM-DD UTC label for `d`. */
function toUtcDayLabel(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Build a chronological list of YYYY-MM-DD strings for the last `days` days,
 *  ending on (and including) today (UTC). */
function utcDayRange(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(toUtcDayLabel(d));
  }
  return out;
}

/** Generic daily-count aggregation over `dateField`. Pads days with 0. */
export async function dailyMetric(args: {
  collection: Model<unknown>;
  dateField: string;
  organizationId?: string;
  days: number;
  /** Extra match filter ANDed with the date/org match. */
  match?: Record<string, unknown>;
}): Promise<DailyPoint[]> {
  const { collection, dateField, organizationId, days, match } = args;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  const matchStage: Record<string, unknown> = {
    [dateField]: { $gte: start },
    ...(match ?? {}),
  };
  if (organizationId) {
    matchStage.organizationId = new mongoose.Types.ObjectId(organizationId);
  }

  const rows = (await collection.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: `$${dateField}`, timezone: "UTC" } },
        value: { $sum: 1 },
      },
    },
  ])) as { _id: string; value: number }[];

  const map = new Map(rows.map((r) => [r._id, r.value]));
  return utcDayRange(days).map((date) => ({ date, value: map.get(date) ?? 0 }));
}

/** Sum of plan prices across active+trialing subscriptions. Values in USD. */
export async function computeMrr(): Promise<number> {
  const rows = (await Subscription.aggregate([
    { $match: { status: { $in: ["active", "trialing"] } } },
    { $group: { _id: "$plan", count: { $sum: 1 } } },
  ])) as { _id: string; count: number }[];
  let total = 0;
  for (const r of rows) total += planPrice(r._id) * r.count;
  return total;
}

type Buckets = { today: number; week: number; month: number };

async function bucketsFor(collection: Model<unknown>, dateField: string): Promise<Buckets> {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() - 6); // rolling 7d incl today
  const startOfMonth = new Date(startOfToday);
  startOfMonth.setUTCDate(startOfMonth.getUTCDate() - 29); // rolling 30d incl today

  const [today, week, month] = await Promise.all([
    collection.countDocuments({ [dateField]: { $gte: startOfToday } }),
    collection.countDocuments({ [dateField]: { $gte: startOfWeek } }),
    collection.countDocuments({ [dateField]: { $gte: startOfMonth } }),
  ]);
  return { today, week, month };
}

export function signupBuckets(): Promise<Buckets> {
  return bucketsFor(User as unknown as Model<unknown>, "createdAt");
}

export function conversationBuckets(): Promise<Buckets> {
  return bucketsFor(Conversation as unknown as Model<unknown>, "createdAt");
}

/** Churn over last 30 days: canceled / (active + canceled). 0 if no data. */
export async function churnRate30d(): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - 29);

  const [canceled, active] = await Promise.all([
    Subscription.countDocuments({
      status: "canceled",
      canceledAt: { $gte: start },
    }),
    Subscription.countDocuments({ status: { $in: ["active", "trialing"] } }),
  ]);
  const denom = canceled + active;
  if (denom === 0) return 0;
  return canceled / denom;
}

/** Time-series for the supported admin metrics, optionally scoped to one org
 *  and/or one agent. Signups aren't agent-scoped (users belong to an org, not an
 *  agent), so the agent filter only narrows conversations/messages. */
export async function adminTimeSeries(
  metric: "signups" | "conversations" | "messages" | "mrr_snapshot",
  days: number,
  opts: { organizationId?: string; agentId?: string } = {},
): Promise<DailyPoint[]> {
  const { organizationId, agentId } = opts;

  if (metric === "signups") {
    // Users have no organizationId of their own — they belong to orgs via Membership.
    // So an org filter can't be applied on the User collection directly; resolve the
    // org's member userIds and match by _id instead. (Agent filtering doesn't apply to
    // signups — a signup is an account, not an agent-scoped event.)
    let match: Record<string, unknown> | undefined;
    if (organizationId) {
      const userIds = await Membership.find({
        organizationId: new mongoose.Types.ObjectId(organizationId),
      }).distinct("userId");
      match = { _id: { $in: userIds } };
    }
    return dailyMetric({
      collection: User as unknown as Model<unknown>,
      dateField: "createdAt",
      days,
      match,
    });
  }
  if (metric === "conversations") {
    return dailyMetric({
      collection: Conversation as unknown as Model<unknown>,
      dateField: "createdAt",
      days,
      organizationId,
      match: agentId ? { agentId: new mongoose.Types.ObjectId(agentId) } : undefined,
    });
  }
  if (metric === "messages") {
    // Messages have no agentId of their own — resolve the agent's conversations
    // first and match by conversationId.
    let match: Record<string, unknown> | undefined;
    if (agentId) {
      const convoIds = await Conversation.find({
        agentId: new mongoose.Types.ObjectId(agentId),
      }).distinct("_id");
      match = { conversationId: { $in: convoIds } };
    }
    return dailyMetric({
      collection: Message as unknown as Model<unknown>,
      dateField: "createdAt",
      days,
      organizationId,
      match,
    });
  }
  // mrr_snapshot: same MRR value across the window (we don't store historical
  // MRR yet). Surfaces a flat baseline so the chart still renders.
  const mrr = await computeMrr();
  return utcDayRange(days).map((date) => ({ date, value: mrr }));
}
