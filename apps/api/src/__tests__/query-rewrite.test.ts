// Query understanding.
//
// The tests that matter most here are the degradation ones. Rewriting is an
// enhancement on the hot path of every customer turn, so the question is not
// "does it produce a good query" but "what happens at 3am when the small model
// is timing out". If any failure path can break a turn, the feature is a
// liability regardless of how much recall it buys.
//
// The model is injected rather than mocked at the module boundary, so these run
// with no network and assert on real call counts.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { env } from "../config/env.js";
import {
  clearRewriteCache,
  planQueries,
  proposeFollowUpQuery,
  rawPlan,
  rewriteQuery,
} from "../services/ai/retrieval/query-rewrite.js";
import { understoodSearch } from "../services/ai/retrieval/understood-search.js";
import { hitKey, reciprocalRankFusion } from "../services/ai/retrieval/fusion.js";
import type { KbHit } from "../services/kb/search.service.js";

/** Flip a flag for one test and put it back, so ordering never matters. */
function withFlags<T extends Record<string, unknown>>(flags: T, fn: () => Promise<void> | void) {
  return async () => {
    const ai = env.ai as unknown as Record<string, unknown>;
    const previous: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(flags)) {
      previous[k] = ai[k];
      ai[k] = v;
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(previous)) ai[k] = v;
    }
  };
}

const hit = (sourceId: string, chunkIndex: number, score: number, title = sourceId): KbHit =>
  ({ sourceId, sourceTitle: title, chunkIndex, score, text: `${sourceId}#${chunkIndex}` }) as KbHit;

const json = (o: unknown) => JSON.stringify(o);

beforeEach(() => clearRewriteCache());

