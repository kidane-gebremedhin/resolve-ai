# 45 — Deferred Decisions, With Data

Every decision parked with a default during P1-P11, presented as: what the
default was, what the numbers now say, what changing it costs, and a
recommendation. **The decisions are the owner's; this document stops at the
recommendation.** Updated 2026-10-09; provenance tags as in
`37-rag-pipeline-audit.md` (**[measured]**, **[recorded]**, **[telemetry]**,
**[code]**, **[derived]**). Prices marked *list* were fetched on 2026-10-09 from
`https://openrouter.ai/api/v1/models` and `https://www.pinecone.io/pricing/`.

---

## 0. The evidence base, stated first

**Changelogs.** The previous version of this section said the P1-P11 changelogs
were unrecoverable and that no surviving changelog contained a "proceeded under
assumption" line. **The second half was wrong.** What git actually holds:

| Changelog | Commit | Assumption lines |
| --- | --- | --- |
| Seven changelogs from the pre-RAG work (plans, usage, admin sessions) | `30c6602`, `c09c16a`, `298f65d`, `e2e06c8`, `3d14a66` | 0 (checked with `grep -i assum`) |
| `CHANGELOG_1.md`, "End-to-end review pass" | `3d40ab5` (2026-08-27) | **2** |
| `CHANGELOG_2.md`, "codebase review and fixes" | `89d2828` (2026-09-07) | **1** |
| `CHANGELOG_1.md` to `CHANGELOG_5.md` in the working tree (Render guide, P9 audit, follow-up fixes, P11 audit, Render Node runtime) | untracked | **14** |

The per-phase changelogs P1-P8 were never tracked and are gone (`.gitignore` once
excluded `CHANGELOG_*.md`; the pattern is now commented out at `.gitignore:76`,
but untracked files still do not survive a clean). Their reasoning survives only
where a phase also wrote it into a spec or a code comment, which is what the
reconstructed register in §4.3 is built from.

**Telemetry.** The development database (`csb-dev_mongo-data`, created
2026-09-07) holds **1** `RagTurnMetric`, **1** `UsageRecord`, **0** knowledge
sources. The figures the previous version quoted (63 answered turns, 1,516 usage
rows, 1,453 embedding rows, an 8-chunk KB) came from a database that no longer
exists on this machine and **cannot be reproduced**; they are not used below.

**Eval reports.** `packages/rag-eval/reports/` is empty and git-ignored. The
previous version counted 48 reports. Numbers from those runs survive only where a
phase copied them into a spec, and are cited there as [recorded].

**Provider calls.** No `OPENROUTER_API_KEY`, `EMBEDDING_API_KEY` or
`PINECONE_API_KEY` is configured here, so nothing below involves a new model,
judge, embedding or rerank call.

---

## 1. Eval judge model and budget

**The default.** `RAG_EVAL_JUDGE_MODEL` and `RAG_FAITHFULNESS_JUDGE_MODEL` both
default to `anthropic/claude-sonnet-4.5` (`apps/api/src/config/env.ts:287-290`),
online sampling at `RAG_FAITHFULNESS_SAMPLE_RATE=0.05` (`config/env.ts:281`). One
judge for both, so offline and online faithfulness are comparable
(`__specs/39-rag-evaluation.md`). Judge output is capped at 4,000 tokens
(`apps/api/src/services/ai/eval/judge.ts:80`).

**What the numbers say.**

| | Value | Provenance |
| --- | --- | --- |
| Cost per judged harness case (answer + judge) | **$0.019** | [recorded] `__specs/43-grounded-prompting.md:150-152` |
| Full 45-case judged run | **≈ $0.86** | [derived] 45 × $0.019 |
| CI smoke run (`pnpm eval:rag --limit 10`, judge on when secrets exist) | **≈ $0.19** per run that touches the RAG paths | [derived] 10 × $0.019; `.github/workflows/ci.yml:59-93` |
| Online judge per sampled turn, Sonnet 4.5 | **≈ $0.014-0.023** | [derived] ~3.5-5k prompt tokens (context budget 3,000, `config/env.ts:103`, plus question, answer and instructions) and 300-800 output tokens, at *list* $3/M prompt, $15/M output |
| Answering cost of a turn | $0.0099 (one turn) | [telemetry] |
| Online overhead at 5% sampling | **≈ +7% to +12%** of answering spend | [derived] 0.05 × $0.014-0.023 / $0.0099 |
| Per month | **≈ $1.10 per 1,000 turns** at the midpoint ($0.0185 × 50 sampled) | [derived]; real monthly volume unknown |
| Faithfulness measured, offline or online | **never** | `__specs/43-grounded-prompting.md:148-152` |

