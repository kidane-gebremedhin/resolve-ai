// Read-only RAG quality metrics for the dashboard (__specs/39, online section).
//
// Every handler here is org-scoped from the authenticated context and does its
// arithmetic in a MongoDB aggregation pipeline. Two rules hold throughout:
//
//   1. The organization clause comes from `req.orgId`, never from the query
//      string. A client-supplied `agentId` or `websiteId` can only NARROW a
//      query that is already scoped to the caller's org.
//   2. No rollup crosses the wire. Sending 50,000 turns to a browser so it can
//      compute a mean is not a dashboard, it is a data export with a chart on
//      top, and it stops working at exactly the traffic level where the numbers
//      start to matter.
//
// Every `$match` below leads with `(organizationId, createdAt)` or
// `(organizationId, agentId, createdAt)`, both of which are indexed on
// `RagTurnMetric`. `rag-metrics.test.ts` runs each one through `explain()`.

import { Router, type Request } from "express";
import mongoose from "mongoose";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import {
  KnowledgeGap,
  KnowledgeSource,
  MessageFeedback,
  RagTurnMetric,
} from "../models/index.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { maskPii } from "../services/integrations/piiMask.js";
import { METRIC_DEFINITIONS } from "../services/ai/eval/metric-definitions.js";
import { ingestionHealth } from "../services/kb/ingestion-health.service.js";
import {
  agentScopeFilter,
  orgObjectId,
  parseDateRange,
  parseLimit,
  previousRange,
  wrap,
  type DateRange,
} from "./shared/analytics-scope.js";

const router = Router();

/** K values the retrieval panel reports, matching the offline harness. */
const KS = [3, 5, 10] as const;

/** Histogram resolution for the score distribution. 20 buckets of 0.05. */
const SCORE_BUCKET_WIDTH = 0.05;

/**
 * `$percentile` is a MongoDB 7.0 accumulator that mongoose's `AccumulatorOperator`
 * union does not know about yet, so the cast is to that union rather than to
 * `any` — the shape is validated by the server, and the pipelines using it are
 * covered by `rag-metrics.test.ts`.
 *
 * Percentiles are computed in the server rather than by sorting durations in the
 * API: p95 over a month of turns means holding every duration in memory, which
 * is the client-side rollup this file exists to avoid, one process further in.
 */
// The declared return type is a stand-in: mongoose's accumulator union has no
// `$percentile` member yet, so the helper is typed as one that exists. What
// reaches the server is `$percentile`, which MongoDB 7.0+ implements and which
// `rag-metrics.test.ts` exercises against a real server rather than a mock.
function percentileP50P95(input: unknown): { $sum: number } {
  return { $percentile: { input, p: [0.5, 0.95], method: "approximate" } } as unknown as {
    $sum: number;
  };
}

type Match = Record<string, unknown>;

/** The org-scoped `$match` for a window. The org clause is never client-supplied. */
async function windowMatch(req: Request, range: DateRange): Promise<Match> {
  return {
    organizationId: orgObjectId(req),
    ...(await agentScopeFilter(req)),
    createdAt: { $gte: range.since, $lte: range.until },
  };
}

/** `null` rather than `NaN` or `0` when there is nothing to divide by. */
function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * Period-over-period delta, in the metric's own units.
 *
 * Null when either side is missing: a delta against a period with no traffic is
 * not "up 100 percent", it is unknown, and rendering it as a number invites an
 * operator to act on noise.
 */
function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}

// ---------------------------------------------------------------------------
// GET /rag-metrics/definitions
// ---------------------------------------------------------------------------
// The tooltip text for every tile, so the page has exactly one source for it.
router.get(
  "/definitions",
  requireAuth,
  requireOrg,
  wrap(async (_req, res) => {
    res.json({ definitions: METRIC_DEFINITIONS });
  }),
);