describe("query rewriting", () => {
  it(
    "condenses a follow-up into the standalone question it stands for",
    withFlags({ queryRewriteEnabled: true, queryExpansionCount: 0 }, async () => {
      // The case the whole feature exists for. "What about the annual one?"
      // embeds near nothing: it names no subject.
      const invoke = vi.fn(async (_s: string, user: string) => {
        expect(user).toContain("How much is the Team plan per month?");
        return json({
          standalone: "Team plan annual price",
          subQueries: [],
          paraphrases: [],
          reason: "resolved follow-up against history",
        });
      });

      const plan = await rewriteQuery(
        {
          query: "what about the annual one?",
          conversationId: "conv-1",
          history: [
            { role: "customer", content: "How much is the Team plan per month?" },
            { role: "ai", content: "The Team plan is $99 per month." },
          ],
        },
        { invoke },
      );

      expect(plan.rewritten).toBe(true);
      expect(plan.rewrittenQuery).toBe("Team plan annual price");
      // The dangling reference is gone, which is the actual requirement.
      expect(plan.rewrittenQuery.toLowerCase()).not.toContain("the annual one");
      expect(plan.originalQuery).toBe("what about the annual one?");
    }),
  );

  it(
    "passes the org's vocabulary so acronyms expand to the documents' spelling",
    withFlags({ queryRewriteEnabled: true }, async () => {
      const invoke = vi.fn(async (_s: string, user: string) => {
        expect(user).toContain("Single Sign-On (SSO)");
        return json({
          standalone: "Single Sign-On SSO configuration",
          subQueries: [],
          paraphrases: [],
          reason: "expanded acronym",
        });
      });

      const plan = await rewriteQuery(
        {
          query: "how do i set up sso",
          conversationId: "conv-2",
          vocabulary: ["Single Sign-On (SSO)", "Team plan"],
        },
        { invoke },
      );

      expect(plan.rewrittenQuery).toContain("Single Sign-On");
      // The acronym survives alongside the expansion: it is often the token the
      // documents actually use in headings.
      expect(plan.rewrittenQuery).toContain("SSO");
    }),
  );

  it(
    "splits a genuinely two-part question",
    withFlags({ queryRewriteEnabled: true }, async () => {
      const invoke = vi.fn(async () =>
        json({
          standalone: "refund window and refund request process",
          subQueries: ["refund window length", "how to request a refund"],
          paraphrases: [],
          reason: "two independent parts",
        }),
      );

      const plan = await rewriteQuery(
        { query: "what is the refund window and how do I request one?", conversationId: "c" },
        { invoke },
      );

      expect(plan.subQueries).toEqual(["refund window length", "how to request a refund"]);
      expect(planQueries(plan)).toEqual([
        "refund window and refund request process",
        "refund window length",
        "how to request a refund",
      ]);
    }),
  );

  it(
    "does not split a single-part question into a duplicate retrieval",
    withFlags({ queryRewriteEnabled: true }, async () => {
      // Models often echo the standalone query back as a lone "sub-query".
      // Retrieving it twice doubles the cost and changes nothing.
      const invoke = vi.fn(async () =>
        json({
          standalone: "Team plan monthly price",
          subQueries: ["Team plan monthly price"],
          paraphrases: [],
          reason: "single part",
        }),
      );

      const plan = await rewriteQuery(
        { query: "How much is the Team plan per month?", conversationId: "c" },
        { invoke },
      );

      expect(plan.subQueries).toEqual([]);
      expect(planQueries(plan)).toEqual(["Team plan monthly price"]);
    }),
  );

  it(
    "caches by (conversation, query) so one turn's repeat call is free",
    withFlags({ queryRewriteEnabled: true }, async () => {
      const invoke = vi.fn(async () =>
        json({ standalone: "refund policy", subQueries: [], paraphrases: [], reason: "ok" }),
      );

      const first = await rewriteQuery({ query: "refunds?", conversationId: "c1" }, { invoke });
      const second = await rewriteQuery({ query: "refunds?", conversationId: "c1" }, { invoke });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(second.rewrittenQuery).toBe(first.rewrittenQuery);

      // A different conversation must not reuse it: the rewrite was resolved
      // against another customer's history.
      await rewriteQuery({ query: "refunds?", conversationId: "c2" }, { invoke });
      expect(invoke).toHaveBeenCalledTimes(2);
    }),
  );

  describe("degradation: every failure path returns the raw query", () => {
    it(
      "on a timeout",
      withFlags({ queryRewriteEnabled: true, queryRewriteTimeoutMs: 30 }, async () => {
        const invoke = vi.fn(
          () => new Promise<string>((resolve) => setTimeout(() => resolve("{}"), 5_000)),
        );

        const plan = await rewriteQuery(
          { query: "how do refunds work", conversationId: "c" },
          { invoke },
        );

        expect(plan.rewritten).toBe(false);
        expect(plan.rewrittenQuery).toBe("how do refunds work");
        expect(plan.reason).toContain("timed out");
      }),
    );

    it(
      "on a malformed response",
      withFlags({ queryRewriteEnabled: true }, async () => {
        const invoke = vi.fn(async () => "I'm sorry, I can't help with that.");
        const plan = await rewriteQuery({ query: "refund policy", conversationId: "c" }, { invoke });
        expect(plan.rewritten).toBe(false);
        expect(plan.rewrittenQuery).toBe("refund policy");
      }),
    );

    it(
      "on valid JSON that is missing the query",
      withFlags({ queryRewriteEnabled: true }, async () => {
        // Parses fine, means nothing. Without an explicit check this would
        // silently embed an empty string.
        const invoke = vi.fn(async () => json({ subQueries: [], paraphrases: [] }));
        const plan = await rewriteQuery({ query: "refund policy", conversationId: "c" }, { invoke });
        expect(plan.rewritten).toBe(false);
        expect(plan.rewrittenQuery).toBe("refund policy");
      }),
    );

    it(
      "on a provider error",
      withFlags({ queryRewriteEnabled: true }, async () => {
        const invoke = vi.fn(async () => {
          throw new Error("402 insufficient credits");
        });
        const plan = await rewriteQuery({ query: "refund policy", conversationId: "c" }, { invoke });
        expect(plan.rewritten).toBe(false);
        expect(plan.rewrittenQuery).toBe("refund policy");
        expect(plan.reason).toContain("402");
      }),
    );

    it(
      "when the flag is off, without calling the model at all",
      withFlags({ queryRewriteEnabled: false }, async () => {
        const invoke = vi.fn();
        const plan = await rewriteQuery({ query: "refund policy", conversationId: "c" }, { invoke });
        expect(invoke).not.toHaveBeenCalled();
        expect(plan.rewrittenQuery).toBe("refund policy");
      }),
    );
  });
});

