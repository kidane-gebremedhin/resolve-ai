// Cost interpretation and regression gating.
//
// The cost tests exist because the failure they guard against is silent: an
// unresolved price is written to the database as 0, and a 0 in a budget table
// is indistinguishable from a free call. Every one of these asserts the
// difference between "cost nothing" and "we do not know what it cost".

import { describe, expect, it } from "vitest";
import { interpretUsageRow, totalCost, type ResolvedCost } from "../cost.js";
import { findRegressions, flattenMetrics } from "../report.js";
import type { ReportSummary } from "../types.js";

describe("cost interpretation", () => {
  it("treats a row with tokens as resolved", () => {
    const r = interpretUsageRow({
      generationIds: ["gen_1"],
      promptTokens: 1200,
      completionTokens: 300,
      costUsd: 0.0042,
    });
    expect(r.resolved).toBe(true);
    expect(r.costUsd).toBeCloseTo(0.0042, 6);
  });

  it("treats a row that names generations but reports no tokens as UNRESOLVED", () => {
    // This is the give-up shape. `fetchGeneration` fills tokens and cost from
    // the same response, so zero tokens against a named generation means every
    // fetch failed — the service logged "giving up, recording zero" and wrote
    // the row anyway.
    const r = interpretUsageRow({
      generationIds: ["gen_1", "gen_2"],
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
    });
    expect(r.resolved).toBe(false);
    expect(r.costUsd).toBeNull();
  });

  it("treats a genuinely cheap call as resolved, not unknown", () => {
    // Tokens flowed and the price rounded to zero. That is a real zero and it
    // must not be confused with the give-up case above.
    const r = interpretUsageRow({
      generationIds: ["gen_1"],
      promptTokens: 5,
      completionTokens: 1,
      costUsd: 0,
    });
    expect(r.resolved).toBe(true);
    expect(r.costUsd).toBe(0);
  });

  it("treats a missing row as unresolved", () => {
    expect(interpretUsageRow(null).resolved).toBe(false);
  });

  describe("totals", () => {
    const resolved = (usd: number): ResolvedCost => ({
      costUsd: usd, promptTokens: 10, completionTokens: 5, resolved: true,
    });
    const unresolved: ResolvedCost = {
      costUsd: null, promptTokens: null, completionTokens: null, resolved: false,
    };

    it("sums only what resolved and counts the rest", () => {
      const t = totalCost([resolved(0.01), unresolved, resolved(0.02)]);
      expect(t.totalUsd).toBeCloseTo(0.03, 10);
      expect(t.unresolved).toBe(1);
    });

    it("reports null, not $0.00, when nothing resolved", () => {
      // A run that priced nothing must print a blank. "$0.00" would be read as
      // a budget, and it is not one.
      const t = totalCost([unresolved, unresolved]);
      expect(t.totalUsd).toBeNull();
      expect(t.unresolved).toBe(2);
    });
  });
});

function summary(over: Partial<ReportSummary["generation"]> & Partial<{ recall5: number | null; mrr: number | null }> = {}): ReportSummary {
  return {
    cases: 10,
    errored: 0,
    retrieval: {
      recallAtK: { "5": over.recall5 ?? 0.8 },
      precisionAtK: { "5": 0.4 },
      ndcgAtK: { "5": 0.7 },
      mrr: over.mrr ?? 0.75,
      hitRateAtProductionK: 0.9,
      widenOnEmptyRate: 0.1,
    },
    generation: {
      faithfulness: over.faithfulness ?? 0.9,
      answerRelevance: over.answerRelevance ?? 0.95,
      correctness: over.correctness ?? 0.85,
      contextPrecision: 0.5,
      contextRecall: 0.8,
      citationAccuracy: null,
      refusalCorrectness: over.refusalCorrectness ?? 1,
      mustContainPassRate: 1,
      mustNotContainPassRate: 1,
    },
    operational: {
      p50LatencyMs: 100, p95LatencyMs: 200,
      rewriteP50Ms: 180, rewriteP95Ms: 320, rewriteFailureRate: 0, followUpRate: 0,
      totalCostUsd: 0.1,
      unresolvedCostCases: 0, totalJudgeCostUsd: 0.05, judgeCacheHits: 0, judgeCalls: 10,
    },
  };
}

describe("baseline regression gating", () => {
  it("finds nothing when the run is identical", () => {
    expect(findRegressions(summary(), summary(), 0.02)).toEqual([]);
  });

  it("ignores a drop inside the tolerance", () => {
    // 0.90 -> 0.89 with a 0.02 tolerance is noise, not a regression. Gating on
    // it would make the harness cry wolf and get switched off.
    expect(findRegressions(summary(), summary({ faithfulness: 0.89 }), 0.02)).toEqual([]);
  });

  it("catches a drop beyond the tolerance and names it", () => {
    const found = findRegressions(summary(), summary({ faithfulness: 0.7 }), 0.02);
    expect(found).toHaveLength(1);
    expect(found[0]!.metric).toBe("faithfulness");
    expect(found[0]!.delta).toBeCloseTo(-0.2, 10);
  });

  it("catches a retrieval regression too, and sorts worst first", () => {
    const found = findRegressions(
      summary(),
      summary({ faithfulness: 0.85, recall5: 0.3 }),
      0.02,
    );
    expect(found.map((r) => r.metric)).toEqual(["recall@5", "faithfulness"]);
  });

  it("never flags an improvement", () => {
    expect(findRegressions(summary(), summary({ faithfulness: 1 }), 0.02)).toEqual([]);
  });

  it("skips a metric that was inapplicable in the baseline", () => {
    // citationAccuracy is null until grounded prompting ships. A null baseline
    // turning into a number is a feature landing, not a regression.
    const base = summary();
    const next = summary();
    next.generation.citationAccuracy = 0.4;
    expect(findRegressions(base, next, 0.02)).toEqual([]);
  });

  it("flattens every gated metric with a stable name", () => {
    const flat = flattenMetrics(summary());
    expect(Object.keys(flat)).toEqual(
      expect.arrayContaining([
        "recall@5", "precision@5", "ndcg@5", "mrr", "faithfulness", "correctness",
      ]),
    );
    // widen-on-empty is deliberately absent: it is a diagnostic that rises
    // legitimately when the dataset gains harder cases.
    expect(flat).not.toHaveProperty("widenOnEmptyRate");
  });
});
