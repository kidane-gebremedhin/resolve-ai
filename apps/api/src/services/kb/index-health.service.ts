// Closing the loop: what the query log and the thumbs say about the index.
//
// Retrieval telemetry (__specs/39) records what happened. This turns it into
// something an operator can ACT on, at the granularity a repair actually has:
// the passage, not the document. A document is rarely uniformly good, and the
// fix for one badly-split chunk is not the fix for a bad document.
//
// Three failure shapes, deliberately kept apart because each has a different
// repair:
//
//   DEAD WEIGHT           indexed and never retrieved. Either nobody asks about
//                         it or it is unreachable by the questions they do ask.
//                         Repair: delete it, or rewrite it to match the
//                         vocabulary customers actually use.
//   MISLEADING            retrieved often, cited, and the answers that cited it
//                         get thumbed down. Repair: fix the content — this one
//                         is actively costing you.
//   RETRIEVED, NOT CITED  scores well, reaches the prompt, and the model
//                         declines to use it. Almost always a chunking problem:
//                         the passage is about the right topic but the sentence
//                         that answers the question got split away from it.
//
// NOTHING HERE MUTATES ANYTHING. Every function is a read. The repair actions
// live behind operator-confirmed routes, and the scheduled job is allowed to
// re-embed unchanged-in-shape content and to raise a notification, nothing more.

import mongoose from "mongoose";
import {
  KbChunk,
  KnowledgeGap,
  KnowledgeSource,
  RagTurnMetric,
} from "../../models/index.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { maskPii } from "../integrations/piiMask.js";
import { embed as defaultEmbed } from "../ai/embedding.service.js";

// ---------------------------------------------------------------------------
// Weak chunk detection
// ---------------------------------------------------------------------------

export type ChunkFlag = "dead_weight" | "misleading" | "retrieved_not_cited";

/** Everything the telemetry knows about one chunk over the window. */
export type ChunkStats = {
  chunkId: string;
  sourceId: string;
  /** Turns in which this chunk reached the prompt. */
  retrievals: number;
  /** Mean 0-based position in the ranked list. Lower is better. */
  meanRank: number | null;
  meanScore: number | null;
  /** Null when reranking was off for every turn in the window. */
  meanRerankScore: number | null;
  citedCount: number;
  /** Of the turns that retrieved it, how many cited it. */
  citationRate: number | null;
  escalatedCount: number;
  escalationRate: number | null;
  /** Thumbs on the replies that actually cited this chunk. */
  thumbsUp: number;
  thumbsDown: number;
  downvoteRate: number | null;
  lastRetrieved: Date | null;
};

export type ChunkHealth = ChunkStats & {
  flags: ChunkFlag[];
  title: string | null;
  /** First ~200 characters, so an operator can recognise the passage. */
  preview: string | null;
};

export type WeakChunkThresholds = {
  /**
   * Volume floor. A chunk retrieved twice, once downvoted, is not a 50 percent
   * downvote rate — it is two retrievals. Every rate-based flag needs this,
   * for the same reason the ingestion and RAG alerts do.
   */
  minRetrievals: number;
  downvoteRate: number;
  uncitedRate: number;
  strongScore: number;
};

export function defaultThresholds(): WeakChunkThresholds {
  return {
    minRetrievals: env.kb.healthMinRetrievals,
    downvoteRate: env.kb.healthDownvoteRate,
    uncitedRate: env.kb.healthUncitedRate,
    strongScore: env.kb.healthStrongScore,
  };
}

/**
 * Which flags a chunk earns. Pure, so the classification can be pinned down
 * without a database.
 *
 * A chunk can carry more than one flag: "retrieved often, never cited, and the
 * few answers that did cite it were downvoted" is two different problems in the
 * same passage, and collapsing them to one label would hide half the story.
 */
export function flagChunk(
  stats: ChunkStats,
  thresholds: WeakChunkThresholds = defaultThresholds(),
): ChunkFlag[] {
  const flags: ChunkFlag[] = [];

  // Dead weight is a fact about the WINDOW, not a rate, so it needs no volume
  // floor: zero retrievals is zero retrievals.
  if (stats.retrievals === 0) {
    flags.push("dead_weight");
    // Nothing else can be said about a chunk that was never retrieved. Falling
    // through would let it also read as "never cited", which is true and
    // useless.
    return flags;
  }

  if (stats.retrievals < thresholds.minRetrievals) return flags;

  if (stats.downvoteRate !== null && stats.downvoteRate >= thresholds.downvoteRate) {
    flags.push("misleading");
  }

  // "Good enough to retrieve, not good enough to quote." Gated on the score so
  // a chunk that merely scraped into the prompt on a thin query does not get
  // reported as a chunking defect.
  const scored = stats.meanRerankScore ?? stats.meanScore;
  if (
    stats.citationRate !== null &&
    stats.citationRate <= thresholds.uncitedRate &&
    scored !== null &&
    scored >= thresholds.strongScore
  ) {
    flags.push("retrieved_not_cited");
  }

  return flags;
}