describe("reciprocal rank fusion", () => {
  it("ranks a passage two queries agree on above one query's favourite", () => {
    // b is rank 2 for both queries: 2/(60+2) = 0.03226.
    // a is rank 1 for one query only: 1/61 = 0.01639.
    // Agreement is the signal multi-query retrieval exists to capture.
    const fused = reciprocalRankFusion([
      { query: "q1", hits: [hit("a", 0, 0.9), hit("b", 0, 0.5)] },
      { query: "q2", hits: [hit("c", 0, 0.8), hit("b", 0, 0.5)] },
    ]);
    expect(fused[0]!.sourceId).toBe("b");
    expect(fused[0]!.matchedQueries).toEqual(["q1", "q2"]);
  });

  it("fuses on rank, not on score", () => {
    // 'low' is rank 1 in both lists despite a far worse cosine score. Fusing on
    // score would let whichever query produced bigger absolute numbers win,
    // and cosine scores are not comparable across different query embeddings.
    const fused = reciprocalRankFusion([
      { query: "q1", hits: [hit("low", 0, 0.21), hit("high", 0, 0.95)] },
      { query: "q2", hits: [hit("low", 0, 0.22), hit("high", 0, 0.94)] },
    ]);
    expect(fused[0]!.sourceId).toBe("low");
  });

  it("deduplicates by chunk, keeping the best raw score for the citation", () => {
    const fused = reciprocalRankFusion([
      { query: "q1", hits: [hit("a", 3, 0.4)] },
      { query: "q2", hits: [hit("a", 3, 0.7)] },
    ]);
    expect(fused).toHaveLength(1);
    expect(fused[0]!.score).toBe(0.7);
  });

  it("treats different chunks of one source as different passages", () => {
    const fused = reciprocalRankFusion([{ query: "q", hits: [hit("a", 0, 0.9), hit("a", 1, 0.8)] }]);
    expect(fused).toHaveLength(2);
    expect(hitKey(fused[0]!)).not.toBe(hitKey(fused[1]!));
  });

  it("breaks ties deterministically so an unchanged corpus ranks identically", () => {
    const lists = [{ query: "q", hits: [hit("b", 0, 0.5), hit("a", 0, 0.5)] }];
    const first = reciprocalRankFusion(lists).map(hitKey);
    const second = reciprocalRankFusion(lists).map(hitKey);
    expect(first).toEqual(second);
  });
});

