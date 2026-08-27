/**
 * Report assembly, rendering and baseline comparison.
 */
import type { CaseResult, Report, ReportSummary } from "./types.js";
import { meanOf } from "./metrics/retrieval.js";
import { rateOf } from "./metrics/generation.js";

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

export function summarise(results: readonly CaseResult[], ks: readonly number[]): ReportSummary {
  const ok = results.filter((r) => !r.error);
  const byK = <T>(fn: (k: number) => T): Record<string, T> =>
    Object.fromEntries(ks.map((k) => [String(k), fn(k)]));

  const latencies = ok.map((r) => r.operational.latencyMs.total);
  const costs = ok.map((r) => r.operational);
  const rewrites = ok.map((r) => r.rewrite).filter((r): r is NonNullable<typeof r> => r !== null);
  const rewriteLatencies = rewrites.map((r) => r.rewriteLatencyMs);

  return {
    cases: results.length,
    errored: results.length - ok.length,
    retrieval: {
      recallAtK: byK((k) => meanOf(ok.map((r) => r.retrieval.recallAtK[String(k)] ?? null))),
      precisionAtK: byK((k) => meanOf(ok.map((r) => r.retrieval.precisionAtK[String(k)] ?? null))),
      ndcgAtK: byK((k) => meanOf(ok.map((r) => r.retrieval.ndcgAtK[String(k)] ?? null))),
      mrr: meanOf(ok.map((r) => r.retrieval.reciprocalRank)),
      hitRateAtProductionK: meanOf(
        ok.map((r) => (r.retrieval.hitAtProductionK === null ? null : r.retrieval.hitAtProductionK ? 1 : 0)),
      ),
      widenOnEmptyRate: ok.length === 0 ? 0 : ok.filter((r) => r.retrieval.widenedOnEmpty).length / ok.length,
    },
    generation: {
      faithfulness: meanOf(ok.map((r) => r.generation.faithfulness)),
      answerRelevance: meanOf(ok.map((r) => r.generation.answerRelevance)),
      correctness: meanOf(ok.map((r) => r.generation.correctness)),
      contextPrecision: meanOf(ok.map((r) => r.generation.contextPrecision)),
      contextRecall: meanOf(ok.map((r) => r.generation.contextRecall)),
      citationAccuracy: meanOf(ok.map((r) => r.generation.citationAccuracy)),
      refusalCorrectness: rateOf(
        ok.filter((r) => r.generation.refusalCorrect !== null).map((r) => r.generation.refusalCorrect as boolean),
      ),
      mustContainPassRate: rateOf(
        ok.filter((r) => r.generation.mustContainPassed !== null).map((r) => r.generation.mustContainPassed as boolean),
      ),
      mustNotContainPassRate: rateOf(
        ok
          .filter((r) => r.generation.mustNotContainPassed !== null)
          .map((r) => r.generation.mustNotContainPassed as boolean),
      ),
    },
    operational: {
      p50LatencyMs: Math.round(percentile(latencies, 50)),
      p95LatencyMs: Math.round(percentile(latencies, 95)),
      rewriteP50Ms: rewrites.length === 0 ? null : Math.round(percentile(rewriteLatencies, 50)),
      rewriteP95Ms: rewrites.length === 0 ? null : Math.round(percentile(rewriteLatencies, 95)),
      // A rewrite that fell back to the raw query is not a failed turn, but a
      // high rate means the feature is costing a call and buying nothing.
      rewriteFailureRate:
        rewrites.length === 0 ? null : rewrites.filter((r) => !r.rewritten).length / rewrites.length,
      followUpRate:
        rewrites.length === 0 ? null : rewrites.filter((r) => r.followUpRan).length / rewrites.length,
      totalCostUsd:
        costs.filter((c) => c.costResolved).length === 0
          ? null
          : costs.filter((c) => c.costResolved).reduce((s, c) => s + (c.costUsd ?? 0), 0),
      unresolvedCostCases: costs.filter((c) => !c.costResolved).length,
      totalJudgeCostUsd:
        costs.filter((c) => c.judgeCostUsd !== null).length === 0
          ? null
          : costs.reduce((s, c) => s + (c.judgeCostUsd ?? 0), 0),
      judgeCacheHits: 0,
      judgeCalls: 0,
    },
  };
}

