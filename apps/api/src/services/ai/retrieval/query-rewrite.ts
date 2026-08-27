// Query understanding: what actually gets embedded, instead of whatever the
// customer typed.
//
// The retriever embeds a string. That string used to be the model's paraphrase
// of the customer's message, which fails in four predictable ways: a follow-up
// ("what about the annual one?") carries no subject, a typo embeds near
// nothing, a two-part question embeds near the midpoint of two topics and
// matches neither, and a customer's vocabulary rarely matches the
// documentation's.
//
// Everything here is an ENHANCEMENT. Every failure path returns the raw query,
// matching the degradation style already in `search.service.ts`: retrieval that
// depends on a second model call is retrieval that breaks twice as often.
import { createHash } from "node:crypto";
import { createChatModel, contentToText } from "../llm/chat-model.js";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";

export type ConversationTurn = { role: string; content: string };

export type RewritePlan = {
  /** The query as the model handed it to the tool, always preserved. */
  originalQuery: string;
  /**
   * The single best standalone form: a follow-up resolved against history,
   * pleasantries stripped, acronyms expanded, obvious typos corrected. Equal to
   * `originalQuery` when rewriting is off or failed.
   */
  rewrittenQuery: string;
  /** Independent parts of a multi-part question. Empty when the question is single-part. */
  subQueries: string[];
  /** Paraphrases for recall on vocabulary mismatch. Empty when expansion is off. */
  paraphrases: string[];
  /** A hypothetical answer to embed instead of the question, when HyDE is on. */
  hypotheticalAnswer: string | null;
  /** Why the plan is what it is, for the log line and for debugging a bad retrieval. */
  reason: string;
  /** False when anything failed and the raw query is standing in. */
  rewritten: boolean;
  latencyMs: number;
};

export function rawPlan(query: string, reason: string, latencyMs = 0): RewritePlan {
  return {
    originalQuery: query,
    rewrittenQuery: query,
    subQueries: [],
    paraphrases: [],
    hypotheticalAnswer: null,
    reason,
    rewritten: false,
    latencyMs,
  };
}

/**
 * Every distinct string this plan wants embedded, in priority order.
 *
 * The rewritten query leads because it is the highest-precision form; sub-queries
 * follow because a multi-part question needs each part retrieved separately;
 * paraphrases come last because they trade precision for recall. Order matters:
 * RRF weights by rank, so the leader decides ties.
 */
export function planQueries(plan: RewritePlan): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of [
    plan.hypotheticalAnswer ?? plan.rewrittenQuery,
    ...plan.subQueries,
    ...plan.paraphrases,
  ]) {
    const trimmed = q?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.length > 0 ? out : [plan.originalQuery];
}

const SYSTEM = `You rewrite customer support questions into search queries for a
vector search over a company's knowledge base. You do not answer anything.

Return one JSON object, no prose, no markdown fence:
{
  "standalone": "<the question rewritten to stand alone, 3-15 words>",
  "subQueries": ["<one per INDEPENDENT part of a multi-part question>"],
  "paraphrases": ["<alternative phrasings using different vocabulary>"],
  "reason": "<a few words on what you changed>"
}

Rules:
- RESOLVE FOLLOW-UPS against the conversation. "What about the annual one?"
  after a question about the Team plan's monthly price becomes "Team plan annual
  price". A query that still contains "it", "that one", "the annual one" or any
  other dangling reference is a failure.
- STRIP pleasantries, hedging and filler. "hey so I was wondering if maybe you
  could tell me whether you do refunds" becomes "refund policy".
- FIX obvious typos. Keep product names, error codes, order ids and numbers
  EXACTLY as written: they are often the highest-signal tokens in the query.
- EXPAND acronyms you are told about, keeping the acronym too.
- subQueries ONLY for genuinely independent parts. "What is the refund window
  and how do I request one?" is two. "How much is the Team plan per month?" is
  one, so return an empty array. Never split a single question into fragments.
- paraphrases use DIFFERENT words for the same need, not word order shuffles.
- Output queries, never answers, and never invent facts about the company.`;

