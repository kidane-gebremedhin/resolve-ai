// Query scoping shared by every analytics-style route.
//
// Extracted so the RAG metrics routes and the existing analytics routes parse a
// date range the same way. Two implementations of "last 30 days" in one product
// is the same class of bug as two definitions of Precision@5: the pages
// disagree, and nobody can tell which one is lying.

import mongoose from "mongoose";
import type { Request, Response, NextFunction } from "express";
import { Agent } from "../../models/index.js";

export function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

/**
 * `req.orgId` arrives from the JWT as a STRING.
 *
 * `Model.find()` auto-casts it; an aggregation `$match` does NOT — it compares
 * the raw BSON type, so a string against an ObjectId field silently matches
 * nothing and the dashboard renders zeros instead of an error. Always wrap it.
 */
export function orgObjectId(req: Request): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(String(req.orgId));
}

export type DateRange = { since: Date; until: Date; days: number };

/** Either `?from=YYYY-MM-DD&to=YYYY-MM-DD` or `?days=N`, clamped to 1..365. */
export function parseDateRange(query: Request["query"], defaultDays = 30): DateRange {
  if (typeof query.from === "string" && typeof query.to === "string") {
    const since = new Date(query.from);
    const until = new Date(query.to + "T23:59:59.999Z");
    if (!isNaN(since.getTime()) && !isNaN(until.getTime()) && since <= until) {
      const days = Math.ceil((until.getTime() - since.getTime()) / (24 * 60 * 60 * 1000));
      return { since, until, days };
    }
  }
  const daysRaw = parseInt(String(query.days ?? defaultDays), 10);
  const days = Math.min(Math.max(Number.isFinite(daysRaw) ? daysRaw : defaultDays, 1), 365);
  return { since: new Date(Date.now() - days * 24 * 60 * 60 * 1000), until: new Date(), days };
}

/**
 * The window of equal length immediately before `range`, for a
 * period-over-period delta. A "+12%" with no defined comparison window is a
 * decoration, not a number.
 */
export function previousRange(range: DateRange): DateRange {
  const span = range.until.getTime() - range.since.getTime();
  return {
    since: new Date(range.since.getTime() - span),
    until: new Date(range.since.getTime() - 1),
    days: range.days,
  };
}

/**
 * Agent ids belonging to one website, for scoping metrics that are keyed by
 * agent to a website selection.
 */
export async function agentIdsForWebsite(
  orgId: unknown,
  websiteId: string,
): Promise<mongoose.Types.ObjectId[]> {
  const agents = await Agent.find(
    { organizationId: orgId, websiteId: new mongoose.Types.ObjectId(websiteId) },
    { _id: 1 },
  ).lean();
  return agents.map((a) => a._id as mongoose.Types.ObjectId);
}

/**
 * The `agentId` clause for an org-scoped `$match`, from `?agentId` or
 * `?websiteId`. Returns an empty object when neither is given.
 *
 * Never returns an organization clause: the caller always adds its own from the
 * authenticated context, so a client-supplied filter can only ever NARROW a
 * query that is already scoped to the caller's org.
 */
export async function agentScopeFilter(
  req: Request,
): Promise<Record<string, unknown>> {
  const { agentId, websiteId } = req.query;
  if (typeof agentId === "string" && mongoose.Types.ObjectId.isValid(agentId)) {
    // Confirm the agent is the caller's before it reaches a $match. Without
    // this, ?agentId=<another org's agent> would be ANDed with our own
    // organizationId and return an empty set — correct, but by luck rather than
    // by design, and it leaks nothing only because the two clauses conflict.
    const owned = await Agent.exists({ _id: agentId, organizationId: req.orgId });
    if (!owned) return { agentId: new mongoose.Types.ObjectId() }; // matches nothing
    return { agentId: new mongoose.Types.ObjectId(agentId) };
  }
  if (typeof websiteId === "string" && mongoose.Types.ObjectId.isValid(websiteId)) {
    return { agentId: { $in: await agentIdsForWebsite(req.orgId, websiteId) } };
  }
  return {};
}

/** Clamp a `?limit` query param. */
export function parseLimit(raw: unknown, fallback: number, max: number): number {
  const n = parseInt(String(raw ?? fallback), 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : fallback, 1), max);
}
