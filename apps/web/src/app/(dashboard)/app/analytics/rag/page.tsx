// RAG Quality — production retrieval and generation health.
//
// Every number on this page is aggregated by MongoDB and arrives ready to
// render. Nothing here loops over turns: at the traffic level where these
// metrics start to matter, a client-side rollup is a data export with a chart
// on top.
//
// Backed by `GET /rag-metrics/*` (__specs/07) over the `RagTurnMetric` data
// from __specs/39's online telemetry section.

import { Suspense } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { getActiveWebsiteId } from "@/lib/website-scope";
import { AnalyticsFilters } from "../analytics-filters";
import { MetricTile, DefinitionPopover, type MetricDefinition } from "./metric-tile";
import { ScoreDistribution, type ScoreBucket } from "./score-distribution";
import { TrendChart } from "./trend-chart";
import { KSelector } from "./k-selector";
import { NO_DATA, count, deltaBadge, ms, num, pct, usd } from "./format";
import {
  AnswerGapButton,
  BulkDeleteDeadWeight,
  MarkSourceButton,
  ReindexButton,
} from "./repair-actions";

export const dynamic = "force-dynamic";

type Website = { _id: string; name: string; domain: string };
type Agent = { _id: string; name: string; websiteId: string };

type Summary = {
  range: { since: string; until: string; days: number };
  current: {
    turns: number;
    faithfulness: number | null;
    faithfulnessSamples: number;
    meanConfidence: number | null;
    meanRetrievalConfidence: number | null;
    noHitRate: number | null;
    lowConfidenceRate: number | null;
    escalationRate: number | null;
    conflictRate: number | null;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    costPerConversation: number | null;
    totalCostUsd: number;
    pricedConversations: number;
  };
  previous: Summary["current"];
  deltas: Record<string, number | null>;
};

type Retrieval = {
  minScoreThreshold: number;
  ks: number[];
  scoredTurns: number;
  totalTurns: number;
  recallAtK: Record<string, number | null>;
  precisionAtK: Record<string, number | null>;
  mrr: number | null;
  meanTopScore: number | null;
  noHitRate: number | null;
  widenOnEmptyRate: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  distribution: ScoreBucket[];
};

type Generation = {
  meanConfidence: number | null;
  faithfulness: number | null;
  faithfulnessSamples: number;
  escalationRate: number | null;
  citationRate: number | null;
  citationsPerAnswer: number | null;
  thumbs: { up: number; down: number; total: number; helpfulness: number | null };
  daily: { date: string; turns: number; confidence: number | null; faithfulness: number | null; faithfulnessSamples: number }[];
  unsupportedExamples: {
    conversationId: string;
    messageId: string;
    query: string;
    score: number | null;
    createdAt: string;
    claims: { claim: string; verdict: string; reason: string }[];
  }[];
};

type Cost = {
  totals: { turns: number; pricedTurns: number; promptTokens: number; completionTokens: number; costUsd: number; pricedShare: number | null; costPerTurn: number | null };
  daily: { date: string; turns: number; costUsd: number; promptTokens: number; completionTokens: number; p50LatencyMs: number | null; p95LatencyMs: number | null }[];
};

type FailingQueries = {
  items: {
    query: string;
    turns: number;
    noHits: number;
    lowConfidence: number;
    meanConfidence: number | null;
    meanTopScore: number | null;
    conversationId: string;
    gap: { _id: string; question: string; occurrenceCount: number; status: string; maxKbScore: number } | null;
  }[];
};

type SourceHealth = {
  top: { sourceId: string; title: string; type: string | null; retrievalCount: number; topRankCount: number; meanTopScore: number | null }[];
  neverRetrieved: { sourceId: string; title: string; type: string | null; chunkCount: number }[];
  totals: { sources: number; retrieved: number; neverRetrieved: number };
  ingestion: { totalSources: number; failing: number; failureRate: number; byErrorClass: { message: string; action: string; count: number }[] };
};

type EvalRuns = {
  available: boolean;
  runs: {
    file: string;
    startedAt: string | null;
    dataset: string | null;
    cases: number;
    errored: number;
    retrieval: { mrr?: number | null; recallAtK?: Record<string, number | null> } | null;
    generation: { faithfulness?: number | null; citationAccuracy?: number | null } | null;
    operational: { p95LatencyMs?: number | null; totalCostUsd?: number | null } | null;
  }[];
};