**A cheaper judge.** At *list* prices `anthropic/claude-haiku-4.5` ($1/$5 per M)
is about **3x cheaper** than Sonnet 4.5, and `openai/gpt-4o-mini` ($0.15/$0.60) about
**20x**. **Agreement with the current judge is undetermined:** it needs both
judges run over the same cases, and neither has produced a single faithfulness
score yet.

**Cost of changing.** One env var per judge, no code.

**Recommendation.** Do not optimise the judge before it has run. Fund one judged
45-case run (≈ $0.86) and one week of online sampling; then run the same 45 cases
with Haiku 4.5 and compare per-claim verdicts. Switch only if agreement on
unsupported claims is high, because the claims a cheaper judge misses are the
hallucinations this metric exists to catch.

---

## 2. Reindex tolerance

**The default.** `apps/api/scripts/reembed.ts` re-ingests sources through the
real pipeline; it is both the repair for unembedded sources and the backfill for
the P4 mirror (`reembed.ts:1-25`). Changing `EMBEDDING_MODEL` requires a full
re-embed, because mixed vector spaces return nonsense (`__specs/41-hybrid-retrieval.md`).

**What the numbers say.**

| | Value | Provenance |
| --- | --- | --- |
| Largest real KB on this machine | **none** (0 sources in the dev volume; 2 in the pre-RAG volume) | [telemetry] |
| Chunks per 25MB source | 24,286-25,833 | [measured] `38-scale-and-load-risks.md` §1 |
| Chunk time per 25MB source, by shape | 0.1s (plain prose) to **537s** (CSV) | [measured] same |
| Embedding price, `text-embedding-3-small` | $0.02 per M tokens | [recorded] `__specs/41-hybrid-retrieval.md:204` |
| Re-embed a 25MB source | ≈ 7.5M tokens, **≈ $0.15** | [derived] 25k chunks × ~300 tokens |
| Re-embed a 100,000-chunk platform | ≈ 30M tokens, **≈ $0.60** | [derived] |
| Switch to `text-embedding-3-large` @1536 | $0.13/M, **6.5x**; Recall@3 0.959 → 1.000, MRR 0.912 → 0.923 on the fixture set | [recorded] `__specs/41-hybrid-retrieval.md:201-217` |
| Wall-clock duration for a large KB | **undetermined**: no corpus to run it on, and no key for the network time | |

**What the resumability survives.** `--resume` skips any source whose mirror row
count already equals its chunk count (`reembed.ts:21-25`). That is correct for
the **mirror backfill** (same vectors, same space) and survives a crash, kill or
redeploy, because it reads outcomes rather than a checkpoint. It is **not** safe
for an **embedding-model change**: a source re-embedded under the old model also
has a matching mirror, so a resumed run would skip it and leave the corpus in two
vector spaces. Two more properties [code]: the script loads every selected
source's full text in one query (`reembed.ts:50-57`, no cursor) and ingests them
one at a time (`:111-125`), each through the chunker whose cost is in
`38-scale-and-load-risks.md` §1, **inside whatever process runs it**.

**Fixed 2026-10-10** (`37` §8). Each source now records the model its vectors
were written with (`KnowledgeSource.embeddingModel`, stamped on every successful
ingest), and `--resume` skips a source only when its mirror is complete **and**
that model equals the current `EMBEDDING_MODEL`. A resumed run after a model
change therefore finishes the change instead of stopping at a two-space corpus.
Sources ingested before the field existed have no stamp and count as stale, so
the first `--resume` after this change re-embeds them once. The script no longer
loads text: the cost estimate is summed in MongoDB and sources are walked with a
cursor. Ingests still run inside the script's process, one at a time.

