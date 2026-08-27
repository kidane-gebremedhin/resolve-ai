// Stage 2: cross-encoder reranking.
//
// The tests that matter are the degradation ones and the widen-on-empty one.
// Reranking sits on the hot path of every KB search and calls an external
// service, so "what happens when it is down" decides whether it is an
// improvement or a liability. And the widen-on-empty test is here because that
// behaviour was a deliberate hedge that a calibrated score makes unnecessary and
// actively harmful — the test proves the hedge is gone.

import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { rerankHits, type Reranker } from "../services/ai/retrieval/rerank.js";
import { understoodSearch } from "../services/ai/retrieval/understood-search.js";
import { KnowledgeBaseRetriever } from "../services/ai/retrieval/kb-retriever.js";
import * as searchService from "../services/kb/search.service.js";
import type { KbHit } from "../services/kb/search.service.js";

/** Flip config for one test and restore it, so ordering never matters. */
function withKb<T extends Record<string, unknown>>(flags: T, fn: () => Promise<void> | void) {
  return async () => {
    const kb = env.kb as unknown as Record<string, unknown>;
    const previous: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(flags)) {
      previous[k] = kb[k];
      kb[k] = v;
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(previous)) kb[k] = v;
    }
  };
}

const hit = (id: string, text: string, score = 0.5): KbHit => ({
  sourceId: "src",
  sourceTitle: "Doc",
  chunkIndex: Number(id),
  chunkId: `src:${id}`,
  text,
  score,
});

/** A reranker driven by a fixed score-per-text map, so ordering is deterministic. */
const scriptedReranker = (scores: Record<string, number>): Reranker => ({
  name: "scripted",
  rerank: vi.fn(async (_q: string, docs: { id: string; text: string }[]) =>
    docs.map((d, index) => ({ index, score: scores[d.text] ?? 0 })),
  ),
});

