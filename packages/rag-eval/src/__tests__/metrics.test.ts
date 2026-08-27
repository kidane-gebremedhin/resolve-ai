// Every metric against a hand-computed fixture.
//
// These exist because a metric that is subtly wrong is worse than no metric: it
// produces a number that moves, that people trust, and that points the wrong
// way. Each expectation below is a value worked out by hand in the comment
// above it, not a snapshot of whatever the code happened to return.

import { describe, expect, it } from "vitest";
import {
  meanOf,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  type RankedItem,
} from "../metrics/retrieval.js";
import {
  citationAccuracy,
  contextPrecision,
  contextRecall,
  faithfulness,
  rateOf,
  refusalCorrect,
  unsupportedClaims,
  type ClaimJudgement,
} from "../metrics/generation.js";

const ranked = (...ids: string[]): RankedItem[] =>
  ids.map((id, i) => ({ id, score: 1 - i * 0.1 }));

describe("retrieval metrics", () => {
  describe("recall@K", () => {
    it("scores the fraction of the relevant set found, not a hit flag", () => {
      // Relevant {a, b}; top 3 = [c, a, d] contains a only -> 1/2.
      expect(recallAtK(ranked("c", "a", "d", "b"), ["a", "b"], 3)).toBe(0.5);
      // Widening to K=4 pulls b in -> 2/2.
      expect(recallAtK(ranked("c", "a", "d", "b"), ["a", "b"], 4)).toBe(1);
    });

    it("is null, not zero, when the case has no relevant set", () => {
      // A negative case has nothing to recall. Scoring it 0 would punish correct
      // behavior; scoring it 1 would hide real misses.
      expect(recallAtK(ranked("a"), [], 5)).toBeNull();
    });
  });

  describe("precision@K", () => {
    it("divides by K, not by the number returned", () => {
      // The worked example from the spec: 1 relevant passage out of 5 = 0.2.
      expect(precisionAtK(ranked("x", "a", "y", "z", "w"), ["a"], 5)).toBeCloseTo(0.2, 10);
    });

    it("still divides by K when fewer than K passages came back", () => {
      // 2 returned, both relevant, K=5 -> 0.4. Not 1.0: the question is how
      // much of the context budget was spent usefully.
      expect(precisionAtK(ranked("a", "b"), ["a", "b"], 5)).toBeCloseTo(0.4, 10);
    });
  });

  describe("reciprocal rank", () => {
    it("is 1/rank of the first relevant passage, 1-indexed", () => {
      // Relevant 'a' sits third -> 1/3.
      expect(reciprocalRank(ranked("x", "y", "a", "b"), ["a"])).toBeCloseTo(1 / 3, 10);
      expect(reciprocalRank(ranked("a", "y"), ["a"])).toBe(1);
    });

    it("is zero when nothing relevant was retrieved", () => {
      expect(reciprocalRank(ranked("x", "y"), ["a"])).toBe(0);
    });
  });

  describe("nDCG@K", () => {
    it("is 1 when every relevant passage is already at the top", () => {
      expect(ndcgAtK(ranked("a", "b", "x"), ["a", "b"], 3)).toBeCloseTo(1, 10);
    });

    it("discounts by position", () => {
      // Relevant 'a' at rank 2: DCG = 1/log2(3) = 0.63093.
      // Ideal places it at rank 1: IDCG = 1/log2(2) = 1. nDCG = 0.63093.
      expect(ndcgAtK(ranked("x", "a", "y"), ["a"], 3)).toBeCloseTo(0.63093, 4);
    });

    it("caps the ideal at K so a perfect ranking scores 1", () => {
      // 3 relevant, K=2: only two can possibly be retrieved, and both are.
      // An uncapped ideal would score this 0.79 and call a perfect result a miss.
      expect(ndcgAtK(ranked("a", "b", "c"), ["a", "b", "c"], 2)).toBeCloseTo(1, 10);
    });
  });

  describe("meanOf", () => {
    it("ignores nulls rather than counting them as zero", () => {
      // (1 + 0.5) / 2 = 0.75. Counting the null as 0 would give 0.5.
      expect(meanOf([1, null, 0.5])).toBeCloseTo(0.75, 10);
    });

    it("is null when nothing applies", () => {
      expect(meanOf([null, null])).toBeNull();
    });
  });
});

describe("generation metrics", () => {
  const claims = (...v: ClaimJudgement["verdict"][]): ClaimJudgement[] =>
    v.map((verdict, i) => ({ claim: `claim ${i}`, verdict }));

  describe("faithfulness", () => {
    it("is supported over total, with one unsupported claim costing a third", () => {
      // 2 supported of 3 -> 0.6667. The worked hallucination fixture.
      expect(faithfulness(claims("supported", "supported", "not_found"))).toBeCloseTo(2 / 3, 10);
    });

    it("counts a contradicted claim against the score too", () => {
      expect(faithfulness(claims("supported", "contradicted"))).toBe(0.5);
    });

    it("is null for an answer with no claims, not a perfect 1", () => {
      // A correct refusal asserts nothing. Scoring it 1.0 would let a bot that
      // refuses everything top the faithfulness table.
      expect(faithfulness([])).toBeNull();
    });

    it("lists every claim the context did not support", () => {
      const c = claims("supported", "not_found", "contradicted");
      expect(unsupportedClaims(c).map((x) => x.verdict)).toEqual(["not_found", "contradicted"]);
    });
  });

  describe("context precision and recall", () => {
    it("scores used over sent", () => {
      expect(contextPrecision(2, 5)).toBeCloseTo(0.4, 10);
    });

    it("never exceeds 1 when a judge over-counts", () => {
      expect(contextPrecision(9, 5)).toBe(1);
    });

    it("is null when nothing was sent", () => {
      expect(contextPrecision(0, 0)).toBeNull();
    });

    it("scores covered over required", () => {
      expect(contextRecall(1, 2)).toBe(0.5);
      expect(contextRecall(0, 3)).toBe(0);
      expect(contextRecall(1, 0)).toBeNull();
    });
  });

  describe("citation accuracy", () => {
    it("scores supported citations over total", () => {
      expect(citationAccuracy(3, 4)).toBe(0.75);
    });

    it("is null for a reply with no citations, not zero", () => {
      // Until grounded prompting ships, most replies cite nothing. Scoring
      // those 0 would read as a catastrophic failure of a feature that does
      // not exist yet.
      expect(citationAccuracy(0, 0)).toBeNull();
    });
  });

  describe("refusal correctness", () => {
    it("requires declining AND escalating", () => {
      expect(refusalCorrect({ declined: true, action: "escalate" })).toBe(true);
      // Declining without escalating leaves the customer stranded.
      expect(refusalCorrect({ declined: true, action: "reply" })).toBe(false);
      // Escalating while still answering is not a refusal.
      expect(refusalCorrect({ declined: false, action: "escalate" })).toBe(false);
    });
  });

  describe("rateOf", () => {
    it("is the fraction true, and null for an empty set", () => {
      expect(rateOf([true, false, true, true])).toBe(0.75);
      expect(rateOf([])).toBeNull();
    });
  });
});