**What a customer sees while it runs.** Per source: status flips to
`processing` in the dashboard (`apps/api/src/services/kb/ingestion.service.ts:94`);
vectors are overwritten in place by id, so dense retrieval keeps working; the
mirror is deleted then reinserted (`:267-269`), so for that interval the lexical
leg misses that source. For a model change, every query between the first and last
source re-embedded compares a new-space query against a mix of old- and new-space
passages.

**Cost of changing the model.** About $0.60 per 100k chunks in embeddings
[derived], plus the run time, which is dominated by chunking on CSV/HTML-heavy
corpora until `38` S1 is fixed.

**Recommendation.**

- **Mirror backfill, same model:** no window. Run live with `--resume`.
- **Embedding-model change:** a window, shaped **per agent**: take one agent's
  KB, re-embed it fully without `--resume` (or with a resume rule keyed on the
  model, which does not exist yet), restore it, move to the next. Agents are
  independent knowledge bases, so every other tenant stays live.
- **Who absorbs the cost:** at under a dollar per 100k chunks, absorb it. It is
  not worth a customer-facing approval step.
- **Fix `38` S1 first,** or a single CSV-heavy agent blocks the process running
  the migration for minutes per source.

---

## 3. Rerank provider

**The default.** `KB_RERANK_ENABLED=false` (`config/env.ts:135`). When enabled,
`KB_RERANK_PROVIDER=pinecone` with `bge-reranker-v2-m3` (`:136-137`); the
alternative `llm` reuses `AI_QUERY_REWRITE_MODEL`, default
`anthropic/claude-haiku-4.5` (`apps/api/src/services/ai/retrieval/rerank.ts:132-138`,
`config/env.ts:82`).

**What the numbers say.**

| Metric | Rerank off | Pinecone `bge-reranker-v2-m3` | `llm` (Haiku 4.5) |
| --- | --- | --- | --- |
| Recall@5, 45 cases | **1.000** | 0.919 | not measured |
| MRR | **0.912** | 0.892 | not measured |
| Multi-hop Precision@5 | 0.227 | **0.367** | not measured |
| Negative cases routed to "no evidence" | 0 of 8 | **8 of 8** | not measured |
| Faithfulness | not measured | not measured | not measured |
| p50 / p95 latency, 50 candidates | n/a | 1,155 / 1,295ms (8 calls) | not measured |
| USD per search | n/a | **$0.002** (*list*: $2 per 1k requests) | **≈ $0.015-0.02** [derived]: 50 candidates × ~300 tokens ≈ 15k prompt tokens at *list* $1/M |

Pinecone figures are [recorded] in `__specs/42-reranking.md:144-157,170`. A turn
makes one search when it searches at all, so Pinecone reranking adds ≈ **$0.002
per searching turn, about 20%** of the one measured turn's $0.0099, plus about
1.2s.

**Cost of changing.** One env var. The `KB_RERANK_MIN_SCORE` floor (0.0005,
`config/env.ts:162`) was calibrated for `bge-reranker-v2-m3` specifically
(`__specs/42-reranking.md:98-106`); switching to `llm` needs a new sweep.

**Recommendation.** Keep **Pinecone** as the provider default: it is the only
one measured, it is about 8-10x cheaper per search than the LLM path, and its
score is calibrated. Whether to **enable** reranking is the real decision: it
trades 8 points of Recall@5 on answerable questions and ~1.2s for correctly
refusing 8 of 8 unanswerable ones. The measurement that would settle it,
refusal correctness and faithfulness with and without reranking, needs the
judged run in §1. Run that first; it costs about $1.71 for the pair.

---

## 4. Every recorded "proceeded under assumption"

### 4.1 From the recovered changelogs (verbatim source, current status)

