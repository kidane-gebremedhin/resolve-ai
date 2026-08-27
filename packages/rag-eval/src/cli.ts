/**
 * `pnpm eval:rag` — offline RAG evaluation.
 *
 *   pnpm eval:rag                                  full golden set
 *   pnpm eval:rag --tag multi-hop                  one slice
 *   pnpm eval:rag --k 3,5,10                       which K values to report
 *   pnpm eval:rag --limit 10                       the CI smoke subset
 *   pnpm eval:rag --baseline reports/<file>.json   fail on regression
 *   pnpm eval:rag --dataset path/to/cases.json     a different dataset
 *   pnpm eval:rag --retrieval-only                 skip the answering model entirely
  pnpm eval:rag --reingest                       force fixture re-ingest
 *
 * Exit codes: 0 clean, 1 a regression against the baseline, 2 the run itself
 * failed. CI distinguishes "quality dropped" from "the harness broke".
 */
// MUST be first: populates process.env before any `@api/*` module evaluates.
import "./load-env.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { env } from "@api/config/env.js";
import { datasetSchema, isNegativeCase, type CaseResult, type Report } from "./types.js";
import { ensureFixtureWorkspace } from "./fixtures.js";
import { resolveExpectedSourceIds, runGeneration, runRetrieval } from "./runner.js";
import { createJudge, DEFAULT_JUDGE_MODEL, JudgeCache, type Judge } from "./judge.js";
import { priceJudgeCalls, settleCosts } from "./cost.js";
import {
  citationAccuracy,
  contextPrecision,
  contextRecall,
  faithfulness,
  refusalCorrect,
  unsupportedClaims,
} from "./metrics/generation.js";
import { findRegressions, renderRegressions, renderTable, summarise } from "./report.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..");

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<number> {
  const datasetPath = flag("dataset") ?? path.join(PKG, "fixtures", "golden.json");
  const ks = (flag("k") ?? "3,5,10").split(",").map((n) => Number(n.trim())).filter(Boolean);
  const tag = flag("tag");
  const limit = Number(flag("limit") ?? "0");
  const baselinePath = flag("baseline");
  const tolerance = Number(flag("tolerance") ?? "0.02");
  const judgeModel = process.env.RAG_EVAL_JUDGE_MODEL ?? DEFAULT_JUDGE_MODEL;
  // Retrieval-only implies no judge: there is no answer to judge.
  const retrievalOnly = has("retrieval-only");
  const skipJudge = has("no-judge") || retrievalOnly;

  const raw = JSON.parse(await readFile(datasetPath, "utf8"));
  const dataset = datasetSchema.parse(raw);
  let cases = dataset.cases;
  if (tag) cases = cases.filter((c) => c.tags.includes(tag));
  if (limit > 0) cases = cases.slice(0, limit);
  if (cases.length === 0) throw new Error(`No cases selected (tag=${tag ?? "none"})`);

  console.log(`[eval] ${cases.length} case(s) from ${path.basename(datasetPath)}`);
  await mongoose.connect(env.mongoUri);

  console.log("[eval] preparing fixture workspace…");
  const workspace = await ensureFixtureWorkspace({
    kbDir: path.join(PKG, "fixtures", "kb"),
    force: has("reingest"),
    log: (m) => console.log(m),
  });

  const cache = new JudgeCache(path.join(PKG, ".cache"), judgeModel);
  await cache.load();
  const judge: Judge | null = skipJudge ? null : createJudge({ model: judgeModel, cache });

  const startedAt = new Date().toISOString();
  const results: CaseResult[] = [];
  const conversationIds: string[] = [];
  const judgeGenerationIds: string[] = [];
  let judgeCalls = 0;

  for (const [i, c] of cases.entries()) {
    process.stdout.write(`[eval] (${i + 1}/${cases.length}) ${c.id} … `);
    const negative = isNegativeCase(c);
    try {
      const expectedSourceIds = resolveExpectedSourceIds(c.expectedSourceIds, workspace.sourceIdBySlug);
      const { scores: retrieval, passages, rewrite } = await runRetrieval({
        question: c.question,
        workspace,
        expectedSourceIds,
        ks,
        caseId: c.id,
        history: c.history.map((t) => ({ role: t.role, content: t.content })),
        vocabulary: Object.keys(workspace.sourceIdBySlug),
      });

      // `--retrieval-only` skips the answering model entirely. Retrieval metrics
      // need no answer, and a rewriting change is measured on exactly those, so
      // this is the cheap loop for tuning query understanding.
      const gen = retrievalOnly
        ? {
            answer: "",
            action: "skipped",
            confidence: null,
            conversationId: "",
            citedSourceIds: [] as string[],
            latencyMs: 0,
          }
        : await runGeneration({ evalCase: c, workspace });
      if (gen.conversationId) conversationIds.push(gen.conversationId);

      const lower = gen.answer.toLowerCase();
      const mustContainPassed = c.mustContain.length
        ? c.mustContain.every((s) => lower.includes(s.toLowerCase()))
        : null;
      const mustNotContainPassed = c.mustNotContain.length
        ? !c.mustNotContain.some((s) => lower.includes(s.toLowerCase()))
        : null;

      let verdict = null as Awaited<ReturnType<Judge>>["verdict"] | null;
      if (judge && !retrievalOnly) {
        const judged = await judge({
          caseId: c.id,
          question: c.question,
          answer: gen.answer,
          referenceAnswer: c.referenceAnswer,
          passages: passages.map((p) => ({ id: p.id, title: p.title, text: p.text })),
        });
        verdict = judged.verdict;
        if (!judged.cached) {
          judgeCalls += 1;
          if (judged.generationId) judgeGenerationIds.push(judged.generationId);
        }
      }

      results.push({
        id: c.id,
        conversationId: gen.conversationId,
        question: c.question,
        tags: c.tags,
        negative,
        answer: gen.answer,
        action: gen.action,
        confidence: gen.confidence,
        rewrite,
        retrieval,
        generation: {
          faithfulness: verdict ? faithfulness(verdict.claims) : null,
          unsupported: verdict ? unsupportedClaims(verdict.claims) : [],
          answerRelevance: verdict?.answerRelevance ?? null,
          correctness: verdict?.correctness ?? null,
          contextPrecision: verdict ? contextPrecision(verdict.contextUsedCount, passages.length) : null,
          contextRecall: verdict
            ? contextRecall(verdict.contextRequiredCovered, verdict.contextRequiredTotal)
            : null,
          citationAccuracy: verdict
            ? citationAccuracy(verdict.citationsSupported, verdict.citationsTotal)
            : null,
          // Only negative cases can be right or wrong about refusing.
          refusalCorrect:
            negative && verdict
              ? refusalCorrect({ declined: verdict.declined, action: gen.action })
              : null,
          mustContainPassed,
          mustNotContainPassed,
        },
        operational: {
          latencyMs: {
            retrieval: retrieval.latencyMs,
            generation: gen.latencyMs,
            total: retrieval.latencyMs + gen.latencyMs,
          },
          promptTokens: null,
          completionTokens: null,
          costUsd: null,
          costResolved: false,
          judgeCostUsd: null,
          generationIds: [],
        },
      });
      console.log("ok");
    } catch (err) {
      console.log(`ERROR: ${(err as Error).message}`);
      results.push({
        id: c.id,
        conversationId: null,
        question: c.question,
        tags: c.tags,
        negative,
        answer: "",
        action: "error",
        confidence: null,
        rewrite: null,
        retrieval: {
          recallAtK: {}, precisionAtK: {}, ndcgAtK: {}, reciprocalRank: null,
          hitAtProductionK: null, widenedOnEmpty: false, retrievedCount: 0,
          topScore: null, latencyMs: 0,
        },
        generation: {
          faithfulness: null, unsupported: [], answerRelevance: null, correctness: null,
          contextPrecision: null, contextRecall: null, citationAccuracy: null,
          refusalCorrect: null, mustContainPassed: null, mustNotContainPassed: null,
        },
        operational: {
          latencyMs: { retrieval: 0, generation: 0, total: 0 },
          promptTokens: null, completionTokens: null, costUsd: null, costResolved: false,
          judgeCostUsd: null, generationIds: [],
        },
        error: (err as Error).message,
      });
    }
  }

  await cache.save();

  // Cost lands after the reply, so it is settled once at the end rather than
  // waited on per case.
  console.log("[eval] settling costs…");
  const costs = await settleCosts({ conversationIds, log: (m) => console.log(m) });
  for (const r of results) {
    const c = r.conversationId ? costs.get(r.conversationId) : undefined;
    if (c) {
      r.operational.costUsd = c.costUsd;
      r.operational.costResolved = c.resolved;
      r.operational.promptTokens = c.promptTokens;
      r.operational.completionTokens = c.completionTokens;
    }
  }

  const judgeCost = await priceJudgeCalls(judgeGenerationIds);

  const summary = summarise(results, ks);
  summary.operational.judgeCalls = judgeCalls;
  summary.operational.judgeCacheHits = cache.hits;
  summary.operational.totalJudgeCostUsd = judgeCost.totalUsd;
  if (judgeCost.unresolved > 0) {
    console.log(
      `[eval] ${judgeCost.unresolved} judge call(s) never priced; excluded from the judge total rather than counted as $0.00`,
    );
  }

  const report: Report = {
    version: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    dataset: path.basename(datasetPath),
    ks,
    productionTopK: env.ai.kbSearchTopK,
    answeringModel: env.ai.model,
    judgeModel: skipJudge ? "(judge skipped)" : judgeModel,
    summary,
    results,
  };

  const reportsDir = path.join(PKG, "reports");
  await mkdir(reportsDir, { recursive: true });
  const outFile = path.join(reportsDir, `${report.finishedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(outFile, JSON.stringify(report, null, 2));

  console.log(renderTable(report));
  console.log(`report: ${path.relative(process.cwd(), outFile)}`);

  if (baselinePath) {
    const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as Report;
    const regressions = findRegressions(baseline.summary, summary, tolerance);
    console.log(renderRegressions(regressions, tolerance));
    if (regressions.length > 0) return 1;
  }
  return 0;
}

main()
  .then(async (code) => {
    await mongoose.disconnect();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(`[eval] run failed: ${(err as Error).stack ?? err}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(2);
  });