describe("rerankHits", () => {
  it(
    "reorders a case where the closest stage-1 match is not the relevant one",
    withKb({ rerankMinScore: 0.02 }, async () => {
      // The planted case: "annual plan cost" retrieves a passage about the
      // ANNUAL REPORT first, because it shares the rarest token. A bi-encoder
      // compares two separately-computed vectors and cannot tell the difference;
      // a cross-encoder reads the query and passage together and can.
      const candidates = [
        hit("0", "Our annual report is published each January.", 0.61),
        hit("1", "The Team plan costs $990 when billed annually.", 0.55),
        hit("2", "Support is available Monday to Friday.", 0.40),
      ];

      const outcome = await rerankHits(
        { query: "annual plan cost", candidates, topK: 2, keyOf: (h) => h.chunkId! },
        scriptedReranker({
          "Our annual report is published each January.": 0.01,
          "The Team plan costs $990 when billed annually.": 0.94,
          "Support is available Monday to Friday.": 0.001,
        }),
      );

      expect(outcome.ran).toBe(true);
      expect(outcome.hits[0]!.chunkId).toBe("src:1");
      // Stage 1 had the report first; stage 2 corrected it. This flag is what
      // says whether reranking is earning its cost.
      expect(outcome.rankCorrection).toBe(true);
      // Two kept, because topK is 2 and the floor gates on the BEST score
      // rather than filtering each passage. Filtering per passage looks tidier
      // and silently destroys multi-hop answers, whose second source is
      // required but scores near zero on its own.
      expect(outcome.hits).toHaveLength(2);
      expect(outcome.hits.map((h) => h.chunkId)).toEqual(["src:1", "src:0"]);
    }),
  );

  it(
    "reports rankCorrection false when it agrees with stage 1",
    withKb({ rerankMinScore: 0.02 }, async () => {
      const candidates = [hit("0", "relevant"), hit("1", "irrelevant")];
      const outcome = await rerankHits(
        { query: "q", candidates, topK: 2, keyOf: (h) => h.chunkId! },
        scriptedReranker({ relevant: 0.9, irrelevant: 0.3 }),
      );
      expect(outcome.rankCorrection).toBe(false);
      expect(outcome.hits.map((h) => h.chunkId)).toEqual(["src:0", "src:1"]);
    }),
  );

  describe("degradation preserves stage-1 ordering", () => {
    const candidates = [hit("0", "first"), hit("1", "second"), hit("2", "third")];

    it("on a provider error", async () => {
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
      const outcome = await rerankHits(
        { query: "q", candidates, topK: 2, keyOf: (h) => h.chunkId! },
        {
          name: "boom",
          rerank: async () => {
            throw new Error("502 from provider");
          },
        },
      );

      expect(outcome.ran).toBe(false);
      // Exactly the retrieval quality that existed before reranking: worse
      // precision, not a broken turn.
      expect(outcome.hits.map((h) => h.chunkId)).toEqual(["src:0", "src:1"]);
      expect(outcome.noRelevantEvidence).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        "[kb] rerank failed, keeping stage-1 order",
        expect.objectContaining({ err: "502 from provider" }),
      );
      warn.mockRestore();
    });

    it(
      "on a timeout",
      withKb({ rerankTimeoutMs: 50 }, async () => {
        const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
        const outcome = await rerankHits(
          { query: "q", candidates, topK: 2, keyOf: (h) => h.chunkId! },
          { name: "slow", rerank: () => new Promise(() => {}) },
        );

        expect(outcome.ran).toBe(false);
        expect(outcome.hits.map((h) => h.chunkId)).toEqual(["src:0", "src:1"]);
        expect(warn).toHaveBeenCalledWith(
          "[kb] rerank failed, keeping stage-1 order",
          expect.objectContaining({ err: expect.stringContaining("timed out") }),
        );
        warn.mockRestore();
      }),
    );

    it("when no reranker is configured", async () => {
      const outcome = await rerankHits(
        { query: "q", candidates, topK: 2, keyOf: (h) => h.chunkId! },
        null,
      );
      expect(outcome.ran).toBe(false);
      expect(outcome.hits.map((h) => h.chunkId)).toEqual(["src:0", "src:1"]);
    });

    it("does not call the provider for a single candidate", async () => {
      // Reranking one passage cannot reorder anything; it can only cost money.
      const reranker = scriptedReranker({ only: 0.9 });
      const outcome = await rerankHits(
        { query: "q", candidates: [hit("0", "only")], topK: 5, keyOf: (h) => h.chunkId! },
        reranker,
      );
      expect(reranker.rerank).not.toHaveBeenCalled();
      expect(outcome.hits).toHaveLength(1);
    });
  });

  describe("no relevant evidence", () => {
    it(
      "returns empty and says so when every candidate is below the floor",
      withKb({ rerankMinScore: 0.02 }, async () => {
        const outcome = await rerankHits(
          {
            query: "do you have a mobile app",
            candidates: [hit("0", "refund policy"), hit("1", "api rate limits")],
            topK: 5,
            keyOf: (h) => h.chunkId!,
          },
          scriptedReranker({ "refund policy": 0.001, "api rate limits": 0.0004 }),
        );

        expect(outcome.noRelevantEvidence).toBe(true);
        expect(outcome.hits).toEqual([]);
        // The top score is still reported: an operator triaging a knowledge gap
        // wants to know whether it missed by a little or by a mile.
        expect(outcome.topScore).toBeCloseTo(0.001, 5);
      }),
    );

    it(
      "keeps the supporting passages once the best one clears the floor",
      withKb({ rerankMinScore: 0.02 }, async () => {
        // The multi-hop case, and the reason the floor gates on the best score.
        // A cross-encoder gives the passage that directly answers the query a
        // high score and everything else near zero — including a passage that is
        // REQUIRED to answer but does not answer on its own. Filtering per
        // passage would drop it and leave half an answer.
        const outcome = await rerankHits(
          {
            query: "is my plan covered by the EU refund policy",
            candidates: [
              hit("0", "The Team plan costs $990 annually."),
              hit("1", "EU customers have a statutory 14-day right of withdrawal."),
            ],
            topK: 5,
            keyOf: (h) => h.chunkId!,
          },
          scriptedReranker({
            "The Team plan costs $990 annually.": 0.0008,
            "EU customers have a statutory 14-day right of withdrawal.": 0.62,
          }),
        );

        expect(outcome.noRelevantEvidence).toBe(false);
        // Both survive: ordering is trusted, per-passage filtering is not.
        expect(outcome.hits.map((h) => h.chunkId)).toEqual(["src:1", "src:0"]);
      }),
    );
  });
});