| # | Assumption | Source | Status today |
| --- | --- | --- | --- |
| C1 | No backfill for historical fake-zero costs; rows with `costUsd: 0`, `promptTokens: 0` and non-empty `generationIds` are give-ups and should be set to null | `3d40ab5:CHANGELOG_1.md` "Proceeded under assumption" | Holds. The dev volume's only usage row is priced ($0.009915), so there is nothing to backfill here |
| C2 | The drift scan cap is 5,000 sources per night, newest first; bounds time, not memory | `3d40ab5:CHANGELOG_1.md` | Holds: `apps/api/src/jobs/index-health.job.ts:39`. The scan sorts in memory (`38` §3, S9) |
| C3 | Low confidence stays telemetry-only rather than auto-escalating, until a false-positive rate is measured against real traffic | `89d2828:CHANGELOG_2.md:160-168` | Holds; still open as A20 below. Contradicted by `__specs/05` "Confidence Monitoring & Auto-Escalation", which documents auto-escalation (drawn dashed in `E2E_FLOW.md` §4) |
| C4 | Render: embed runs as a Docker web service, not a Static Site | working tree `CHANGELOG_1.md` | Holds; `RENDER_DEPLOYMENT_GUIDE.md` |
| C5 | Render: Redis/Key Value left out, because nothing connects to `REDIS_URL` | `CHANGELOG_1.md` | Holds: `REDIS_URL` is read at `apps/api/src/config/env.ts:47` and used nowhere else |
| C6 | Render: S3-compatible storage recommended over a disk | `CHANGELOG_1.md` | Holds |
| C7 | "P9 merged" read as `RagTurnMetric` being on `main` | `CHANGELOG_2.md` | Holds |
| C8 | The membership guard is scoped to the RAG metrics and index-health routers, not the global `requireOrg` | `CHANGELOG_2.md` | Holds: every other router still trusts the token's `organizationId` until expiry. **A decision:** extend it platform-wide, at one indexed probe per request |
| C9 | P11's passage flags stay classified in Node over a bounded set | `CHANGELOG_2.md` | Superseded by `CHANGELOG_3` (exact counts, `38` closed items) |
| C10 | Manifest versions aligned up to the lockfile, not down | `CHANGELOG_3.md` | Holds |
| C11 | The `brace-expansion` override keeps its 1.1.16 floor for the 1.x line only | `CHANGELOG_3.md` | Holds. **The same unbounded-override mistake exists for `@xmldom/xmldom` and breaks every DOCX upload** (`38` §1 Finding 2); `CHANGELOG_3` carried it into `package.json` without catching it |
| C12 | Passage flag rules stay in one function (`flagChunk`) rather than duplicated in a pipeline | `CHANGELOG_3.md` | Holds |
| C13 | The dead-weight age rule uses the scoring window itself; no separate grace setting | `CHANGELOG_4.md` | Holds |
| C14 | Migration 002 may delete orphan mirror rows automatically, because they belong to deletions already confirmed | `CHANGELOG_4.md` | Holds |
| C15 | A foreign `agentId` on index-health reads matches nothing instead of falling back to org-wide | `CHANGELOG_4.md` | Holds |
| C16 | Render Node runtime pinned to Node 20 (`NODE_VERSION=20`), matching the Docker images | `CHANGELOG_5.md` | Holds: `RENDER_DEPLOYMENT_GUIDE.md:176`; root `package.json:32` is `>=20.0.0` with no upper bound, which is why the pin exists |
| C17 | The API runs migrations in its start command, not a Render pre-deploy command | `CHANGELOG_5.md` | Holds: `RENDER_DEPLOYMENT_GUIDE.md:158`, matching `apps/api/docker-entrypoint.sh` |

### 4.2 Reconstructed register, re-verified

From specs and code comments (§0). Each status checked against the tree on
2026-10-09.