function fmt(v: number | null, digits = 3): string {
  return v === null ? "  —  " : v.toFixed(digits);
}

function money(v: number | null): string {
  return v === null ? "unknown" : `$${v.toFixed(4)}`;
}

export function renderTable(report: Report): string {
  const s = report.summary;
  const lines: string[] = [];
  const ks = report.ks.map(String);

  lines.push("");
  lines.push(`RAG eval — ${report.dataset}`);
  lines.push(`  answering model: ${report.answeringModel}`);
  lines.push(`  judge model:     ${report.judgeModel}`);
  lines.push(`  cases:           ${s.cases}${s.errored ? ` (${s.errored} errored)` : ""}`);
  lines.push("");
  lines.push("RETRIEVAL");
  lines.push(`  ${"metric".padEnd(22)}${ks.map((k) => `K=${k}`.padStart(9)).join("")}`);
  for (const [label, rec] of [
    ["Recall@K", s.retrieval.recallAtK],
    ["Precision@K", s.retrieval.precisionAtK],
    ["nDCG@K", s.retrieval.ndcgAtK],
  ] as const) {
    lines.push(`  ${label.padEnd(22)}${ks.map((k) => fmt(rec[k] ?? null).padStart(9)).join("")}`);
  }
  lines.push(`  ${"MRR".padEnd(22)}${fmt(s.retrieval.mrr).padStart(9)}`);
  lines.push(
    `  ${`hit rate @K=${report.productionTopK}`.padEnd(22)}${fmt(s.retrieval.hitRateAtProductionK).padStart(9)}`,
  );
  lines.push(`  ${"widen-on-empty rate".padEnd(22)}${fmt(s.retrieval.widenOnEmptyRate).padStart(9)}`);
  lines.push("");
  lines.push("GENERATION");
  for (const [label, v] of [
    ["faithfulness", s.generation.faithfulness],
    ["answer relevance", s.generation.answerRelevance],
    ["correctness", s.generation.correctness],
    ["context precision", s.generation.contextPrecision],
    ["context recall", s.generation.contextRecall],
    ["citation accuracy", s.generation.citationAccuracy],
    ["refusal correctness", s.generation.refusalCorrectness],
    ["mustContain pass", s.generation.mustContainPassRate],
    ["mustNotContain pass", s.generation.mustNotContainPassRate],
  ] as const) {
    lines.push(`  ${label.padEnd(22)}${fmt(v).padStart(9)}`);
  }
  lines.push("");
  lines.push("OPERATIONAL");
  lines.push(`  ${"p50 latency".padEnd(22)}${`${s.operational.p50LatencyMs}ms`.padStart(9)}`);
  lines.push(`  ${"p95 latency".padEnd(22)}${`${s.operational.p95LatencyMs}ms`.padStart(9)}`);
  if (s.operational.rewriteP50Ms !== null) {
    lines.push(`  ${"rewrite p50".padEnd(22)}${`${s.operational.rewriteP50Ms}ms`.padStart(9)}`);
    lines.push(`  ${"rewrite p95".padEnd(22)}${`${s.operational.rewriteP95Ms}ms`.padStart(9)}`);
    lines.push(`  ${"rewrite fallback rate".padEnd(22)}${fmt(s.operational.rewriteFailureRate).padStart(9)}`);
    lines.push(`  ${"follow-up round rate".padEnd(22)}${fmt(s.operational.followUpRate).padStart(9)}`);
  }
  lines.push(`  ${"answering cost".padEnd(22)}${money(s.operational.totalCostUsd).padStart(9)}`);
  lines.push(`  ${"judge cost".padEnd(22)}${money(s.operational.totalJudgeCostUsd).padStart(9)}`);
  lines.push(
    `  ${"judge calls".padEnd(22)}${String(s.operational.judgeCalls).padStart(9)}  (${s.operational.judgeCacheHits} cached)`,
  );
  if (s.operational.unresolvedCostCases > 0) {
    lines.push(
      `  NOTE: ${s.operational.unresolvedCostCases} case(s) have UNKNOWN cost (OpenRouter never priced them).`,
    );
    lines.push("        They are excluded from the total rather than counted as $0.00.");
  }

  const unsupported = report.results.flatMap((r) =>
    r.generation.unsupported.map((u) => ({ id: r.id, ...u })),
  );
  if (unsupported.length > 0) {
    lines.push("");
    lines.push(`UNSUPPORTED CLAIMS (${unsupported.length}) — the hallucination detail`);
    for (const u of unsupported.slice(0, 25)) {
      lines.push(`  [${u.id}] (${u.verdict}) ${u.claim}`);
    }
    if (unsupported.length > 25) lines.push(`  … and ${unsupported.length - 25} more, see the JSON report`);
  }
  lines.push("");
  return lines.join("\n");
}