type Definitions = { definitions: Record<string, MetricDefinition> };

type ChunkFlag = "dead_weight" | "misleading" | "retrieved_not_cited";
type IndexHealth = {
  windowSince: string;
  totals: {
    chunks: number;
    retrieved: number;
    deadWeight: number;
    misleading: number;
    retrievedNotCited: number;
    truncated?: boolean;
    scanLimit?: number;
  };
  chunks: {
    chunkId: string;
    sourceId: string;
    title: string | null;
    preview: string | null;
    flags: ChunkFlag[];
    retrievals: number;
    citationRate: number | null;
    downvoteRate: number | null;
    meanScore: number | null;
    thumbsDown: number;
  }[];
};

type GapClusters = {
  similarityThreshold: number;
  clusters: {
    id: string;
    label: string;
    volume: number;
    escalationRate: number | null;
    impact: number;
    queries: { gapId: string; query: string; question: string; occurrences: number }[];
  }[];
};

const FLAG_COPY: Record<ChunkFlag, { label: string; tone: string; fix: string }> = {
  misleading: {
    label: "Misleading",
    tone: "bg-destructive/10 text-destructive",
    fix: "Cited in answers customers thumbed down. Fix the content — this one is actively costing you.",
  },
  retrieved_not_cited: {
    label: "Never quoted",
    tone: "bg-warning/10 text-warning",
    fix: "Scores well, reaches the prompt, and the model declines to use it. Usually split badly.",
  },
  dead_weight: {
    label: "Dead weight",
    tone: "bg-muted text-muted-foreground",
    fix: "Never retrieved. Either nobody asks about it, or it does not match the words they use.",
  },
};

