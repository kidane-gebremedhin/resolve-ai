// What to do when the knowledge base contradicts itself.
//
// This happens constantly in real deployments and is invisible without a check:
// an old refund policy page and a new one, two crawled pages quoting different
// prices, a help centre article that outlived the product. Both passages are
// relevant, both clear the score floor, and both land in the prompt. The model
// then picks one, blends them, or hedges — and every one of those is wrong in a
// different way. Blending is the worst: it produces a confident answer that
// exists in no document.
//
// Two decisions live here.
//
// DETECTION is deliberately cheap-first. The reranker gives relevance, not
// agreement — two passages can both score 0.9 by both answering the question,
// which is exactly the situation a conflict looks like, and also exactly what a
// well-covered topic looks like. So rerank scores cannot detect a contradiction;
// they can only tell us when one is POSSIBLE. That gate keeps the LLM check off
// the common single-source turn entirely.
//
// RESOLUTION is a fixed order with an explicit failure mode. When it cannot
// decide, it says so rather than guessing, because a wrong confident answer
// about a refund window is worse than an escalation.
import { createChatModel, contentToText } from "../ai/llm/chat-model.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { KbHit } from "./search.service.js";

export type ConflictCandidate = {
  sourceId: string;
  sourceTitle: string;
  priority: number;
  sourceUpdatedAt: Date | null;
  score: number;
  text: string;
};

export type ResolvedBy = "priority" | "recency" | "score" | "unresolved";

export type ConflictResolution = {
  /** The source whose passages should be treated as authoritative, if any. */
  winner: ConflictCandidate | null;
  losers: ConflictCandidate[];
  resolvedBy: ResolvedBy;
};

/**
 * Group hits by source, keeping each source's best-scoring passage as its
 * representative.
 *
 * Conflict is a property of SOURCES, not passages: two chunks of the same
 * document elaborating on each other are not in conflict, however different they
 * look.
 */
export function candidatesFromHits(hits: readonly KbHit[]): ConflictCandidate[] {
  const bySource = new Map<string, ConflictCandidate>();
  for (const hit of hits) {
    const existing = bySource.get(hit.sourceId);
    const candidate: ConflictCandidate = {
      sourceId: hit.sourceId,
      sourceTitle: hit.sourceTitle,
      priority: hit.priority ?? 0,
      sourceUpdatedAt: hit.sourceUpdatedAt ? new Date(hit.sourceUpdatedAt) : null,
      score: hit.score,
      text: hit.text,
    };
    if (!existing || candidate.score > existing.score) bySource.set(hit.sourceId, candidate);
  }
  return [...bySource.values()].sort((a, b) => b.score - a.score);
}

/**
 * Whether a conflict is even possible for this result set.
 *
 * The budget for this feature is that a single-source turn must not gain a call,
 * so everything expensive sits behind this. Two conditions:
 *
 * 1. More than one source in the top-K. One source cannot contradict itself in a
 *    way this policy could resolve, since priority and recency are per-source.
 * 2. The top two sources score CLOSE to each other. A source scoring far below
 *    the leader is not making a competing claim, it is weaker evidence — and
 *    treating every long tail as a potential contradiction would put an LLM call
 *    on nearly every turn.
 */
export function conflictPossible(
  candidates: readonly ConflictCandidate[],
  scoreGap = env.kb.conflictScoreGap,
): boolean {
  if (candidates.length < 2) return false;
  const [first, second] = candidates;
  if (!first || !second) return false;
  // Guard against a zero/negative leading score making every ratio degenerate.
  if (first.score <= 0) return false;
  return (first.score - second.score) / first.score <= scoreGap;
}

/**
 * Resolve which source wins.
 *
 * The order is priority, then recency, then relevance, and the reasoning behind
 * that order matters more than the order itself:
 *
 * - PRIORITY first because it is the only signal a human set deliberately. An
 *   operator who marked the canonical policy page authoritative has said
 *   something no heuristic should override.
 * - RECENCY second because, absent a human decision, the newer document is the
 *   better guess about current truth.
 * - SCORE last, and reluctantly. Relevance says which passage matches the
 *   QUESTION, not which is CORRECT, so it is a tiebreak rather than a reason.
 *
 * When two sources tie on all three, this returns `unresolved` rather than
 * picking one. That is the whole point: a confident wrong answer about a refund
 * window is worse than admitting the documents disagree.
 */