function buildUserPrompt(args: {
  query: string;
  history: ConversationTurn[];
  vocabulary: string[];
  expansionCount: number;
}): string {
  const parts: string[] = [];
  if (args.history.length > 0) {
    parts.push(
      `CONVERSATION SO FAR (oldest first):\n${args.history
        .map((t) => `${t.role === "ai" ? "assistant" : "customer"}: ${t.content}`)
        .join("\n")}`,
    );
  }
  if (args.vocabulary.length > 0) {
    parts.push(
      `KNOWN PRODUCT AND DOCUMENT NAMES (use these spellings):\n${args.vocabulary.join(", ")}`,
    );
  }
  parts.push(`Produce at most ${args.expansionCount} paraphrases.`);
  parts.push(`CUSTOMER QUERY:\n${args.query}`);
  return parts.join("\n\n---\n\n");
}

function parsePlan(raw: string): {
  standalone: string;
  subQueries: string[];
  paraphrases: string[];
  reason: string;
} {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in rewrite response");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;

  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];

  const standalone = typeof parsed.standalone === "string" ? parsed.standalone.trim() : "";
  if (!standalone) throw new Error("rewrite response has no standalone query");

  return {
    standalone,
    subQueries: strings(parsed.subQueries),
    paraphrases: strings(parsed.paraphrases),
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}

/**
 * Per-turn cache, keyed by (conversationId, raw query hash).
 *
 * The agent can call `search_kb` more than once in a turn, sometimes with the
 * same query, and re-deriving an identical rewrite is a wasted call on the hot
 * path. Entries expire on a short TTL rather than living for the conversation:
 * history moves, and a rewrite computed against three turns ago is the exact
 * staleness this feature exists to prevent.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { plan: RewritePlan; at: number }>();

function cacheKey(conversationId: string, query: string): string {
  return `${conversationId}:${createHash("sha256").update(query).digest("hex").slice(0, 16)}`;
}

export function clearRewriteCache(): void {
  cache.clear();
}

/** A timeout that rejects, so a slow rewrite degrades instead of stalling the turn. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`query rewrite timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e as Error);
      },
    );
  });
}

export type RewriteDeps = {
  /** Injected so tests can drive the model without a network call. */
  invoke?: (system: string, user: string) => Promise<string>;
};

export async function rewriteQuery(
  args: {
    query: string;
    conversationId: string;
    history?: ConversationTurn[];
    /** Product names, acronyms and KB source titles, so the rewrite uses the org's words. */
    vocabulary?: string[];
  },
  deps: RewriteDeps = {},
): Promise<RewritePlan> {
  const query = args.query.trim();
  if (!query) return rawPlan(query, "empty query");
  if (!env.ai.queryRewriteEnabled) return rawPlan(query, "rewrite disabled");

  const key = cacheKey(args.conversationId, query);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...hit.plan, reason: `${hit.plan.reason} (cached)` };
  }

  const started = Date.now();
  try {
    const invoke =
      deps.invoke ??
      (async (system: string, user: string) => {
        const llm = createChatModel({
          model: env.ai.queryRewriteModel,
          temperature: 0,
        });
        const res = await llm.invoke([
          { role: "system", content: system },
          { role: "user", content: user },
        ]);
        return contentToText(res.content);
      });

    const raw = await withTimeout(
      invoke(
        SYSTEM,
        buildUserPrompt({
          query,
          history: (args.history ?? []).slice(-env.ai.queryRewriteHistoryTurns),
          vocabulary: args.vocabulary ?? [],
          expansionCount: env.ai.queryExpansionCount,
        }),
      ),
      env.ai.queryRewriteTimeoutMs,
    );

    const parsed = parsePlan(raw);
    const latencyMs = Date.now() - started;

    const plan: RewritePlan = {
      originalQuery: query,
      rewrittenQuery: parsed.standalone,
      // A single-part question sometimes comes back as one "sub-query" equal to
      // the standalone form. Retrieving it twice would double the cost and
      // change nothing.
      subQueries:
        parsed.subQueries.length > 1
          ? parsed.subQueries
          : [],
      paraphrases: parsed.paraphrases.slice(0, env.ai.queryExpansionCount),
      hypotheticalAnswer: null,
      reason: parsed.reason || "rewritten",
      rewritten: true,
      latencyMs,
    };

    cache.set(key, { plan, at: Date.now() });
    return plan;
  } catch (err) {
    // Every failure lands here: timeout, malformed JSON, provider error. The raw
    // query still retrieves something, which is strictly better than failing the
    // turn over an optimisation.
    const latencyMs = Date.now() - started;
    logger.warn("[ai] query rewrite failed, using raw query", {
      err: (err as Error).message,
      latencyMs,
    });
    return rawPlan(query, `fallback: ${(err as Error).message}`, latencyMs);
  }
}