type ScopeArgs = {
  organizationId: string;
  agentId?: string | null;
  since?: Date;
};

function windowSince(args: ScopeArgs): Date {
  return args.since ?? new Date(Date.now() - env.kb.healthWindowDays * 24 * 60 * 60 * 1000);
}

/**
 * Per-chunk telemetry over the window, for every chunk that was retrieved.
 *
 * The thumbs join runs inside the pipeline rather than as a second query: the
 * feedback has to be attributed to the turn that cited the chunk, and pulling
 * both sides into the API to match them up is the client-side rollup this whole
 * surface is written to avoid.
 */
export async function retrievedChunkStats(args: ScopeArgs): Promise<ChunkStats[]> {
  const since = windowSince(args);
  const match: Record<string, unknown> = {
    organizationId: new mongoose.Types.ObjectId(args.organizationId),
    createdAt: { $gte: since },
    "retrieval.chunks.0": { $exists: true },
  };
  if (args.agentId) match.agentId = new mongoose.Types.ObjectId(args.agentId);

  const rows = await RagTurnMetric.aggregate<{
    _id: string;
    sourceId: string;
    retrievals: number;
    meanRank: number | null;
    meanScore: number | null;
    meanRerankScore: number | null;
    citedCount: number;
    escalatedCount: number;
    thumbsUp: number;
    thumbsDown: number;
    lastRetrieved: Date;
  }>([
    { $match: match },
    {
      $lookup: {
        from: "messagefeedbacks",
        localField: "messageId",
        foreignField: "messageId",
        as: "_feedback",
        pipeline: [{ $project: { rating: 1, _id: 0 } }],
      },
    },
    {
      $addFields: {
        _up: { $in: ["up", { $ifNull: ["$_feedback.rating", []] }] },
        _down: { $in: ["down", { $ifNull: ["$_feedback.rating", []] }] },
      },
    },
    { $unwind: "$retrieval.chunks" },
    {
      $group: {
        _id: "$retrieval.chunks.chunkId",
        sourceId: { $first: "$retrieval.chunks.sourceId" },
        retrievals: { $sum: 1 },
        meanRank: { $avg: "$retrieval.chunks.rank" },
        meanScore: { $avg: "$retrieval.chunks.score" },
        meanRerankScore: { $avg: "$retrieval.chunks.rerankScore" },
        citedCount: { $sum: { $cond: ["$retrieval.chunks.cited", 1, 0] } },
        escalatedCount: { $sum: { $cond: ["$flags.escalated", 1, 0] } },
        // Thumbs are attributed only to turns that CITED the chunk. A downvote
        // on an answer that merely had the passage in its context is not
        // evidence against the passage.
        thumbsUp: {
          $sum: { $cond: [{ $and: ["$retrieval.chunks.cited", "$_up"] }, 1, 0] },
        },
        thumbsDown: {
          $sum: { $cond: [{ $and: ["$retrieval.chunks.cited", "$_down"] }, 1, 0] },
        },
        lastRetrieved: { $max: "$createdAt" },
      },
    },
    { $sort: { retrievals: -1 } },
  ]);

  return rows.map((r) => {
    const thumbs = r.thumbsUp + r.thumbsDown;
    return {
      chunkId: r._id,
      sourceId: r.sourceId,
      retrievals: r.retrievals,
      meanRank: r.meanRank,
      meanScore: r.meanScore,
      meanRerankScore: r.meanRerankScore,
      citedCount: r.citedCount,
      citationRate: r.retrievals > 0 ? r.citedCount / r.retrievals : null,
      escalatedCount: r.escalatedCount,
      escalationRate: r.retrievals > 0 ? r.escalatedCount / r.retrievals : null,
      thumbsUp: r.thumbsUp,
      thumbsDown: r.thumbsDown,
      // Null, not zero, with no thumbs at all: "nobody said" and "everybody
      // approved" are different facts.
      downvoteRate: thumbs > 0 ? r.thumbsDown / thumbs : null,
      lastRetrieved: r.lastRetrieved ?? null,
    };
  });
}