export function resolveConflict(candidates: readonly ConflictCandidate[]): ConflictResolution {
  if (candidates.length === 0) return { winner: null, losers: [], resolvedBy: "unresolved" };
  if (candidates.length === 1) {
    return { winner: candidates[0]!, losers: [], resolvedBy: "score" };
  }

  const maxPriority = Math.max(...candidates.map((c) => c.priority));
  const topPriority = candidates.filter((c) => c.priority === maxPriority);
  if (topPriority.length === 1) {
    return {
      winner: topPriority[0]!,
      losers: candidates.filter((c) => c !== topPriority[0]),
      resolvedBy: "priority",
    };
  }

  // Recency, among those tied on priority. A source with no timestamp cannot
  // win on recency — an unknown date is not evidence of being current.
  const dated = topPriority.filter((c) => c.sourceUpdatedAt !== null);
  if (dated.length > 0) {
    const newest = Math.max(...dated.map((c) => c.sourceUpdatedAt!.getTime()));
    const freshest = dated.filter((c) => c.sourceUpdatedAt!.getTime() === newest);
    if (freshest.length === 1) {
      return {
        winner: freshest[0]!,
        losers: candidates.filter((c) => c !== freshest[0]),
        resolvedBy: "recency",
      };
    }
  }

  // Relevance, as a last resort and only when it is decisive.
  const maxScore = Math.max(...topPriority.map((c) => c.score));
  const best = topPriority.filter((c) => c.score === maxScore);
  if (best.length === 1) {
    return {
      winner: best[0]!,
      losers: candidates.filter((c) => c !== best[0]),
      resolvedBy: "score",
    };
  }

  // Nothing separates them. Say so.
  return { winner: null, losers: [...candidates], resolvedBy: "unresolved" };
}

export type ConflictCheck = {
  conflicted: boolean;
  /** Which fact the sources disagree about, for the operator record. */
  reason: string;
  checked: boolean;
};

/**
 * Ask whether two sources actually contradict each other on the queried fact.
 *
 * Only reached when `conflictPossible` says so. The question is deliberately
 * narrow — "do these disagree about what was ASKED" — because two documents
 * covering different aspects of a topic differ in content without contradicting,
 * and a looser prompt flags every well-covered topic as a conflict.
 */
/** The verdict is `{conflicted, reason}`. This is generous by an order of magnitude. */
const CONFLICT_CHECK_MAX_OUTPUT_TOKENS = 512;

/**
 * The model call, injectable.
 *
 * Exists so a caller — a test, most of all — can drive conflict detection
 * without a network call. `understoodSearch` threads it through for the same
 * reason it accepts an injected reranker.
 */
export type ConflictDeps = { invoke?: (system: string, user: string) => Promise<string> };

export async function checkForConflict(
  args: { query: string; candidates: readonly ConflictCandidate[] },
  deps: ConflictDeps = {},
): Promise<ConflictCheck> {
  if (args.candidates.length < 2) return { conflicted: false, reason: "", checked: false };

  try {
    const invoke =
      deps.invoke ??
      (async (system: string, user: string) => {
        // Capped: the answer is `{conflicted, reason}` and nothing more. Left
        // uncapped, OpenRouter reserves the model's full default ceiling (64k on
        // current Claude models) against the account balance and returns a 402
        // on a modest balance — which this check swallows as "no conflict",
        // silently disabling contradiction detection rather than failing loudly.
        const llm = createChatModel({
          model: env.ai.queryRewriteModel,
          temperature: 0,
          maxTokens: CONFLICT_CHECK_MAX_OUTPUT_TOKENS,
        });
        const res = await llm.invoke([
          { role: "system", content: system },
          { role: "user", content: user },
        ]);
        return contentToText(res.content);
      });

    const passages = args.candidates
      .slice(0, 4)
      .map((c, i) => `[${i + 1}] (${c.sourceTitle})\n${c.text.slice(0, 800)}`)
      .join("\n\n");

    const raw = await invoke(
      `You decide whether two knowledge-base passages CONTRADICT each other on a specific question.

Return one JSON object, no prose:
{"conflicted": true|false, "reason": "<what they disagree about, one short phrase>"}

Contradiction means they cannot both be true about the SAME fact the question
asks: different prices for the same plan, different refund windows, different
policies for the same case.

NOT a contradiction: passages covering different aspects of a topic, one being
more detailed than another, one mentioning an exception the other omits, or two
passages about genuinely different things. Different is not contradictory —
default to false unless the same question gets two incompatible answers.`,
      `QUESTION:\n${args.query}\n\nPASSAGES:\n${passages}`,
    );

    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return { conflicted: false, reason: "", checked: true };
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      conflicted?: boolean;
      reason?: string;
    };
    return {
      conflicted: parsed.conflicted === true,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      checked: true,
    };
  } catch (err) {
    // A failed check means we do not know, and "we do not know" must not become
    // "there is a conflict" — that would escalate turns for a provider hiccup.
    logger.warn("[kb] conflict check failed, treating as no conflict", {
      err: (err as Error).message,
    });
    return { conflicted: false, reason: "", checked: false };
  }
}

/**
 * Order hits so the authoritative source's passages come first.
 *
 * The losing source's passages are kept rather than dropped: the model is told
 * which one is authoritative and told not to merge, and removing the other
 * entirely would hide from the operator that a contradiction was ever there.
 */
export function orderByAuthority(
  hits: readonly KbHit[],
  resolution: ConflictResolution,
): KbHit[] {
  if (!resolution.winner) return [...hits];
  const winningId = resolution.winner.sourceId;
  const winners = hits.filter((h) => h.sourceId === winningId);
  const rest = hits.filter((h) => h.sourceId !== winningId);
  return [...winners, ...rest];
}
