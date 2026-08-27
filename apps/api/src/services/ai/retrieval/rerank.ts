// Stage 2 of retrieval: a cross-encoder reranker.
//
// Stage 1 (dense + lexical, fused) optimises RECALL: cast wide, accept noise.
// A bi-encoder scores the query and the passage separately and compares the two
// vectors, which is what makes it fast enough to run over a whole index and also
// what limits it — it never sees the query and the passage together.
//
// A cross-encoder does. It reads both at once and scores their actual relevance,
// which is far more accurate and far too slow to run over an index. Running it
// over 50 candidates rather than 500,000 is the entire trick.
//
// The second reason this matters is thresholding. A cosine score is not
// comparable across queries: 0.42 may be an excellent match for one question and
// noise for another, which is why a fixed `AI_KB_SEARCH_MIN_SCORE` is always
// either too tight or too loose. A cross-encoder score IS comparable, because it
// answers one question ("does this passage answer this query") on a consistent
// scale. That is what finally makes an honest "no relevant evidence" expressible.
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { createChatModel, contentToText } from "../llm/chat-model.js";

export type RerankDocument = { id: string; text: string };

export type RerankResult = {
  /** Index into the input array. */
  index: number;
  /** Calibrated relevance, higher is better. Comparable across queries. */
  score: number;
};

export interface Reranker {
  readonly name: string;
  rerank(query: string, documents: RerankDocument[]): Promise<RerankResult[]>;
}

/**
 * Pinecone's hosted rerank endpoint.
 *
 * Preferred because a hosted cross-encoder is an order of magnitude cheaper per
 * call than asking an LLM to do the same job, and it returns a genuinely
 * calibrated score rather than a number a language model invented.
 *
 * Called over REST rather than through the index client: rerank is an
 * account-level inference endpoint, not an index operation, so it does not hang
 * off `pc.index(...)`. The missing-key behaviour mirrors `config/pinecone.ts` —
 * degrade to a no-op rather than throwing on a path that must not fail.
 */
class PineconeReranker implements Reranker {
  readonly name = "pinecone";

  constructor(private readonly model: string) {}

  async rerank(query: string, documents: RerankDocument[]): Promise<RerankResult[]> {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) throw new Error("PINECONE_API_KEY not set");

    const res = await fetch("https://api.pinecone.io/rerank", {
      method: "POST",
      headers: {
        "Api-Key": apiKey,
        "content-type": "application/json",
        "X-Pinecone-API-Version": "2024-10",
      },
      body: JSON.stringify({
        model: this.model,
        query,
        documents: documents.map((d) => ({ id: d.id, text: d.text })),
        top_n: documents.length,
        return_documents: false,
      }),
    });