describe("understood search", () => {
  const retrieverFor = (byQuery: Record<string, KbHit[]>) => ({
    searchHits: vi.fn(async (q: string) => byQuery[q] ?? []),
  });

  it(
    "runs exactly one retrieval with the model's own query when rewriting is off",
    withFlags(
      { queryRewriteEnabled: false, queryHydeEnabled: false, queryFollowUpRoundEnabled: false },
      async () => {
        const retriever = retrieverFor({ "refund policy": [hit("refunds", 0, 0.8)] });
        const { hits, record } = await understoodSearch({
          query: "refund policy",
          conversationId: "c",
          retriever,
        });

        expect(retriever.searchHits).toHaveBeenCalledTimes(1);
        // The second argument is stage 1's candidate-count override, and it is
        // `undefined` here on purpose: with reranking off there is no widening,
        // so the retriever uses its own default exactly as it did before
        // two-stage retrieval existed.
        expect(retriever.searchHits).toHaveBeenCalledWith("refund policy", undefined);
        expect(hits).toHaveLength(1);
        expect(record.rewritten).toBe(false);
        expect(record.queriesRun).toEqual(["refund policy"]);
      },
    ),
  );

  it(
    "retrieves for every planned query and fuses the results",
    withFlags(
      { queryRewriteEnabled: true, queryExpansionCount: 2, queryFollowUpRoundEnabled: false },
      async () => {
        const retriever = retrieverFor({
          "refund window": [hit("refunds", 0, 0.8)],
          "money back timeframe": [hit("refunds", 0, 0.7), hit("billing", 0, 0.6)],
        });
        const invoke = vi.fn(async () =>
          json({
            standalone: "refund window",
            subQueries: [],
            paraphrases: ["money back timeframe"],
            reason: "expanded",
          }),
        );

        const { hits, record } = await understoodSearch(
          { query: "can i get my money back", conversationId: "c", retriever },
          { invoke },
        );

        expect(retriever.searchHits).toHaveBeenCalledTimes(2);
        expect(record.queriesRun).toEqual(["refund window", "money back timeframe"]);
        // Deduped across both lists.
        expect(hits.map((h) => h.sourceId)).toEqual(["refunds", "billing"]);
      },
    ),
  );

  describe("the one follow-up round", () => {
    // The multi-hop case, named explicitly. "Is the plan my account is on
    // covered by the EU refund policy?" cannot be answered in one pass: the
    // second query's subject (which plan) only exists after the first round.
    const FIRST_QUERY = "EU refund policy plan coverage";
    const SECOND_QUERY = "Team plan EU refund eligibility";

    it(
      "fires once for a multi-hop question a single pass provably fails",
      withFlags(
        { queryRewriteEnabled: true, queryExpansionCount: 0, queryFollowUpRoundEnabled: true },
        async () => {
          const retriever = retrieverFor({
            [FIRST_QUERY]: [hit("refunds", 0, 0.7)],
            // Only reachable via the follow-up: the first query never returns it.
            [SECOND_QUERY]: [hit("billing", 2, 0.8)],
          });

          let call = 0;
          const invoke = vi.fn(async () => {
            call += 1;
            if (call === 1) {
              return json({
                standalone: FIRST_QUERY,
                subQueries: [],
                paraphrases: [],
                reason: "resolved",
              });
            }
            return json({ sufficient: false, query: SECOND_QUERY });
          });

          const { hits, record } = await understoodSearch(
            {
              query: "is the plan my account is on covered by the EU refund policy?",
              conversationId: "c",
              retriever,
            },
            { invoke },
          );

          expect(record.followUpRan).toBe(true);
          expect(record.queriesRun).toEqual([FIRST_QUERY, SECOND_QUERY]);
          // The evidence the single pass could not reach is now present.
          expect(hits.map((h) => h.sourceId)).toContain("billing");
        },
      ),
    );

    it(
      "fires at most once, even if the model would ask again",
      withFlags(
        { queryRewriteEnabled: true, queryExpansionCount: 0, queryFollowUpRoundEnabled: true },
        async () => {
          const retriever = retrieverFor({ q: [hit("a", 0, 0.5)], more: [hit("b", 0, 0.5)] });
          const invoke = vi.fn(async (_s: string, user: string) =>
            user.includes("QUERIES ALREADY RUN")
              ? json({ sufficient: false, query: "more" })
              : json({ standalone: "q", subQueries: [], paraphrases: [], reason: "r" }),
          );

          await understoodSearch({ query: "anything", conversationId: "c", retriever }, { invoke });

          // One rewrite + one follow-up proposal. A second proposal would mean
          // the round is not bounded, which is the whole point of the design.
          expect(invoke).toHaveBeenCalledTimes(2);
          expect(retriever.searchHits).toHaveBeenCalledTimes(2);
        },
      ),
    );

    it(
      "does not fire on a simple question the first round answered",
      withFlags(
        { queryRewriteEnabled: true, queryExpansionCount: 0, queryFollowUpRoundEnabled: true },
        async () => {
          const retriever = retrieverFor({ "Team plan price": [hit("billing", 0, 0.9)] });
          const invoke = vi.fn(async (_s: string, user: string) =>
            user.includes("QUERIES ALREADY RUN")
              ? json({ sufficient: true, query: null })
              : json({
                  standalone: "Team plan price",
                  subQueries: [],
                  paraphrases: [],
                  reason: "r",
                }),
          );

          const { record } = await understoodSearch(
            { query: "how much is the Team plan?", conversationId: "c", retriever },
            { invoke },
          );

          expect(record.followUpRan).toBe(false);
          expect(retriever.searchHits).toHaveBeenCalledTimes(1);
        },
      ),
    );

    it(
      "never fires when the flag is off, and costs nothing",
      withFlags(
        { queryRewriteEnabled: true, queryExpansionCount: 0, queryFollowUpRoundEnabled: false },
        async () => {
          const retriever = retrieverFor({ q: [hit("a", 0, 0.5)] });
          const invoke = vi.fn(async () =>
            json({ standalone: "q", subQueries: [], paraphrases: [], reason: "r" }),
          );

          const { record } = await understoodSearch(
            { query: "anything", conversationId: "c", retriever },
            { invoke },
          );

          expect(record.followUpRan).toBe(false);
          expect(invoke).toHaveBeenCalledTimes(1);
        },
      ),
    );

    it(
      "ignores a follow-up that repeats a query already run",
      withFlags(
        { queryRewriteEnabled: true, queryFollowUpRoundEnabled: true },
        async () => {
          const proposal = await proposeFollowUpQuery(
            { originalQuery: "q", queriesRun: ["refund window"], passages: [] },
            { invoke: async () => json({ sufficient: false, query: "Refund Window" }) },
          );
          expect(proposal).toBeNull();
        },
      ),
    );

    it(
      "returns null rather than throwing when the proposal is malformed",
      withFlags({ queryFollowUpRoundEnabled: true }, async () => {
        const proposal = await proposeFollowUpQuery(
          { originalQuery: "q", queriesRun: [], passages: [] },
          { invoke: async () => "not json at all" },
        );
        expect(proposal).toBeNull();
      }),
    );
  });

  it(
    "records both queries on the returned record, ready for telemetry",
    withFlags({ queryRewriteEnabled: true, queryExpansionCount: 0 }, async () => {
      const retriever = retrieverFor({ "refund window length": [hit("refunds", 0, 0.8)] });
      const invoke = vi.fn(async () =>
        json({
          standalone: "refund window length",
          subQueries: [],
          paraphrases: [],
          reason: "stripped filler",
        }),
      );

      const { record } = await understoodSearch(
        {
          query: "hey so i was wondering if maybe you could tell me about refunds",
          conversationId: "c",
          retriever,
        },
        { invoke },
      );

      expect(record.originalQuery).toBe(
        "hey so i was wondering if maybe you could tell me about refunds",
      );
      expect(record.rewrittenQuery).toBe("refund window length");
      expect(record.rewritten).toBe(true);
      // The rewrite call is timed separately from the retrieval it triggers:
      // the 400ms budget is about the rewrite, and folding retrieval in would
      // make a fast rewrite look slow whenever Pinecone is slow.
      expect(record.rewriteLatencyMs).toBeGreaterThanOrEqual(0);
      expect(record.totalLatencyMs).toBeGreaterThanOrEqual(record.rewriteLatencyMs);
    }),
  );

  it("keeps the raw query when the plan produced nothing usable", () => {
    expect(planQueries(rawPlan("  ", "empty"))).toEqual(["  "]);
    expect(planQueries(rawPlan("refunds", "disabled"))).toEqual(["refunds"]);
  });
});