| # | Assumption | Where | Status |
| --- | --- | --- | --- |
| A1 | Telemetry retention is 90 days, configurable | `apps/api/src/config/env.ts:271` | Holds |
| A2 | Telemetry query text is PII-masked unconditionally | `__specs/12` §6.9, `models/RagTurnMetric.ts:31-35` | Holds |
| A3 | Retrieval-confidence weights 0.60 / 0.25 / 0.15 are tuned, not measured | `apps/api/src/services/ai/retrieval/retrieval-confidence.ts:29-33` | Holds; nothing routes on it |
| A4 | A turn's first KB search is the one recorded on the metric | `rag-telemetry.service.ts` | Holds |
| A5 | Per-source mean score is exact only for rank-1 turns | `__specs/39` | Holds |
| A6 | `RAG_EVAL_REPORTS_DIR` defaults to a monorepo path; an API-only image answers `available: false` | `config/env.ts`, `rag-metrics.routes.ts` | Holds |
| A7 | The knowledge-gap join runs in Node because one side is masked | `rag-metrics.routes.ts` | Holds |
| A8 | Weak chunks surface by notification and dashboard, not persisted findings | `__specs/04` | Holds |
| A9 | Drift = stored text no longer hashes to `contentHash` | `jobs/index-health.job.ts` | Holds; a drift into a sibling's content is now skipped (`CHANGELOG_4`) |
| A10 | `stale` is a field separate from `priority` | `models/KnowledgeSource.ts` | Holds, **but neither affects retrieval by default** (`37` R6): `stale` is read by nothing, `priority` only by conflict detection, which is off |
| A11 | Drift scan examines 5,000 sources per night | `index-health.job.ts:39` | Holds (= C2) |
| A12 | `KB_HYBRID_ALPHA = 0.7` is measured | `config/env.ts:124`; `__specs/41:164-182` | Holds [recorded] |
| A13 | `KB_RERANK_MIN_SCORE = 0.0005` is measured | `config/env.ts:162`; `__specs/42:98-106` | Holds [recorded], for `bge-reranker-v2-m3` only |
| A14 | `KB_HEALTH_GAP_SIMILARITY = 0.55` measured on 7 queries from one corpus | `config/env.ts:249` | Holds, weakly |
| A15 | Judge output capped at 4,000 tokens, conflict check at 512 | `judge.ts:80`, `services/kb/conflict.ts:176` | Holds |
| A16 | P9 stored source-level retrieval only | n/a | Superseded by P11 per-chunk records |
| A17 | Per-org Pinecone namespaces as a critical control | `__specs/12` | Corrected: metadata filtering; namespaces are future hardening (`ingestion.service.ts:216-219`) |
| A18 | `pnpm audit` advisory, not gating | `.github/workflows/ci.yml:194-201` | Holds. **Now 57 advisories, 5 critical, 21 high** [measured], against 63 / 3 critical recorded earlier |
| A19 | No backfill of fake-zero costs | = C1 | Holds |
| A20 | The uncited-ratio control is a signal, not a control | `finalize.node.ts:236-247` | **Open decision** |
| A21 | No reasoning trace in graph state, and nothing justifies its absence | `__specs/05` "ReAct conformance" | Open |
| A22 | Scheduled loops overlapped | `jobs/serial-loop.ts` | Fixed per process, and production now runs 1 API replica (`38` S4, fixed 2026-10-10) |

### 4.3 Discovered during this audit, not previously recorded

These were never written down as assumptions, but the code behaves as if each
one were true:

| # | Implicit assumption | Evidence | Reality |
| --- | --- | --- | --- |
| N1 | "Recent history" is the last messages | `apps/api/src/services/ai/graph/runner.ts:82` comment | The query returned the **first** 20. **Fixed 2026-10-10** (`services/ai/graph/history.ts`) |
| N2 | Crawled websites go through the same pipeline as uploads | `ingestion.service.ts:126-131` comment ("mirroring the live-crawl path") | They did not on first ingest. **Fixed 2026-10-10**: crawls call `ingestSource` |
| N3 | The lexical leg is served by the `{organizationId, agentId}` index | `models/KbChunk.ts:67-68` | It was not. **Fixed 2026-10-10**: the text index carries the tenant prefix |
| N4 | Security overrides can be unbounded | root `package.json` `pnpm.overrides` | Broke `minimatch@3` and `mammoth`. **Both fixed**: overrides are scoped by major |
| N5 | The API runs as one replica | `RUNBOOK.md` §10.3 | Production compose said 2. **Fixed 2026-10-10** |
| N7 | Any extracted text fits on the source row | `models/KnowledgeSource.ts` `extractedText` | MongoDB caps a document at 16MB; a 25MB upload under the size cap could not be saved. **Fixed 2026-10-10**: a 15MB cap with a readable refusal (`text_too_large`) |
| N6 | Marking a source stale or lowering its authority changes answers | P11 dashboard copy; `RUNBOOK.md` §13.5c | Not in the default configuration (A10) |