/**
 * Generate a hypothetical answer to embed instead of the question.
 *
 * The premise is that a made-up answer sits closer in embedding space to the
 * real passage than the question does. It helps on some corpora and hurts on
 * others, so it is behind its own flag and is only worth keeping if the eval
 * harness says so. It costs a second small-model call, which is why it is not
 * folded into the main rewrite.
 */
export async function generateHypotheticalAnswer(
  query: string,
  deps: RewriteDeps = {},
): Promise<string | null> {
  if (!env.ai.queryHydeEnabled) return null;
  try {
    const invoke =
      deps.invoke ??
      (async (system: string, user: string) => {
        const llm = createChatModel({ model: env.ai.queryRewriteModel, temperature: 0 });
        const res = await llm.invoke([
          { role: "system", content: system },
          { role: "user", content: user },
        ]);
        return contentToText(res.content);
      });

    const raw = await withTimeout(
      invoke(
        "Write a short, plausible passage (2-3 sentences) that would answer the user's question if it appeared in a company help centre. Invent specifics freely: this text is never shown to anyone, it is only embedded to find the real passage. Output the passage only.",
        query,
      ),
      env.ai.queryRewriteTimeoutMs,
    );
    const text = raw.trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    logger.warn("[ai] HyDE generation failed, using the question", {
      err: (err as Error).message,
    });
    return null;
  }
}

/**
 * Ask whether one more retrieval would answer what the first round could not.
 *
 * This is the bounded version of "let the agent plan what to retrieve and in
 * what order". A real planner is the most expensive thing that can be added to a
 * per-turn path, so this is capped at exactly one extra round, has no graph
 * node, no sufficiency-check model of its own, and reuses the same small model.
 *
 * Returns null when the evidence is sufficient, which is the common case and
 * must stay cheap.
 */
export async function proposeFollowUpQuery(
  args: {
    originalQuery: string;
    queriesRun: string[];
    passages: { title: string; text: string }[];
  },
  deps: RewriteDeps = {},
): Promise<string | null> {
  if (!env.ai.queryFollowUpRoundEnabled) return null;
  try {
    const invoke =
      deps.invoke ??
      (async (system: string, user: string) => {
        const llm = createChatModel({ model: env.ai.queryRewriteModel, temperature: 0 });
        const res = await llm.invoke([
          { role: "system", content: system },
          { role: "user", content: user },
        ]);
        return contentToText(res.content);
      });

    const context = args.passages
      .slice(0, 8)
      .map((p, i) => `[${i + 1}] (${p.title}) ${p.text.slice(0, 400)}`)
      .join("\n\n");

    const raw = await withTimeout(
      invoke(
        `You decide whether one more knowledge-base search is needed.

Return one JSON object, no prose:
{"sufficient": true|false, "query": "<the ONE query that would fill the gap, or null>"}

Say sufficient:true unless a SPECIFIC fact the question needs is plainly absent
from the passages. Answering a multi-hop question often needs a second lookup
whose subject only becomes clear from the first round's results — that is the
case this exists for. Wanting more detail on something already covered is NOT.
There is exactly one more search available, so name the single most valuable one.`,
        `QUESTION:\n${args.originalQuery}\n\n---\n\nQUERIES ALREADY RUN:\n${args.queriesRun.join("\n")}\n\n---\n\nPASSAGES RETRIEVED:\n${context || "(none)"}`,
      ),
      env.ai.queryRewriteTimeoutMs,
    );

    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
      sufficient?: boolean;
      query?: unknown;
    };
    if (parsed.sufficient !== false) return null;
    const q = typeof parsed.query === "string" ? parsed.query.trim() : "";
    if (!q) return null;
    // A follow-up identical to something already run buys nothing and costs a
    // retrieval.
    if (args.queriesRun.some((r) => r.toLowerCase() === q.toLowerCase())) return null;
    return q;
  } catch (err) {
    logger.warn("[ai] follow-up query proposal failed", { err: (err as Error).message });
    return null;
  }
}