export type Regression = { metric: string; baseline: number; current: number; delta: number };

/** Every scalar metric worth gating on, flattened to a comparable map. */
export function flattenMetrics(summary: ReportSummary): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(summary.retrieval.recallAtK)) out[`recall@${k}`] = v;
  for (const [k, v] of Object.entries(summary.retrieval.precisionAtK)) out[`precision@${k}`] = v;
  for (const [k, v] of Object.entries(summary.retrieval.ndcgAtK)) out[`ndcg@${k}`] = v;
  out["mrr"] = summary.retrieval.mrr;
  out["hitRateAtProductionK"] = summary.retrieval.hitRateAtProductionK;
  out["faithfulness"] = summary.generation.faithfulness;
  out["answerRelevance"] = summary.generation.answerRelevance;
  out["correctness"] = summary.generation.correctness;
  out["contextPrecision"] = summary.generation.contextPrecision;
  out["contextRecall"] = summary.generation.contextRecall;
  out["citationAccuracy"] = summary.generation.citationAccuracy;
  out["refusalCorrectness"] = summary.generation.refusalCorrectness;
  return out;
}

/**
 * Compare against a baseline report.
 *
 * Only metrics present and numeric in BOTH reports are compared. A metric that
 * was null in the baseline (it did not apply) and has a value now is not a
 * regression, and treating it as one would make the first run after adding a
 * feature fail for no reason.
 *
 * `widen-on-empty` is deliberately absent: it is a diagnostic, and rises
 * legitimately when a dataset gains harder cases.
 */
export function findRegressions(
  baseline: ReportSummary,
  current: ReportSummary,
  tolerance: number,
): Regression[] {
  const b = flattenMetrics(baseline);
  const c = flattenMetrics(current);
  const out: Regression[] = [];

  for (const [metric, baseValue] of Object.entries(b)) {
    const currentValue = c[metric];
    if (typeof baseValue !== "number" || typeof currentValue !== "number") continue;
    const delta = currentValue - baseValue;
    if (delta < -tolerance) out.push({ metric, baseline: baseValue, current: currentValue, delta });
  }
  return out.sort((x, y) => x.delta - y.delta);
}

export function renderRegressions(regressions: readonly Regression[], tolerance: number): string {
  if (regressions.length === 0) {
    return `\nNo metric regressed beyond the ${tolerance} tolerance.\n`;
  }
  const lines = [`\nREGRESSIONS (tolerance ${tolerance})`];
  for (const r of regressions) {
    lines.push(
      `  ${r.metric.padEnd(24)} ${r.baseline.toFixed(3)} -> ${r.current.toFixed(3)}  (${r.delta.toFixed(3)})`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