describe("widen-on-empty, once a calibrated score exists", () => {
  type SearchArgs = { minScore?: number };
  // Typed explicitly: `vi.spyOn`'s inferred signature widens the argument to
  // `unknown`, and the assertions below need to read `minScore` off it.
  let searchSpy: ReturnType<typeof vi.fn<(args: SearchArgs) => Promise<KbHit[]>>>;

  beforeEach(() => {
    searchSpy = vi.spyOn(searchService, "searchKb") as unknown as typeof searchSpy;
  });
  afterEach(() => {
    searchSpy.mockRestore();
  });

  it(
    "used to push a zero-relevance passage into the prompt, and no longer can",
    withKb({ rerankEnabled: true }, async () => {
      // This is the exact scenario the hedge was built for: the score floor
      // filters everything, so the retriever re-queries with minScore 0 and
      // hands the model whatever came back — a passage with no relevance at all,
      // indistinguishable to the model from real evidence.
      searchSpy.mockImplementation(async (args: SearchArgs) =>
        args.minScore === 0 ? [hit("0", "completely unrelated passage", 0.004)] : [],
      );

      const retriever = new KnowledgeBaseRetriever({
        organizationId: "org",
        agentId: "agent",
        widenOnEmpty: true,
      });

      const hits = await retriever.searchHits("something the KB has no answer for");

      // The widening call was never made: with reranking on, stage 2 decides
      // relevance on a comparable scale, so this hedge would only feed it noise.
      expect(hits).toEqual([]);
      expect(searchSpy).toHaveBeenCalledTimes(1);
      expect(searchSpy.mock.calls.every(([a]) => a.minScore !== 0)).toBe(true);
    }),
  );

  it(
    "still widens when reranking is off, so the old behaviour is intact",
    withKb({ rerankEnabled: false }, async () => {
      // Without a calibrated score downstream there is nothing to catch an
      // irrelevant passage, and the original reasoning still applies.
      searchSpy.mockImplementation(async (args: SearchArgs) =>
        args.minScore === 0 ? [hit("0", "weak but something", 0.004)] : [],
      );

      const retriever = new KnowledgeBaseRetriever({
        organizationId: "org",
        agentId: "agent",
        widenOnEmpty: true,
      });

      const hits = await retriever.searchHits("q");
      expect(hits).toHaveLength(1);
      expect(searchSpy).toHaveBeenCalledTimes(2);
    }),
  );
});

describe("two-stage retrieval end to end", () => {
  it(
    "widens stage 1 beyond the context size, then cuts back to it",
    withKb({ rerankEnabled: true, rerankCandidates: 50, rerankMinScore: 0.02 }, async () => {
      // The separation that used to be missing: one setting cannot be both the
      // candidate pool and the prompt size.
      const searchHits = vi.fn(async (_q: string, topK?: number) => {
        expect(topK).toBe(50); // stage 1 asked for the wide pool
        return Array.from({ length: 20 }, (_, i) => hit(String(i), `passage ${i}`, 0.9 - i * 0.01));
      });

      const result = await understoodSearch({
        query: "q",
        conversationId: "c",
        retriever: { searchHits },
        topK: 5,
        reranker: {
          name: "scripted",
          // Reverse stage 1's order, so the correction is unambiguous.
          rerank: async (_q, docs) => docs.map((_d, index) => ({ index, score: index / 100 })),
        },
      });

      expect(searchHits).toHaveBeenCalledTimes(1);
      // Cut to the context size, not the candidate count.
      expect(result.hits).toHaveLength(5);
      expect(result.hits[0]!.chunkId).toBe("src:19");
      expect(result.record.rerank.ran).toBe(true);
      expect(result.record.rerank.candidates).toBe(20);
      expect(result.record.rerank.rankCorrection).toBe(true);
    }),
  );

  it(
    "surfaces no-relevant-evidence to the caller",
    withKb({ rerankEnabled: true, rerankMinScore: 0.5 }, async () => {
      const result = await understoodSearch({
        query: "do you have a mobile app",
        conversationId: "c",
        retriever: {
          searchHits: async () => [hit("0", "refunds"), hit("1", "billing")],
        },
        topK: 5,
        reranker: {
          name: "scripted",
          rerank: async (_q, docs) => docs.map((_d, index) => ({ index, score: 0.01 })),
        },
      });

      expect(result.noRelevantEvidence).toBe(true);
      expect(result.hits).toEqual([]);
      expect(result.record.rerank.noRelevantEvidence).toBe(true);
    }),
  );

  it(
    "does not widen stage 1 when reranking is off",
    withKb({ rerankEnabled: false }, async () => {
      const searchHits = vi.fn(async (_q: string, topK?: number) => {
        // Undefined means "use the retriever's own default", i.e. exactly the
        // behaviour before two-stage retrieval existed.
        expect(topK).toBeUndefined();
        return [hit("0", "a")];
      });

      const result = await understoodSearch({
        query: "q",
        conversationId: "c",
        retriever: { searchHits },
        topK: 5,
      });

      expect(result.record.rerank.ran).toBe(false);
      expect(result.hits).toHaveLength(1);
    }),
  );
});