export type IndexHealthReport = {
  windowSince: Date;
  totals: {
    chunks: number;
    retrieved: number;
    deadWeight: number;
    misleading: number;
    retrievedNotCited: number;
    /** True when the index is larger than `CHUNK_SCAN_LIMIT` and the counts above cover only part of it. */
    truncated: boolean;
    /** The cap that was applied, so a caller can say how much of the index the counts cover. */
    scanLimit: number;
  };
  chunks: ChunkHealth[];
};

/**
 * How many chunks a single health scan will read.
 *
 * The scan has to list every chunk, because dead weight is defined by the
 * ABSENCE of telemetry and so cannot be found from the telemetry side. That
 * makes the query grow with the customer's knowledge base, and this runs on a
 * dashboard load, so it needs a ceiling.
 *
 * The ceiling is not the problem; reporting a capped count as if it were the
 * whole index is. An org with 25k chunks would be told it had exactly 20,000
 * chunks and shown a dead-weight number computed from an arbitrary subset, with
 * nothing to indicate either was partial. The scan now detects the overflow and
 * says so, and callers surface it rather than quoting the number as complete.
 */
export const CHUNK_SCAN_LIMIT = 20_000;

/**
 * The full picture: every chunk in the index, scored, flagged and named.
 *
 * Dead weight is computed from the CHUNK side rather than the telemetry side —
 * a chunk that was never retrieved leaves no telemetry row at all, so the only
 * place it can be found is the index itself.
 */
export async function scoreChunks(
  args: ScopeArgs & { limit?: number; thresholds?: WeakChunkThresholds },
): Promise<IndexHealthReport> {
  const since = windowSince(args);
  const thresholds = args.thresholds ?? defaultThresholds();
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);

  const chunkFilter: Record<string, unknown> = { organizationId: args.organizationId };
  if (args.agentId) chunkFilter.agentId = args.agentId;

  // NOTE the projection: no `text`.
  //
  // Every chunk in the index has to be listed, because dead weight is a chunk
  // with no telemetry and the only place it exists is the index itself. But
  // this runs on a dashboard load, and pulling the TEXT of every chunk to show
  // a 200-character preview of at most `limit` of them means a request whose
  // memory is set by the size of the customer's knowledge base. Previews are
  // fetched below, for the handful actually returned.
  const [stats, chunkPage] = await Promise.all([
    retrievedChunkStats({ ...args, since }),
    // One over the cap, so an index that exceeds it is detectable rather than
    // silently indistinguishable from one that lands exactly on it.
    KbChunk.find(chunkFilter, { chunkId: 1, sourceId: 1 })
      .limit(CHUNK_SCAN_LIMIT + 1)
      .lean(),
  ]);

  const truncated = chunkPage.length > CHUNK_SCAN_LIMIT;
  const chunks = truncated ? chunkPage.slice(0, CHUNK_SCAN_LIMIT) : chunkPage;
  if (truncated) {
    logger.warn("[index-health] chunk scan truncated, totals cover part of the index", {
      organizationId: String(args.organizationId),
      scanLimit: CHUNK_SCAN_LIMIT,
    });
  }

  const statsById = new Map(stats.map((s) => [s.chunkId, s]));
  const sourceIds = [...new Set(chunks.map((c) => String(c.sourceId)))];
  const sources = await KnowledgeSource.find(
    { _id: { $in: sourceIds } },
    { title: 1 },
  ).lean();
  const titleById = new Map(sources.map((s) => [String(s._id), s.title as string]));

  const scored: ChunkHealth[] = chunks.map((c) => {
    const chunkId = String(c.chunkId);
    const s: ChunkStats = statsById.get(chunkId) ?? {
      chunkId,
      sourceId: String(c.sourceId),
      retrievals: 0,
      meanRank: null,
      meanScore: null,
      meanRerankScore: null,
      citedCount: 0,
      citationRate: null,
      escalatedCount: 0,
      escalationRate: null,
      thumbsUp: 0,
      thumbsDown: 0,
      downvoteRate: null,
      lastRetrieved: null,
    };
    return {
      ...s,
      flags: flagChunk(s, thresholds),
      title: titleById.get(String(c.sourceId)) ?? null,
      preview: null as string | null,
    };
  });

  const flagged = scored.filter((c) => c.flags.length > 0);

  return {
    windowSince: since,
    totals: {
      chunks: scored.length,
      retrieved: statsById.size,
      deadWeight: scored.filter((c) => c.flags.includes("dead_weight")).length,
      misleading: scored.filter((c) => c.flags.includes("misleading")).length,
      retrievedNotCited: scored.filter((c) => c.flags.includes("retrieved_not_cited")).length,
      truncated,
      scanLimit: CHUNK_SCAN_LIMIT,
    },
    // Worst first: a misleading chunk costs more than a dead one, and within a
    // flag the higher-volume passage is the one to fix first.
    chunks: await withPreviews(
      flagged
        .sort((a, b) => {
          const weight = (c: ChunkHealth) =>
            (c.flags.includes("misleading") ? 2 : 0) +
            (c.flags.includes("retrieved_not_cited") ? 1 : 0);
          if (weight(b) !== weight(a)) return weight(b) - weight(a);
          return b.retrievals - a.retrievals;
        })
        .slice(0, limit),
    ),
  };
}