// ---------------------------------------------------------------------------
// GET /rag-metrics/summary — the header KPI row, with deltas
// ---------------------------------------------------------------------------
router.get(
  "/summary",
  requireAuth,
  requireOrg,
  wrap(async (req, res) => {
    const range = parseDateRange(req.query, 30);
    const prev = previousRange(range);
    const scope = await agentScopeFilter(req);

    // Both windows in ONE pass, bucketed by period. Two round trips would scan
    // the same index twice to answer one question.
    const rows = await RagTurnMetric.aggregate<{
      _id: "current" | "previous";
      turns: number;
      noHits: number;
      lowConfidence: number;
      escalated: number;
      conflicted: number;
      meanConfidence: number | null;
      meanRetrievalConfidence: number | null;
      faithfulness: number | null;
      faithfulnessSamples: number;
      pricedCostUsd: number;
      pricedConversations: mongoose.Types.ObjectId[];
      latency: number[];
    }>([
      {
        $match: {
          organizationId: orgObjectId(req),
          ...scope,
          createdAt: { $gte: prev.since, $lte: range.until },
        },
      },
      {
        $addFields: {
          _period: {
            $cond: [{ $gte: ["$createdAt", range.since] }, "current", "previous"],
          },
        },
      },
      {
        $group: {
          _id: "$_period",
          turns: { $sum: 1 },
          noHits: { $sum: { $cond: ["$flags.noHits", 1, 0] } },
          lowConfidence: { $sum: { $cond: ["$flags.lowConfidence", 1, 0] } },
          escalated: { $sum: { $cond: ["$flags.escalated", 1, 0] } },
          conflicted: { $sum: { $cond: ["$flags.conflicted", 1, 0] } },
          meanConfidence: { $avg: "$generation.confidence" },
          meanRetrievalConfidence: { $avg: "$retrieval.retrievalConfidence" },
          // `$avg` skips non-numeric values, so an unscored sample drops out
          // rather than averaging in as a zero.
          faithfulness: { $avg: "$faithfulness.score" },
          // `$isNumber`, not a `$type` comparison: a score of exactly 0 or 1 is
          // stored as a BSON int rather than a double, and checking for
          // "double" silently undercounts the perfect and the total failures —
          // the two samples most worth seeing.
          faithfulnessSamples: {
            $sum: { $cond: [{ $isNumber: "$faithfulness.score" }, 1, 0] },
          },
          // Cost is summed over PRICED turns only, and the conversation set is
          // built from the same turns, so the ratio has a consistent
          // denominator. A turn OpenRouter never priced is unknown, not free.
          pricedCostUsd: {
            $sum: { $cond: [{ $eq: ["$generation.costUsd", null] }, 0, "$generation.costUsd"] },
          },
          pricedConversations: {
            $addToSet: {
              $cond: [{ $eq: ["$generation.costUsd", null] }, "$$REMOVE", "$conversationId"],
            },
          },
          latency: percentileP50P95("$durationMs"),
        },
      },
    ]);

    const byPeriod = new Map(rows.map((r) => [r._id, r]));

    const shape = (key: "current" | "previous") => {
      const r = byPeriod.get(key);
      if (!r || r.turns === 0) {
        return {
          turns: 0,
          faithfulness: null as number | null,
          faithfulnessSamples: 0,
          meanConfidence: null as number | null,
          meanRetrievalConfidence: null as number | null,
          noHitRate: null as number | null,
          lowConfidenceRate: null as number | null,
          escalationRate: null as number | null,
          conflictRate: null as number | null,
          p50LatencyMs: null as number | null,
          p95LatencyMs: null as number | null,
          costPerConversation: null as number | null,
          totalCostUsd: 0,
          pricedConversations: 0,
        };
      }
      const convos = r.pricedConversations?.length ?? 0;
      return {
        turns: r.turns,
        faithfulness: r.faithfulness,
        faithfulnessSamples: r.faithfulnessSamples,
        meanConfidence: r.meanConfidence,
        meanRetrievalConfidence: r.meanRetrievalConfidence,
        noHitRate: ratio(r.noHits, r.turns),
        lowConfidenceRate: ratio(r.lowConfidence, r.turns),
        escalationRate: ratio(r.escalated, r.turns),
        conflictRate: ratio(r.conflicted, r.turns),
        p50LatencyMs: r.latency?.[0] ?? null,
        p95LatencyMs: r.latency?.[1] ?? null,
        costPerConversation: ratio(r.pricedCostUsd, convos),
        totalCostUsd: r.pricedCostUsd,
        pricedConversations: convos,
      };
    };

    const current = shape("current");
    const previous = shape("previous");

    res.json({
      range: { since: range.since, until: range.until, days: range.days },
      previousRange: { since: prev.since, until: prev.until },
      current,
      previous,
      deltas: {
        faithfulness: delta(current.faithfulness, previous.faithfulness),
        meanConfidence: delta(current.meanConfidence, previous.meanConfidence),
        noHitRate: delta(current.noHitRate, previous.noHitRate),
        escalationRate: delta(current.escalationRate, previous.escalationRate),
        p95LatencyMs: delta(current.p95LatencyMs, previous.p95LatencyMs),
        costPerConversation: delta(current.costPerConversation, previous.costPerConversation),
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /rag-metrics/retrieval — Recall@K / Precision@K / MRR + score histogram
// ---------------------------------------------------------------------------
router.get(
  "/retrieval",
  requireAuth,
  requireOrg,
  wrap(async (req, res) => {
    const range = parseDateRange(req.query, 30);
    const match = await windowMatch(req, range);

    // Ranked list: `retrieval.sourceIds`, already deduplicated to first
    // appearance per source when the turn was written — which is exactly the
    // source-granularity ranking the offline harness scores against.
    //
    // Relevant set: the sources the reply cited. A turn that cited nothing has
    // no relevant set and is excluded rather than scored zero (__specs/39,
    // "Null is not zero").
    const perK = KS.flatMap((k) => [
      [`_hits${k}`, { $size: { $setIntersection: [{ $slice: ["$_ranked", k] }, "$_cited"] } }],
    ] as const).reduce<Record<string, unknown>>((acc, [key, expr]) => {
      acc[key as string] = expr;
      return acc;
    }, {});

    const scoreProjection = KS.reduce<Record<string, unknown>>((acc, k) => {
      acc[`recall${k}`] = { $divide: [`$_hits${k}`, { $size: "$_cited" }] };
      acc[`precision${k}`] = { $divide: [`$_hits${k}`, k] };
      return acc;
    }, {});

    const [scored, distribution, rates] = await Promise.all([
      RagTurnMetric.aggregate<Record<string, number | null> & { scored: number }>([
        { $match: { ...match, "generation.citedSourceIds.0": { $exists: true } } },
        {
          $addFields: {
            _ranked: { $ifNull: ["$retrieval.sourceIds", []] },
            _cited: "$generation.citedSourceIds",
          },
        },
        { $addFields: perK },
        {
          $addFields: {
            // Reciprocal rank of the FIRST cited source in the ranked list.
            // `$indexOfArray` returns -1 for a source that is not there at all,
            // which is filtered out rather than treated as rank 0.
            _rr: {
              $let: {
                vars: {
                  found: {
                    $filter: {
                      input: {
                        $map: {
                          input: "$_cited",
                          as: "c",
                          in: { $indexOfArray: ["$_ranked", "$$c"] },
                        },
                      },
                      as: "i",
                      cond: { $gte: ["$$i", 0] },
                    },
                  },
                },
                in: {
                  $cond: [
                    { $gt: [{ $size: "$$found" }, 0] },
                    { $divide: [1, { $add: [{ $min: "$$found" }, 1] }] },
                    0,
                  ],
                },
              },
            },
          },
        },
        { $addFields: scoreProjection },
        {
          $group: {
            _id: null,
            scored: { $sum: 1 },
            mrr: { $avg: "$_rr" },
            ...KS.reduce<Record<string, unknown>>((acc, k) => {
              acc[`recall${k}`] = { $avg: `$recall${k}` };
              acc[`precision${k}`] = { $avg: `$precision${k}` };
              return acc;
            }, {}),
          },
        },
      ]),

      // Score distribution. Bucketed server-side: shipping every turn's score to
      // the browser to build a histogram is the client-side rollup this page
      // must not have.
      RagTurnMetric.aggregate<{ _id: number; count: number }>([
        { $match: { ...match, "retrieval.topScore": { $ne: null } } },
        {
          $bucket: {
            groupBy: "$retrieval.topScore",
            boundaries: Array.from({ length: 21 }, (_, i) =>
              Number((i * SCORE_BUCKET_WIDTH).toFixed(2)),
            ),
            default: "out_of_range",
            output: { count: { $sum: 1 } },
          },
        },
      ]),

      RagTurnMetric.aggregate<{
        turns: number;
        noHits: number;
        widened: number;
        meanTopScore: number | null;
        latency: number[];
      }>([
        { $match: match },
        {
          $group: {
            _id: null,
            turns: { $sum: 1 },
            noHits: { $sum: { $cond: ["$flags.noHits", 1, 0] } },
            widened: { $sum: { $cond: ["$retrieval.widenedOnEmpty", 1, 0] } },
            meanTopScore: { $avg: "$retrieval.topScore" },
            latency: percentileP50P95({ $ifNull: ["$retrieval.latencyMs", 0] }),
          },
        },
      ]),
    ]);

    const s = scored[0];
    const r = rates[0];

    res.json({
      // The floor the histogram draws its line at, read from the running
      // config rather than hardcoded in the page.
      minScoreThreshold: env.ai.kbSearchMinScore,
      bucketWidth: SCORE_BUCKET_WIDTH,
      ks: KS,
      scoredTurns: s?.scored ?? 0,
      totalTurns: r?.turns ?? 0,
      recallAtK: Object.fromEntries(KS.map((k) => [k, s?.[`recall${k}`] ?? null])),
      precisionAtK: Object.fromEntries(KS.map((k) => [k, s?.[`precision${k}`] ?? null])),
      mrr: s?.mrr ?? null,
      meanTopScore: r?.meanTopScore ?? null,
      noHitRate: r ? ratio(r.noHits, r.turns) : null,
      widenOnEmptyRate: r ? ratio(r.widened, r.turns) : null,
      p50LatencyMs: r?.latency?.[0] ?? null,
      p95LatencyMs: r?.latency?.[1] ?? null,
      distribution: distribution
        .filter((b): b is { _id: number; count: number } => typeof b._id === "number")
        .map((b) => ({ from: b._id, to: Number((b._id + SCORE_BUCKET_WIDTH).toFixed(2)), count: b.count })),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /rag-metrics/generation — confidence + faithfulness over time, examples
// ---------------------------------------------------------------------------
router.get(
  "/generation",
  requireAuth,
  requireOrg,
  wrap(async (req, res) => {
    const range = parseDateRange(req.query, 30);
    const match = await windowMatch(req, range);
    const exampleLimit = parseLimit(req.query.examples, 10, 50);

    const [daily, totals, thumbs, examples] = await Promise.all([
      RagTurnMetric.aggregate<{
        _id: string;
        turns: number;
        confidence: number | null;
        faithfulness: number | null;
        faithfulnessSamples: number;
      }>([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            turns: { $sum: 1 },
            confidence: { $avg: "$generation.confidence" },
            faithfulness: { $avg: "$faithfulness.score" },
            faithfulnessSamples: {
              $sum: { $cond: [{ $isNumber: "$faithfulness.score" }, 1, 0] },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      RagTurnMetric.aggregate<{
        turns: number;
        cited: number;
        citationSum: number;
        meanConfidence: number | null;
        faithfulness: number | null;
        faithfulnessSamples: number;
        escalated: number;
      }>([
        { $match: match },
        {
          $group: {
            _id: null,
            turns: { $sum: 1 },
            cited: { $sum: { $cond: [{ $gt: ["$generation.citationCount", 0] }, 1, 0] } },
            citationSum: { $sum: "$generation.citationCount" },
            meanConfidence: { $avg: "$generation.confidence" },
            faithfulness: { $avg: "$faithfulness.score" },
            faithfulnessSamples: {
              $sum: { $cond: [{ $isNumber: "$faithfulness.score" }, 1, 0] },
            },
            escalated: { $sum: { $cond: ["$flags.escalated", 1, 0] } },
          },
        },
      ]),

      MessageFeedback.aggregate<{ _id: string; count: number }>([
        {
          $match: {
            organizationId: orgObjectId(req),
            createdAt: { $gte: range.since, $lte: range.until },
          },
        },
        { $group: { _id: "$rating", count: { $sum: 1 } } },
      ]),

      // Unsupported-claim examples, each linked back to its conversation so an
      // operator can read the turn that produced it rather than guess.
      RagTurnMetric.find(
        { ...match, "faithfulness.unsupported.0": { $exists: true } },
        {
          conversationId: 1,
          messageId: 1,
          originalQuery: 1,
          createdAt: 1,
          "faithfulness.score": 1,
          "faithfulness.unsupported": 1,
        },
      )
        .sort({ createdAt: -1 })
        .limit(exampleLimit)
        .lean(),
    ]);

    const t = totals[0];
    const up = thumbs.find((x) => x._id === "up")?.count ?? 0;
    const down = thumbs.find((x) => x._id === "down")?.count ?? 0;

    res.json({
      meanConfidence: t?.meanConfidence ?? null,
      faithfulness: t?.faithfulness ?? null,
      faithfulnessSamples: t?.faithfulnessSamples ?? 0,
      escalationRate: t ? ratio(t.escalated, t.turns) : null,
      citationRate: t ? ratio(t.cited, t.turns) : null,
      citationsPerAnswer: t ? ratio(t.citationSum, t.cited) : null,
      thumbs: { up, down, total: up + down, helpfulness: ratio(up, up + down) },
      daily: daily.map((d) => ({
        date: d._id,
        turns: d.turns,
        confidence: d.confidence,
        faithfulness: d.faithfulness,
        faithfulnessSamples: d.faithfulnessSamples,
      })),
      unsupportedExamples: examples.map((e) => ({
        conversationId: String(e.conversationId),
        messageId: String(e.messageId),
        query: e.originalQuery ?? "",
        score: e.faithfulness?.score ?? null,
        createdAt: e.createdAt,
        claims: (e.faithfulness?.unsupported ?? []).map((c) => ({
          claim: c.claim ?? "",
          verdict: c.verdict ?? "",
          reason: c.reason ?? "",
        })),
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /rag-metrics/cost — tokens, USD and latency over time
// ---------------------------------------------------------------------------
router.get(
  "/cost",
  requireAuth,
  requireOrg,
  wrap(async (req, res) => {
    const range = parseDateRange(req.query, 30);
    const match = await windowMatch(req, range);

    const daily = await RagTurnMetric.aggregate<{
      _id: string;
      turns: number;
      pricedTurns: number;
      promptTokens: number;
      completionTokens: number;
      costUsd: number;
      latency: number[];
    }>([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          turns: { $sum: 1 },
          pricedTurns: {
            $sum: { $cond: [{ $isNumber: "$generation.costUsd" }, 1, 0] },
          },
          promptTokens: { $sum: { $ifNull: ["$generation.promptTokens", 0] } },
          completionTokens: { $sum: { $ifNull: ["$generation.completionTokens", 0] } },
          costUsd: { $sum: { $ifNull: ["$generation.costUsd", 0] } },
          latency: percentileP50P95("$durationMs"),
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const totals = daily.reduce(
      (acc, d) => ({
        turns: acc.turns + d.turns,
        pricedTurns: acc.pricedTurns + d.pricedTurns,
        promptTokens: acc.promptTokens + d.promptTokens,
        completionTokens: acc.completionTokens + d.completionTokens,
        costUsd: acc.costUsd + d.costUsd,
      }),
      { turns: 0, pricedTurns: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 },
    );

    res.json({
      totals: {
        ...totals,
        // How much of the window is actually priced. Without this an operator
        // reading a suspiciously low total cannot tell a cheap week from a
        // week OpenRouter never resolved.
        pricedShare: ratio(totals.pricedTurns, totals.turns),
        costPerTurn: ratio(totals.costUsd, totals.pricedTurns),
      },
      daily: daily.map((d) => ({
        date: d._id,
        turns: d.turns,
        pricedTurns: d.pricedTurns,
        promptTokens: d.promptTokens,
        completionTokens: d.completionTokens,
        costUsd: d.costUsd,
        p50LatencyMs: d.latency?.[0] ?? null,
        p95LatencyMs: d.latency?.[1] ?? null,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /rag-metrics/failing-queries — highest-volume no-hit / low-confidence
// ---------------------------------------------------------------------------
router.get(
  "/failing-queries",
  requireAuth,
  requireOrg,
  wrap(async (req, res) => {
    const range = parseDateRange(req.query, 30);
    const match = await windowMatch(req, range);
    const limit = parseLimit(req.query.limit, 20, 100);

    const rows = await RagTurnMetric.aggregate<{
      _id: string;
      turns: number;
      noHits: number;
      lowConfidence: number;
      meanConfidence: number | null;
      meanTopScore: number | null;
      lastSeen: Date;
      conversationId: mongoose.Types.ObjectId;
    }>([
      {
        $match: {
          ...match,
          $or: [{ "flags.noHits": true }, { "flags.lowConfidence": true }],
        },
      },
      {
        $group: {
          _id: "$originalQuery",
          turns: { $sum: 1 },
          noHits: { $sum: { $cond: ["$flags.noHits", 1, 0] } },
          lowConfidence: { $sum: { $cond: ["$flags.lowConfidence", 1, 0] } },
          meanConfidence: { $avg: "$generation.confidence" },
          meanTopScore: { $avg: "$retrieval.topScore" },
          lastSeen: { $max: "$createdAt" },
          conversationId: { $last: "$conversationId" },
        },
      },
      { $sort: { turns: -1, lastSeen: -1 } },
      { $limit: limit },
    ]);

    // Join to KnowledgeGap in Node rather than with `$lookup`.
    //
    // `RagTurnMetric.originalQuery` is masked before it is persisted and
    // `KnowledgeGap.queryUsed` is not, so a `$lookup` on the raw text would
    // silently miss every query that contained an email address or a card
    // number. Masking the gap side here makes the join exact for those too. It
    // is a bounded lookup over at most `limit` rows, not a rollup.
    const gaps = await KnowledgeGap.find(
      { organizationId: req.orgId, kind: "gap" },
      { queryUsed: 1, question: 1, occurrenceCount: 1, status: 1, agentId: 1, maxKbScore: 1 },
    )
      .sort({ occurrenceCount: -1 })
      .limit(500)
      .lean();

    const gapByMasked = new Map<string, (typeof gaps)[number]>();
    for (const g of gaps) {
      const key = maskPii(String(g.queryUsed ?? ""));
      if (!gapByMasked.has(key)) gapByMasked.set(key, g);
    }

    res.json({
      items: rows.map((r) => {
        const gap = gapByMasked.get(r._id ?? "");
        return {
          query: r._id ?? "",
          turns: r.turns,
          noHits: r.noHits,
          lowConfidence: r.lowConfidence,
          meanConfidence: r.meanConfidence,
          meanTopScore: r.meanTopScore,
          lastSeen: r.lastSeen,
          conversationId: String(r.conversationId),
          gap: gap
            ? {
                _id: String(gap._id),
                question: gap.question,
                occurrenceCount: gap.occurrenceCount,
                status: gap.status,
                maxKbScore: gap.maxKbScore,
              }
            : null,
        };
      }),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /rag-metrics/source-health — per-source retrieval, never-retrieved, P8
// ---------------------------------------------------------------------------
router.get(
  "/source-health",
  requireAuth,
  requireOrg,
  wrap(async (req, res) => {
    const range = parseDateRange(req.query, 30);
    const match = await windowMatch(req, range);
    const limit = parseLimit(req.query.limit, 50, 200);

    // `includeArrayIndex` gives each source its RANK in the turn's ranked list.
    // That is what makes the mean score exact rather than approximate: the
    // turn's `topScore` belongs to the source at rank 0, so only those turns
    // contribute to a source's mean rather than crediting every source in the
    // turn with the best one's score.
    const retrieved = await RagTurnMetric.aggregate<{
      _id: string;
      retrievalCount: number;
      topRankCount: number;
      topScoreSum: number;
      lastRetrieved: Date;
    }>([
      { $match: { ...match, "retrieval.sourceIds.0": { $exists: true } } },
      { $unwind: { path: "$retrieval.sourceIds", includeArrayIndex: "_rank" } },
      {
        $group: {
          _id: "$retrieval.sourceIds",
          retrievalCount: { $sum: 1 },
          topRankCount: { $sum: { $cond: [{ $eq: ["$_rank", 0] }, 1, 0] } },
          topScoreSum: {
            $sum: {
              $cond: [{ $eq: ["$_rank", 0] }, { $ifNull: ["$retrieval.topScore", 0] }, 0],
            },
          },
          lastRetrieved: { $max: "$createdAt" },
        },
      },
      { $sort: { retrievalCount: -1 } },
    ]);

    const retrievedIds = new Set(retrieved.map((r) => r._id));

    // Source titles and ingestion state. Scoped to the org, and to the selected
    // agent when one is given.
    const sourceFilter: Record<string, unknown> = { organizationId: req.orgId };
    const scope = await agentScopeFilter(req);
    if (scope.agentId) sourceFilter.agentId = scope.agentId;

    const sources = await KnowledgeSource.find(sourceFilter, {
      title: 1,
      type: 1,
      embeddingStatus: 1,
      chunkCount: 1,
      updatedAt: 1,
      agentId: 1,
    })
      .limit(2000)
      .lean();

    const byId = new Map(sources.map((s) => [String(s._id), s]));

    const top = retrieved.slice(0, limit).map((r) => {
      const src = byId.get(r._id);
      return {
        sourceId: r._id,
        title: src?.title ?? "(deleted source)",
        type: src?.type ?? null,
        embeddingStatus: src?.embeddingStatus ?? null,
        retrievalCount: r.retrievalCount,
        topRankCount: r.topRankCount,
        // Null, not zero, when the source never ranked first: there is no score
        // that honestly belongs to it in this window.
        meanTopScore: r.topRankCount > 0 ? r.topScoreSum / r.topRankCount : null,
        lastRetrieved: r.lastRetrieved,
      };
    });

    // Dead weight: indexed and ready, and nothing in the window reached it.
    // `pending`/`error` sources are excluded — they are an ingestion problem,
    // reported separately below, not a relevance problem.
    const neverRetrieved = sources
      .filter((s) => s.embeddingStatus === "synced" && !retrievedIds.has(String(s._id)))
      .map((s) => ({
        sourceId: String(s._id),
        title: s.title,
        type: s.type,
        chunkCount: s.chunkCount ?? 0,
        updatedAt: s.updatedAt,
      }))
      .sort((a, b) => (b.chunkCount ?? 0) - (a.chunkCount ?? 0))
      .slice(0, limit);

    // P8's ingestion health, so an operator sees "this source cannot be
    // retrieved because it never indexed" next to "this source indexed and is
    // never retrieved". They look identical on a relevance panel alone.
    const health = await ingestionHealth(String(req.orgId));

    res.json({
      top,
      neverRetrieved,
      totals: {
        sources: sources.length,
        retrieved: retrievedIds.size,
        neverRetrieved: sources.filter(
          (s) => s.embeddingStatus === "synced" && !retrievedIds.has(String(s._id)),
        ).length,
      },
      ingestion: {
        totalSources: health.totalSources,
        failing: health.failing,
        failureRate: health.failureRate,
        byStatus: health.byStatus,
        inRecovery: health.inRecovery,
        byErrorClass: health.byErrorClass,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /rag-metrics/eval-runs — the last N offline reports from packages/rag-eval
// ---------------------------------------------------------------------------
//
// Offline regressions belong next to production numbers: a retrieval change that
// looks fine live and tanked the golden set has still regressed, and an operator
// staring at one page should not have to go and find that out.
router.get(
  "/eval-runs",
  requireAuth,
  requireOrg,
  wrap(async (req, res) => {
    const limit = parseLimit(req.query.limit, 10, 50);
    const dir = env.rag.evalReportsDir;

    let files: string[] = [];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort().reverse();
    } catch {
      // No reports directory is the normal case in a deployment that ships only
      // the API image. An empty list is the honest answer, not a 500.
      res.json({ available: false, runs: [] });
      return;
    }

    const runs = [];
    for (const file of files.slice(0, limit)) {
      try {
        const raw = JSON.parse(await readFile(path.join(dir, file), "utf8")) as {
          startedAt?: string;
          finishedAt?: string;
          dataset?: string;
          answeringModel?: string;
          judgeModel?: string;
          productionTopK?: number;
          summary?: Record<string, unknown>;
        };
        const summary = (raw.summary ?? {}) as {
          cases?: number;
          errored?: number;
          retrieval?: Record<string, unknown>;
          generation?: Record<string, unknown>;
          operational?: Record<string, unknown>;
        };
        runs.push({
          file,
          startedAt: raw.startedAt ?? null,
          finishedAt: raw.finishedAt ?? null,
          dataset: raw.dataset ?? null,
          answeringModel: raw.answeringModel ?? null,
          judgeModel: raw.judgeModel ?? null,
          cases: summary.cases ?? 0,
          errored: summary.errored ?? 0,
          retrieval: summary.retrieval ?? null,
          generation: summary.generation ?? null,
          operational: summary.operational ?? null,
        });
      } catch (err) {
        logger.warn("[rag-metrics] unreadable eval report", {
          file,
          err: (err as Error).message,
        });
      }
    }

    res.json({ available: true, runs });
  }),
);

export default router;