function Panel({
  title,
  hint,
  action,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // `min-w-0` is load-bearing: a grid or flex item defaults to
    // `min-width: auto`, so a wide child (the tables below carry a
    // `min-w-[520px]`) stretches the item rather than scrolling inside its own
    // `overflow-x-auto`. Without it the whole PAGE scrolls sideways on a phone.
    <section className={`min-w-0 rounded-xl border border-border bg-card p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-semibold">{title}</h2>
          {hint && <p className="mt-1 max-w-prose text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
      {children}
    </p>
  );
}

async function RagQuality({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const cookieWebsiteId = await getActiveWebsiteId();
  const websiteId = typeof sp.websiteId === "string" && sp.websiteId ? sp.websiteId : (cookieWebsiteId ?? "");

  const fromParam = typeof sp.from === "string" ? sp.from : "";
  const toParam = typeof sp.to === "string" ? sp.to : "";
  const isCustomRange = Boolean(fromParam && toParam);
  const daysRaw = typeof sp.days === "string" ? parseInt(sp.days, 10) : 30;
  const days = [7, 30, 90].includes(daysRaw) ? daysRaw : 30;

  const qs = new URLSearchParams();
  if (isCustomRange) {
    qs.set("from", fromParam);
    qs.set("to", toParam);
  } else {
    qs.set("days", String(days));
  }
  if (websiteId) qs.set("websiteId", websiteId);
  const q = qs.toString();

  let summary: Summary | null = null;
  let retrieval: Retrieval | null = null;
  let generation: Generation | null = null;
  let cost: Cost | null = null;
  let failing: FailingQueries | null = null;
  let sources: SourceHealth | null = null;
  let evals: EvalRuns | null = null;
  let indexHealth: IndexHealth | null = null;
  let gapClusters: GapClusters | null = null;
  let agents: Agent[] = [];
  let defs: Record<string, MetricDefinition> = {};
  let websites: Website[] = [];
  let loadError: string | null = null;

  try {
    const [s, r, g, c, f, sh, ev, d, w, ih, gc, ag] = await Promise.all([
      api.get<Summary>(`/rag-metrics/summary?${q}`),
      api.get<Retrieval>(`/rag-metrics/retrieval?${q}`),
      api.get<Generation>(`/rag-metrics/generation?${q}`),
      api.get<Cost>(`/rag-metrics/cost?${q}`),
      api.get<FailingQueries>(`/rag-metrics/failing-queries?limit=15&${q}`),
      api.get<SourceHealth>(`/rag-metrics/source-health?${q}`),
      api.get<EvalRuns>(`/rag-metrics/eval-runs?limit=8`).catch(() => ({ available: false, runs: [] })),
      api.get<Definitions>(`/rag-metrics/definitions`).catch(() => ({ definitions: {} })),
      api.get<Website[]>("/websites").catch(() => [] as Website[]),
      api
        .get<IndexHealth>(`/index-health/chunks?limit=25&${q}`)
        .catch(() => null),
      api
        .get<GapClusters>(`/index-health/gap-clusters?${q}`)
        .catch(() => null),
      api.get<Agent[]>("/agents").catch(() => [] as Agent[]),
    ]);
    summary = s;
    retrieval = r;
    generation = g;
    cost = c;
    failing = f;
    sources = sh;
    evals = ev;
    defs = d.definitions;
    websites = w ?? [];
    indexHealth = ih;
    gapClusters = gc;
    agents = ag ?? [];
  } catch (e) {
    loadError = e instanceof ApiError ? e.message : "Failed to load RAG metrics.";
  }

  const ks = retrieval?.ks ?? [3, 5, 10];
  const kRaw = typeof sp.k === "string" ? parseInt(sp.k, 10) : 5;
  const k = ks.includes(kRaw) ? kRaw : (ks[1] ?? ks[0] ?? 5);


  // A Q&A pair belongs to one agent's knowledge base. Resolve one from the
  // selected website, or from the org when it has exactly one agent; otherwise
  // the action tells the operator to narrow the scope rather than guessing
  // which knowledge base to write into.
  const scopedAgentId = websiteId
    ? (agents.find((a) => String(a.websiteId) === websiteId)?._id ?? null)
    : agents.length === 1
      ? agents[0]!._id
      : null;

  const cur = summary?.current;
  const hasTurns = (cur?.turns ?? 0) > 0;
  const rangeLabel = isCustomRange ? `${fromParam} to ${toParam}` : `last ${days} days`;

  const d = (key: string, fmt: (n: number) => string) => deltaBadge(summary?.deltas?.[key], fmt);

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">RAG Quality</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            How well the assistant is finding and using your knowledge base, measured on real
            conversations over the {rangeLabel}.{" "}
            <Link href="/app/analytics" className="underline underline-offset-2 hover:text-foreground">
              Back to analytics
            </Link>
          </p>
        </div>
        <Suspense>
          <AnalyticsFilters websites={websites} activeWebsiteId={cookieWebsiteId} />
        </Suspense>
      </div>

      {loadError && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {!loadError && !hasTurns && (
        <div className="mt-8 rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <h2 className="font-display text-lg font-semibold">No conversations measured yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            This page fills in as customers talk to your assistant. Every turn records what
            retrieval found and what the model did with it. Come back after a few conversations, or
            widen the date range.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs">
            <Link href="/app/knowledge" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">
              Add knowledge sources
            </Link>
            <Link href="/app/inbox" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">
              Open the inbox
            </Link>
          </div>
        </div>
      )}

      {/* ---- 1. KPI row ---- */}
      {hasTurns && cur && (
        <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricTile
            label="Faithfulness"
            value={pct(cur.faithfulness, 0)}
            sub={cur.faithfulnessSamples > 0 ? `${cur.faithfulnessSamples} sampled` : "not sampled yet"}
            delta={d("faithfulness", (n) => pct(n, 0))}
            betterWhen="up"
            definition={defs.faithfulness}
          />
          <MetricTile
            label="Mean confidence"
            value={num(cur.meanConfidence, 2)}
            sub={`${count(cur.turns)} turns`}
            delta={d("meanConfidence", (n) => num(n, 2))}
            betterWhen="up"
            definition={defs.meanConfidence}
          />
          <MetricTile
            label="No-hit rate"
            value={pct(cur.noHitRate, 0)}
            sub="retrieval found nothing"
            delta={d("noHitRate", (n) => pct(n, 0))}
            betterWhen="down"
            definition={defs.noHitRate}
          />
          <MetricTile
            label="Escalation rate"
            value={pct(cur.escalationRate, 0)}
            sub="handed to a human"
            delta={d("escalationRate", (n) => pct(n, 0))}
            betterWhen="down"
            definition={defs.escalationRate}
          />
          <MetricTile
            label="p95 latency"
            value={ms(cur.p95LatencyMs)}
            sub={`p50 ${ms(cur.p50LatencyMs)}`}
            delta={d("p95LatencyMs", (n) => ms(n))}
            betterWhen="down"
            definition={defs.latency}
          />
          <MetricTile
            label="Cost / conversation"
            value={usd(cur.costPerConversation)}
            sub={`${count(cur.pricedConversations)} priced`}
            delta={d("costPerConversation", (n) => usd(n))}
            betterWhen="down"
            definition={defs.costPerConversation}
          />
        </div>
      )}

      {hasTurns && (
        <>
          {/* ---- 2. Retrieval ---- */}
          <div className="mt-6">
            <Panel
              title="Retrieval"
              hint="Scored against the sources each reply actually cited, which stands in for the human-labelled relevant set the offline harness uses. Turns that cited nothing are excluded, never counted as zero."
              action={<KSelector ks={ks} active={k} />}
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { key: "recallAtK", label: `Recall@${k}`, value: pct(retrieval?.recallAtK?.[String(k)] ?? null, 0) },
                  { key: "precisionAtK", label: `Precision@${k}`, value: pct(retrieval?.precisionAtK?.[String(k)] ?? null, 0) },
                  { key: "mrr", label: "MRR", value: num(retrieval?.mrr ?? null, 2) },
                  { key: "meanTopScore", label: "Mean top score", value: num(retrieval?.meanTopScore ?? null, 3) },
                ].map((m) => (
                  <div key={m.key} className="rounded-lg border border-border p-4">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">{m.label}</span>
                      <DefinitionPopover title={m.label} definition={defs[m.key]} />
                    </div>
                    <div className="mt-1.5 font-display text-2xl font-semibold tracking-tight">{m.value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {[
                  { key: "widenRate", label: "Widen-on-empty", value: pct(retrieval?.widenOnEmptyRate ?? null, 0) },
                  { key: "noHitRate", label: "No-hit rate", value: pct(retrieval?.noHitRate ?? null, 0) },
                  { key: "relevantSet", label: "Scored turns", value: `${count(retrieval?.scoredTurns ?? 0)} of ${count(retrieval?.totalTurns ?? 0)}` },
                ].map((m) => (
                  <div key={m.key} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      {m.label}
                      <DefinitionPopover title={m.label} definition={defs[m.key]} />
                    </span>
                    <span className="font-medium">{m.value}</span>
                  </div>
                ))}
              </div>

              <div className="mt-6">
                <h3 className="text-xs font-medium text-muted-foreground">Score distribution</h3>
                <div className="mt-2 overflow-x-auto">
                  <div className="min-w-[420px]">
                    <ScoreDistribution
                      buckets={retrieval?.distribution ?? []}
                      threshold={retrieval?.minScoreThreshold ?? 0}
                    />
                  </div>
                </div>
              </div>
            </Panel>
          </div>

          {/* ---- 3. Generation ---- */}
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Panel
              title="Generation over time"
              hint="Confidence is measured on every turn; faithfulness is sampled, so its line is drawn with gaps rather than interpolated across days nobody measured."
              className="lg:col-span-2"
            >
              {(generation?.daily.length ?? 0) > 0 ? (
                <div className="overflow-x-auto">
                  <div className="min-w-[420px]">
                    <TrendChart
                      points={(generation?.daily ?? []).map((p) => ({
                        date: p.date,
                        confidence: p.confidence,
                        faithfulness: p.faithfulness,
                      }))}
                    />
                  </div>
                </div>
              ) : (
                <Empty>No turns in this window.</Empty>
              )}
            </Panel>

            <Panel title="Grounding">
              <dl className="space-y-3 text-sm">
                {[
                  { key: "citationRate", label: "Citation rate", value: pct(generation?.citationRate ?? null, 0) },
                  { key: "citationsPerAnswer", label: "Citations / answer", value: num(generation?.citationsPerAnswer ?? null, 1) },
                  { key: "helpfulness", label: "Helpfulness", value: pct(generation?.thumbs.helpfulness ?? null, 0) },
                ].map((m) => (
                  <div key={m.key} className="flex items-center justify-between">
                    <dt className="flex items-center gap-1.5 text-muted-foreground">
                      {m.label}
                      <DefinitionPopover title={m.label} definition={defs[m.key]} />
                    </dt>
                    <dd className="font-medium">{m.value}</dd>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                  <dt>Thumbs</dt>
                  <dd>
                    {generation?.thumbs.total ? `${generation.thumbs.up} up / ${generation.thumbs.down} down` : "none yet"}
                  </dd>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <dt>Tokens</dt>
                  <dd>
                    {count(cost?.totals.promptTokens ?? 0)} in / {count(cost?.totals.completionTokens ?? 0)} out
                  </dd>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <dt>Priced turns</dt>
                  <dd>{pct(cost?.totals.pricedShare ?? null, 0)} of {count(cost?.totals.turns ?? 0)}</dd>
                </div>
              </dl>
            </Panel>
          </div>

          <div className="mt-6">
            <Panel
              title="Unsupported claims"
              hint="Sentences the judge could not find support for in the passages the reply was given. Each one links to the conversation it came from."
            >
              {(generation?.unsupportedExamples.length ?? 0) > 0 ? (
                <ul className="divide-y divide-border">
                  {generation!.unsupportedExamples.map((ex) => (
                    <li key={ex.messageId} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{ex.query || "(no query)"}</span>
                        <span>faithfulness {num(ex.score, 2)}</span>
                        <Link
                          href={`/app/inbox?conversationId=${ex.conversationId}`}
                          className="underline underline-offset-2 hover:text-foreground"
                        >
                          Open conversation
                        </Link>
                      </div>
                      <ul className="mt-2 space-y-1.5">
                        {ex.claims.map((c, i) => (
                          <li key={i} className="text-sm">
                            <span
                              className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                                c.verdict === "contradicted"
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-warning/10 text-warning"
                              }`}
                            >
                              {c.verdict.replace("_", " ")}
                            </span>
                            {c.claim}
                            {c.reason && (
                              <span className="mt-0.5 block text-xs text-muted-foreground">{c.reason}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>
                  {generation?.faithfulnessSamples
                    ? "Every sampled answer was fully supported by its retrieved passages."
                    : "No turns have been sampled for faithfulness yet. Sampling runs at RAG_FAITHFULNESS_SAMPLE_RATE."}
                </Empty>
              )}
            </Panel>
          </div>

          {/* ---- 4a. Gap clusters ---- */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Panel
              title="What customers ask that you cannot answer"
              hint="Open knowledge gaps collapsed by meaning, so one topic is one row rather than twenty phrasings of it. Ranked by volume scaled by how often the gap ended in a handoff."
            >
              {(gapClusters?.clusters.length ?? 0) > 0 ? (
                <ul className="divide-y divide-border">
                  {gapClusters!.clusters.slice(0, 6).map((c) => (
                    <li key={c.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{c.label}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          <span>{c.volume} asked</span>
                          <span>{c.queries.length} phrasing{c.queries.length === 1 ? "" : "s"}</span>
                          {c.escalationRate !== null && (
                            <span className={c.escalationRate > 0.5 ? "text-warning" : undefined}>
                              {pct(c.escalationRate, 0)} escalated
                            </span>
                          )}
                        </div>
                      </div>
                      <AnswerGapButton
                        agentId={scopedAgentId}
                        question={c.queries[0]?.question || c.label}
                        gapIds={c.queries.map((q) => q.gapId)}
                        volume={c.volume}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>
                  No open gaps in this window. Every question customers asked found something.
                </Empty>
              )}
              {!scopedAgentId && (gapClusters?.clusters.length ?? 0) > 0 && (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Pick a single website above to answer a gap — a Q&amp;A pair is written into one
                  agent&apos;s knowledge base.
                </p>
              )}
            </Panel>

            {/* ---- 4b. Weak passages ---- */}
            <Panel
              title="Passages that need work"
              hint="Scored per chunk, not per document: a document is rarely uniformly good, and the repair for one badly-split passage is not the repair for a bad document."
            >
              {indexHealth && indexHealth.totals.chunks > 0 ? (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {(
                      [
                        ["misleading", indexHealth.totals.misleading],
                        ["retrieved_not_cited", indexHealth.totals.retrievedNotCited],
                        ["dead_weight", indexHealth.totals.deadWeight],
                      ] as const
                    ).map(([flag, n]) => (
                      <div key={flag} className="rounded-lg bg-muted px-2 py-2.5">
                        <div className="font-display text-xl font-semibold tabular-nums">{n}</div>
                        <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {FLAG_COPY[flag].label}
                        </div>
                      </div>
                    ))}
                  </div>

                  {indexHealth.totals.truncated ? (
                    // These counts are computed from a capped scan. Showing them
                    // bare would read as a complete census of the index.
                    <p className="mt-3 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                      Counts cover the first{" "}
                      {(indexHealth.totals.scanLimit ?? 0).toLocaleString()} passages of a larger
                      knowledge base, not the whole index.
                    </p>
                  ) : null}

                  {indexHealth.chunks.length > 0 ? (
                    <ul className="mt-4 divide-y divide-border">
                      {indexHealth.chunks.slice(0, 6).map((c) => (
                        <li key={c.chunkId} className="py-3 first:pt-0 last:pb-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {c.flags.map((f) => (
                              <span
                                key={f}
                                title={FLAG_COPY[f].fix}
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${FLAG_COPY[f].tone}`}
                              >
                                {FLAG_COPY[f].label}
                              </span>
                            ))}
                            <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                              {c.retrievals}× retrieved
                              {c.downvoteRate !== null && ` · ${pct(c.downvoteRate, 0)} down`}
                              {c.citationRate !== null && ` · ${pct(c.citationRate, 0)} cited`}
                            </span>
                          </div>
                          <div className="mt-1.5 truncate text-sm">{c.title ?? "(source deleted)"}</div>
                          {c.preview && (
                            <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                              {c.preview}
                            </p>
                          )}
                          <div className="mt-2 flex gap-2">
                            <ReindexButton sourceId={c.sourceId} title={c.title ?? "source"} />
                            <MarkSourceButton
                              sourceId={c.sourceId}
                              title={c.title ?? "source"}
                              stale={false}
                              priority={0}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-4 text-xs text-muted-foreground">
                      Every indexed passage is pulling its weight in this window.
                    </p>
                  )}
                </>
              ) : (
                <Empty>
                  No indexed passages yet, or no retrieval telemetry to score them against.
                </Empty>
              )}
            </Panel>
          </div>

          {/* ---- 4. Knowledge health ---- */}
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Panel
              title="Top failing queries"
              hint="Highest-volume questions that found nothing or produced a low-confidence answer."
              className="lg:col-span-2"
            >
              {(failing?.items.length ?? 0) > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2 font-medium">Query</th>
                        <th className="pb-2 text-right font-medium">Turns</th>
                        <th className="pb-2 text-right font-medium">No hits</th>
                        <th className="pb-2 text-right font-medium">Low conf.</th>
                        <th className="pb-2 text-right font-medium">Top score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {failing!.items.map((it) => (
                        <tr key={it.query}>
                          <td className="py-2 pr-3">
                            <Link
                              href={`/app/inbox?conversationId=${it.conversationId}`}
                              className="hover:underline"
                            >
                              {it.query || "(empty)"}
                            </Link>
                            {it.gap && (
                              <span className="ml-2 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
                                gap ×{it.gap.occurrenceCount}
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums">{it.turns}</td>
                          <td className="py-2 text-right tabular-nums">{it.noHits}</td>
                          <td className="py-2 text-right tabular-nums">{it.lowConfidence}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">
                            {num(it.meanTopScore, 2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>No failing queries in this window. Every turn found something and answered confidently.</Empty>
              )}
            </Panel>

            <Panel
              title="Knowledge health"
              hint="Sources that never get retrieved are dead weight; sources that never indexed cannot be retrieved at all. They look identical until you separate them."
              action={
                <BulkDeleteDeadWeight count={sources?.totals.neverRetrieved ?? 0} />
              }
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                Never retrieved
                <DefinitionPopover title="Never retrieved" definition={defs.neverRetrieved} />
                <span className="ml-auto tabular-nums">
                  {count(sources?.totals.neverRetrieved ?? 0)} of {count(sources?.totals.sources ?? 0)}
                </span>
              </div>
              {(sources?.neverRetrieved.length ?? 0) > 0 ? (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {sources!.neverRetrieved.slice(0, 6).map((s) => (
                    <li key={s.sourceId} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate">{s.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{s.chunkCount} chunks</span>
                      <MarkSourceButton sourceId={s.sourceId} title={s.title} stale={false} priority={0} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  {sources?.totals.sources ? "Every indexed source was retrieved at least once." : "No knowledge sources yet."}
                </p>
              )}

              <div className="mt-5 flex items-center gap-1.5 border-t border-border pt-4 text-xs font-medium text-muted-foreground">
                Failing ingestion
                <span className="ml-auto tabular-nums">{count(sources?.ingestion.failing ?? 0)}</span>
              </div>
              {(sources?.ingestion.failing ?? 0) > 0 ? (
                <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                  {(sources?.ingestion.byErrorClass ?? []).slice(0, 3).map((e, i) => (
                    <li key={i}>
                      <span className="text-foreground">{e.count}×</span> {e.message}
                    </li>
                  ))}
                  <li>
                    <Link href="/app/knowledge" className="underline underline-offset-2 hover:text-foreground">
                      Open Knowledge
                    </Link>
                  </li>
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">Every source indexed cleanly.</p>
              )}

              <div className="mt-5 border-t border-border pt-4">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  Most retrieved
                  <DefinitionPopover title="Mean top score" definition={defs.sourceMeanTopScore} />
                </div>
                {(sources?.top.length ?? 0) > 0 ? (
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {sources!.top.slice(0, 5).map((s) => (
                      <li key={s.sourceId} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {s.retrievalCount}× · {num(s.meanTopScore, 2)}
                        </span>
                        <ReindexButton sourceId={s.sourceId} title={s.title} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">Nothing retrieved in this window.</p>
                )}
              </div>
            </Panel>
          </div>
        </>
      )}

      {/* ---- 5. Eval history ---- */}
      <div className="mt-6">
        <Panel
          title="Offline eval history"
          hint="The last runs of the golden-set harness. A retrieval change that looks fine in production and tanked the fixture set has still regressed."
        >
          {evals?.available && evals.runs.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-medium">Run</th>
                    <th className="pb-2 text-right font-medium">Cases</th>
                    <th className="pb-2 text-right font-medium">Recall@5</th>
                    <th className="pb-2 text-right font-medium">MRR</th>
                    <th className="pb-2 text-right font-medium">Faithfulness</th>
                    <th className="pb-2 text-right font-medium">p95</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {evals.runs.map((r) => (
                    <tr key={r.file}>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {r.startedAt ? new Date(r.startedAt).toLocaleString() : r.file}
                        {r.errored > 0 && (
                          <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
                            {r.errored} errored
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums">{r.cases}</td>
                      <td className="py-2 text-right tabular-nums">{pct(r.retrieval?.recallAtK?.["5"] ?? null, 0)}</td>
                      <td className="py-2 text-right tabular-nums">{num(r.retrieval?.mrr ?? null, 2)}</td>
                      <td className="py-2 text-right tabular-nums">{pct(r.generation?.faithfulness ?? null, 0)}</td>
                      <td className="py-2 text-right tabular-nums">{ms(r.operational?.p95LatencyMs ?? null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>
              No offline eval reports available. Run <code className="font-mono">pnpm eval:rag</code> to
              produce one, or set <code className="font-mono">RAG_EVAL_REPORTS_DIR</code> if the
              reports live elsewhere in this deployment.
            </Empty>
          )}
        </Panel>
      </div>

      <p className="mt-6 text-[11px] text-muted-foreground">
        {NO_DATA} means no data rather than zero. Definitions come from the same source as the
        offline evaluation harness, so a number here and a number in an eval report mean the same
        thing.
      </p>
    </div>
  );
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense>
      <RagQuality searchParams={searchParams} />
    </Suspense>
  );
}