---

## 5. Decisions, ordered by what needs the owner first

| Order | Decision | Default today | Recommendation | Cost of changing |
| --- | --- | --- | --- | --- |
| 1 | **Fund the first judged eval run and a week of sampling** (§1) | Never run | Fund it; everything in §1 and §3 waits on it | ≈ $0.86 per run, ≈ $1.10 per 1,000 production turns |
| 2 | **Enable reranking?** (§3) | Off | Decide after decision 1; keep Pinecone as provider | One env var; ≈ $0.002 and ~1.2s per searching turn |
| 3 | **Low confidence → human?** (A20 / C3) | Telemetry only | Keep telemetry-only until decision 1 yields a false-positive rate; then decide | A routing change in `runner.ts` plus the measured false-positive rate |
| 4 | **Membership check platform-wide?** (C8) | RAG routes only | Extend: revoked members otherwise keep access until token expiry | One indexed probe per authenticated request |
| 5 | **Embedding model** (§2) | `text-embedding-3-small` | Stay until a judged run shows `3-large`'s +0.041 Recall@3 matters to answers | ≈ $0.60 per 100k chunks once, then 6.5x embedding cost |
| 6 | **Make `stale` / `priority` mean something by default** (A10, N6) | Inert without conflict detection | Either feed `priority` into fusion ordering or change the dashboard copy to say it only matters with conflict detection on | Small code change, or a copy change |
| 7 | **Commit changelogs and QA results** (§0) | Untracked, lost on clean | Commit them, or move them under `__specs/` | None |

Defects with a known fix that need no decision were listed in
`37-rag-pipeline-audit.md` §7 and `38-scale-and-load-risks.md` §6. All of them
were fixed on 2026-10-10 (`37` §8). One new decision came out of that pass:

| Order | Decision | Default today | Recommendation | Cost of changing |
| --- | --- | --- | --- | --- |
| 8 | **Large uploads in a 512MB container** (`38` S5) | 25MB upload cap, 15MB text cap, ingestion in the API process | Lower the cap for text-heavy types (CSV, TXT, MD, HTML) to ~5MB, or run ingestion in a worker. Measured on top of a 404MB idle process: +70MB at 5MB of text, +295-360MB at 14.5MB. The production process baseline (compiled, not `tsx`) has not been measured | A config change for the cap; a deploy topology change for the worker |

## 6. What could not be determined

| Question | Why | What would settle it |
| --- | --- | --- |
| Faithfulness, offline or online | The judge has never produced a score | One judged 45-case run (≈ $0.86) and a week of sampling |
| Cheaper-judge agreement | Needs two judges over the same cases | The same run repeated with Haiku 4.5 |
| LLM rerank provider quality, latency | Never benchmarked | `KB_RERANK_ENABLED=true KB_RERANK_PROVIDER=llm pnpm eval:rag --retrieval-only`, then a new floor sweep |
| p50 / p95 per hop, real traffic | One real turn exists | Real traffic; percentiles are already computed by `GET /rag-metrics/summary` |
| Share of turns needing >1 search / hitting the tool ceiling | One turn (`toolTurns: 1`) | Same |
| Whether the ceiling path really returns the apology (`37` G4) | No provider key | One turn against `openai/gpt-4o` with `AI_MAX_TOOL_TURNS=1` and a tool the model will call twice |
| Reindex wall-clock for a large KB | No corpus; no key | `reembed.ts --all --dry-run`, then a real run, on a copy of a large tenant |
| `topK` versus corpus size | No corpus larger than the fixture KB | `38` T1 |
| Concurrent turn ceiling, OpenRouter rate limit | Needs live calls | `38` T2 (≈ $6) |
| Filtered-query latency versus namespaces | No Pinecone key | `38` T3 |
| The original P1-P8 assumption text | Never tracked | Nothing; reconstruct forward and commit from now on |