/**
 * Attach a short preview to the chunks actually being returned.
 *
 * A second query, on purpose: fetching text for `limit` chunks costs a bounded
 * amount, while carrying it through the full index scan above costs whatever
 * the customer's corpus happens to weigh.
 */
async function withPreviews(chunks: ChunkHealth[]): Promise<ChunkHealth[]> {
  if (chunks.length === 0) return chunks;
  const rows = await KbChunk.find(
    { chunkId: { $in: chunks.map((c) => c.chunkId) } },
    { chunkId: 1, text: 1 },
  ).lean();
  const textById = new Map(rows.map((r) => [String(r.chunkId), String(r.text ?? "")]));
  return chunks.map((c) => ({
    ...c,
    preview: textById.get(c.chunkId)?.slice(0, 200) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Gap clustering
// ---------------------------------------------------------------------------

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export type Clusterable = { id: string; text: string; weight: number; embedding: number[] };

export type Cluster<T extends Clusterable = Clusterable> = {
  /** The highest-weight member, which is what an operator sees as the heading. */
  label: string;
  members: T[];
  /** Summed weight — occurrences, not distinct queries. */
  volume: number;
  centroid: number[];
};

/**
 * Greedy single-pass agglomerative clustering by cosine similarity.
 *
 * Greedy rather than k-means because the number of distinct topics is exactly
 * what is unknown, and asking an operator to pick a k for their own knowledge
 * gaps is asking the wrong person the wrong question. One pass in
 * highest-weight-first order also makes the result deterministic, which matters
 * for a page that is going to be reloaded and compared.
 *
 * The centroid is a running mean, so a cluster drifts toward its members rather
 * than being pinned to whichever query happened to arrive first.
 */
export function clusterByEmbedding<T extends Clusterable>(
  items: readonly T[],
  threshold: number,
): Cluster<T>[] {
  const ordered = [...items].sort(
    (a, b) => b.weight - a.weight || a.id.localeCompare(b.id),
  );
  const clusters: Cluster<T>[] = [];

  for (const item of ordered) {
    let best: { cluster: Cluster<T>; score: number } | null = null;
    for (const cluster of clusters) {
      const score = cosine(item.embedding, cluster.centroid);
      if (score >= threshold && (!best || score > best.score)) best = { cluster, score };
    }

    if (!best) {
      clusters.push({
        label: item.text,
        members: [item],
        volume: item.weight,
        centroid: [...item.embedding],
      });
      continue;
    }

    const c = best.cluster;
    const n = c.members.length;
    for (let i = 0; i < c.centroid.length; i++) {
      c.centroid[i] = (c.centroid[i]! * n + (item.embedding[i] ?? 0)) / (n + 1);
    }
    c.members.push(item);
    c.volume += item.weight;
  }

  return clusters;
}

export type GapCluster = {
  id: string;
  label: string;
  /** Total occurrences across every query in the cluster. */
  volume: number;
  /** Distinct queries collapsed into this cluster. */
  queries: { gapId: string; query: string; question: string; occurrences: number }[];
  escalationRate: number | null;
  /** `volume × (1 + escalationRate)`. See the note in `rankClusters`. */
  impact: number;
};

/**
 * Rank by volume weighted by how often the gap ended in a handoff.
 *
 * Multiplicative rather than additive, and with a `1 +` floor, so escalation
 * scales volume instead of competing with it: 40 people asking something that
 * always escalates outranks 40 people asking something the bot muddles through,
 * but neither is beaten by 3 people asking something that always escalates.
 */
export function rankClusters(clusters: GapCluster[]): GapCluster[] {
  return [...clusters].sort((a, b) => b.impact - a.impact || b.volume - a.volume);
}

export type GapClusterDeps = {
  embed?: (texts: string[]) => Promise<number[][]>;
};

/**
 * Open knowledge gaps, collapsed into topics.
 *
 * Embeddings are cached on the gap document. Without that, opening the page
 * would re-embed every open gap on every load — a cost that grows with exactly
 * the thing the page exists to reduce.
 */
export async function clusterGaps(
  args: ScopeArgs & { limit?: number; threshold?: number },
  deps: GapClusterDeps = {},
): Promise<GapCluster[]> {
  const embedFn = deps.embed ?? ((texts: string[]) => defaultEmbed(texts, { organizationId: args.organizationId }));
  const threshold = args.threshold ?? env.kb.healthGapSimilarity;
  const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);

  const filter: Record<string, unknown> = {
    organizationId: args.organizationId,
    status: "open",
    kind: "gap",
  };
  if (args.agentId) filter.agentId = args.agentId;

  const gaps = await KnowledgeGap.find(filter)
    .sort({ occurrenceCount: -1, updatedAt: -1 })
    .limit(limit)
    .lean();
  if (gaps.length === 0) return [];

  // Embed only what is missing or was embedded by a different model. Mixing
  // vector spaces would cluster on nothing.
  const model = env.kb.healthEmbeddingModelTag;
  const stale = gaps.filter(
    (g) =>
      !Array.isArray((g as { embedding?: number[] }).embedding) ||
      ((g as { embedding?: number[] }).embedding ?? []).length === 0 ||
      (g as { embeddingModel?: string }).embeddingModel !== model,
  );
  if (stale.length > 0) {
    const vectors = await embedFn(stale.map((g) => String(g.queryUsed)));
    await Promise.all(
      stale.map((g, i) =>
        KnowledgeGap.updateOne(
          { _id: g._id },
          { $set: { embedding: vectors[i] ?? [], embeddingModel: model } },
        ),
      ),
    );
    stale.forEach((g, i) => {
      (g as { embedding?: number[] }).embedding = vectors[i] ?? [];
    });
  }

  const items: (Clusterable & { question: string; gapId: string })[] = gaps
    .map((g) => ({
      id: String(g._id),
      gapId: String(g._id),
      text: String(g.queryUsed),
      question: String(g.question ?? ""),
      weight: Number(g.occurrenceCount ?? 1),
      embedding: ((g as { embedding?: number[] }).embedding ?? []) as number[],
    }))
    .filter((i) => i.embedding.length > 0);

  const clusters = clusterByEmbedding(items, threshold);

  // Escalation, joined through the mask. Telemetry stores `originalQuery`
  // masked and `KnowledgeGap.queryUsed` raw, so the gap side is masked here —
  // the same join `rag-metrics` makes, for the same reason.
  const escalation = await RagTurnMetric.aggregate<{
    _id: string;
    turns: number;
    escalated: number;
  }>([
    {
      $match: {
        organizationId: new mongoose.Types.ObjectId(args.organizationId),
        createdAt: { $gte: windowSince(args) },
        "flags.noHits": true,
      },
    },
    {
      $group: {
        _id: "$originalQuery",
        turns: { $sum: 1 },
        escalated: { $sum: { $cond: ["$flags.escalated", 1, 0] } },
      },
    },
  ]);
  const byMaskedQuery = new Map(escalation.map((e) => [e._id, e]));

  const out: GapCluster[] = clusters.map((c, idx) => {
    let turns = 0;
    let escalated = 0;
    for (const m of c.members) {
      const hit = byMaskedQuery.get(maskPii(m.text));
      if (!hit) continue;
      turns += hit.turns;
      escalated += hit.escalated;
    }
    const escalationRate = turns > 0 ? escalated / turns : null;
    return {
      // Stable within a response, derived from the cluster's own label so a
      // reload of unchanged data produces the same ids.
      id: `${idx}:${c.members[0]?.gapId ?? ""}`,
      label: c.label,
      volume: c.volume,
      queries: c.members.map((m) => ({
        gapId: m.gapId,
        query: m.text,
        question: m.question,
        occurrences: m.weight,
      })),
      escalationRate,
      impact: c.volume * (1 + (escalationRate ?? 0)),
    };
  });

  return rankClusters(out);
}