    if (!res.ok) throw new Error(`Pinecone rerank ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { data?: { index: number; score: number }[] };
    return (body.data ?? []).map((d) => ({ index: d.index, score: d.score }));
  }
}

/**
 * LLM-as-reranker fallback.
 *
 * Strictly worse than a hosted cross-encoder on every axis that matters — cost,
 * latency, and score calibration — and it exists only so a deployment without a
 * reranker provider is not stuck with stage-1 ordering. It asks for one integer
 * per passage rather than a free-form ranking, because a model asked to "sort
 * these" reliably drops or duplicates entries.
 */
class LlmReranker implements Reranker {
  readonly name = "llm";

  constructor(private readonly model: string) {}

  async rerank(query: string, documents: RerankDocument[]): Promise<RerankResult[]> {
    const llm = createChatModel({ model: this.model, temperature: 0 });
    const numbered = documents
      .map((d, i) => `[${i}] ${d.text.slice(0, 600)}`)
      .join("\n\n");

    const res = await llm.invoke([
      {
        role: "system",
        content: `Score how well each numbered passage answers the query.

Return one JSON object, no prose:
{"scores": [{"index": <number>, "score": <0.0-1.0>}]}

Include EVERY passage index exactly once. A passage that does not address the
query at all scores near 0.0 — do not spread scores evenly to be fair, the point
of this is to separate relevant from irrelevant.`,
      },
      { role: "user", content: `QUERY:\n${query}\n\nPASSAGES:\n${numbered}` },
    ]);

    const raw = contentToText(res.content).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("LLM reranker returned no JSON");
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      scores?: { index?: number; score?: number }[];
    };

    const out = (parsed.scores ?? [])
      .filter((s) => typeof s.index === "number" && typeof s.score === "number")
      .filter((s) => s.index! >= 0 && s.index! < documents.length)
      .map((s) => ({ index: s.index!, score: s.score! }));

    if (out.length === 0) throw new Error("LLM reranker scored nothing");
    return out;
  }
}

export function createReranker(): Reranker | null {
  if (!env.kb.rerankEnabled) return null;
  switch (env.kb.rerankProvider) {
    case "pinecone":
      return new PineconeReranker(env.kb.rerankModel);
    case "llm":
      return new LlmReranker(env.ai.queryRewriteModel);
    default:
      logger.warn("[kb] unknown rerank provider, reranking disabled", {
        provider: env.kb.rerankProvider,
      });
      return null;
  }
}

export type RerankOutcome<T> = {
  /** Reranked and truncated to topK, or stage-1 order when reranking did not run. */
  hits: T[];
  ran: boolean;
  provider: string | null;
  /** How many candidates stage 1 produced. */
  candidates: number;
  /** Best calibrated score, or null when reranking did not run. */
  topScore: number | null;
  /**
   * Whether the reranker's top result differs from stage 1's. This is the number
   * that says whether reranking is earning its cost: if it never changes the top
   * result, it is latency and money for nothing.
   */
  rankCorrection: boolean;
  /** True when every candidate scored below the relevance floor. */
  noRelevantEvidence: boolean;
  latencyMs: number;
};

/**
 * Run stage 2 over stage-1 candidates.
 *
 * Degrades to stage-1 ordering on any failure, which is the behaviour that
 * existed before reranking: worse retrieval, not a broken turn.
 */
export async function rerankHits<T extends { text: string }>(
  args: {
    query: string;
    candidates: T[];
    topK: number;
    keyOf: (hit: T) => string;
  },
  reranker: Reranker | null = createReranker(),
): Promise<RerankOutcome<T>> {
  const { query, candidates, topK, keyOf } = args;
  const stage1Top = candidates[0] ? keyOf(candidates[0]) : null;

  const base: RerankOutcome<T> = {
    hits: candidates.slice(0, topK),
    ran: false,
    provider: null,
    candidates: candidates.length,
    topScore: null,
    rankCorrection: false,
    noRelevantEvidence: false,
    latencyMs: 0,
  };

  if (!reranker || candidates.length === 0) return base;
  // Reranking one candidate cannot reorder anything; it can only cost money.
  if (candidates.length === 1) return { ...base, candidates: 1 };

  const started = Date.now();
  try {
    const scored = await withTimeout(
      reranker.rerank(
        query,
        candidates.map((c, i) => ({ id: String(i), text: c.text })),
      ),
      env.kb.rerankTimeoutMs,
    );

    const byIndex = new Map(scored.map((s) => [s.index, s.score]));
    const ordered = candidates
      .map((hit, index) => ({ hit, score: byIndex.get(index) ?? -Infinity }))
      .sort((a, b) => b.score - a.score);

    const latencyMs = Date.now() - started;

    // The floor gates on the BEST score, not on each passage individually.
    //
    // This distinction is the whole design, and getting it wrong the first time
    // cost multi-hop retrieval half its recall. A cross-encoder is decisive: it
    // gives the passage that directly answers the query a high score and gives
    // everything else near zero — including a passage that is genuinely REQUIRED
    // to answer a multi-hop question but does not answer it on its own. Filtering
    // per passage therefore throws away the second half of every two-source
    // answer.
    //
    // What the score reliably tells us is whether the knowledge base contains an
    // answer AT ALL, which is a property of the best candidate. So: if nothing
    // clears the floor, there is no evidence and we say so. If something does,
    // the reranker's ORDERING is trusted and the top K are kept regardless of
    // their individual scores.
    const hasEvidence = (ordered[0]?.score ?? -Infinity) >= env.kb.rerankMinScore;

    if (!hasEvidence) {
      return {
        hits: [],
        ran: true,
        provider: reranker.name,
        candidates: candidates.length,
        topScore: ordered[0]?.score ?? null,
        rankCorrection: false,
        noRelevantEvidence: true,
        latencyMs,
      };
    }

    // Carry the calibrated score onto the hit. Dropping it here used to lose
    // the only per-passage relevance number the pipeline produces, which is
    // exactly what index health needs to tell "retrieved because it is the best
    // of a bad set" from "retrieved because it answers the question".
    const hits = ordered
      .slice(0, topK)
      .map((o) => ({ ...o.hit, rerankScore: o.score }) as T);
    return {
      hits,
      ran: true,
      provider: reranker.name,
      candidates: candidates.length,
      topScore: ordered[0]!.score,
      rankCorrection: stage1Top !== null && keyOf(hits[0]!) !== stage1Top,
      noRelevantEvidence: false,
      latencyMs,
    };
  } catch (err) {
    // Stage-1 ordering stands. That is exactly the retrieval quality this system
    // had before reranking existed, so a reranker outage costs precision, not
    // availability.
    logger.warn("[kb] rerank failed, keeping stage-1 order", {
      provider: reranker.name,
      candidates: candidates.length,
      err: (err as Error).message,
    });
    return { ...base, latencyMs: Date.now() - started };
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`rerank timed out after ${ms}ms`)), ms);
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
