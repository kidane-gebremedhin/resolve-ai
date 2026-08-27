# QA Test Results 1 — End-to-end review pass

Date: 2026-09-04

Verified against the **running stack**: API on :4000 (`tsx watch`), Next.js on
:3000, `csb-mongo`, `csb-redis`, logged in as `owner@acme.test`.

## Summary

| | |
| --- | --- |
| Automated | **718 passed, 0 failed** (api 579, rag-eval 84, web 35, widget 20) |
| Lint | 10/10 tasks |
| Type-check | 10/10 tasks |
| Build | 5/5 tasks |
| Defects found | **4**, all fixed and re-verified |
| Spec corrections | 4 files |
| Blocked | browser QA (chrome-devtools MCP failed to connect) |

---

## How the defects were found

Three of the four were invisible to the test suite and to static reading. They
surfaced from **running the thing and looking at what it did**:

| Defect | How it surfaced |
| --- | --- |
| Logging silently disabled | Smoke-ran the logger; it printed nothing |
| Fake $0.00 costs | Drove a live turn, then read the telemetry row it wrote |
| Job loads full document text | Read the query back after the runtime pass raised the question |
| Dashboard loads whole corpus | Same review, same class |

The first two were in code with passing tests. The tests were correct about the
units they covered and silent about the wiring between them.

---

## 1. Logging — fixed and verified

**Before:** the logger emitted nothing at all.

```
--- begin ---
--- end ---            ← three logger calls between these lines
```

**After:**

```json
{"level":"info","message":"plain message","timestamp":"2026-09-04T13:33:47.525Z"}
{"email":"[REDACTED](8)","level":"warn","message":"with meta","organizationId":"org1","password":"[REDACTED]",...}
{"durationMs":12,"level":"error","message":"nested","user":{"name":"Ada","token":"[REDACTED]"}}
```

Redaction still works; ordinary diagnostic fields still readable. Confirmed in
the running API's own boot and request logs.

**Regression test added:** writes through a real winston transport into a capture
stream and asserts a line came out, its level, its message, and that the
credential was redacted.

## 2. Unresolved cost — fixed and verified

**Before**, on a live turn with three generations:

```
metric.generation: {"promptTokens":0,"completionTokens":0,"costUsd":0,...}
usagerecord:       {"p":0,"c":0,"cost":0,"gens":3}
```

**After**, on another live turn under the same conditions:

```
AFTER FIX -> {"tokens":[null,null],"costUsd":null}
```

The dashboard's `pricedTurns` uses `$isNumber`, so a null is excluded from the
denominator rather than counted as a free turn.

**Tests added:** a give-up returns null while still writing the row for
reconciliation; a genuine measured zero is still reported as zero.

## 3 & 4. Memory — fixed and verified

`findDriftedSources` now streams; `scoreChunks` no longer projects chunk text
across the index. Behaviour unchanged, verified live:

```
index-health/chunks -> totals {"chunks":2,"retrieved":1,"deadWeight":1,...}
   ['dead_weight'] | Scanned Contract.pdf | preview: (the PDF could not be opened)
```

Previews still render for the returned page. `index-health.test.ts` gained a case
asserting exactly that, so the optimisation cannot silently drop them.

---

## End-to-end sweep

### API surface — 21 endpoints

All `200` except one, which is the spec bug in §5 of the changelog:

```
/orgs/current 200   /websites 200   /agents 200   /conversations 200
/knowledge 200      /billing/usage 200
/analytics/overview 404  ← documented in 4 spec files, never implemented
/analytics/feedback 200  /analytics/knowledge-gaps 200
/rag-metrics/{summary,retrieval,generation,cost,failing-queries,
              source-health,eval-runs,definitions} 200 (8/8)
/index-health/{chunks,gap-clusters} 200
/notifications 200  /knowledge/health/ingestion 200
```

### A real customer turn

```
POST /widget/conversations/:id/messages -> 201 in 0.09s
messages: 2
  [customer] How long do refunds take?
  [ai] Refunds are processed within 30 days of purchase for a full refund...
telemetry: {"q":"refund processing time","hits":1,"chunks":1,"conf":0.5,"status":"ok"}
```

The reply is grounded in the knowledge base and cites it. `chunks: 1` is the
per-chunk telemetry that index health depends on, recorded in production for the
first time.

`conf: 0.5` is the documented fallback: the meta pass failed with
`402 ... exceed your available credits`. The turn degraded exactly as designed —
customer still answered, confidence marked low, escalation threshold respected.
That is an account-balance limit in this environment, not a defect.

### Dashboard pages, real session

| Page | Status | Size | App errors |
| --- | --- | --- | --- |
| `/app` | 200 | 65 KB | 0 |
| `/app/analytics` | 200 | 66 KB | 0 |
| `/app/analytics/rag` | 200 | 125 KB | 0 |
| `/app/knowledge` | 200 | 52 KB | 0 |
| `/app/inbox` | 200 | 53 KB | 0 |
| `/app/settings` | 200 | 49 KB | 0 |

All ten RAG Quality panels present. Rendered KPI values read correctly:

```
Faithfulness  -- not sampled yet     Mean confidence 0.65 (4 turns)
No-hit rate   25%                    Escalation rate 0%
p95 latency   31.5s (p50 10.9s)      Cost / conversation $0.0116 (3 priced)
```

`--` for an unsampled metric rather than `0%`, which is the null-vs-zero rule
holding all the way to the DOM.

> One thing checked rather than assumed: the RSC payload shows `$$0.0116`. That
> is Next's Flight-protocol escaping of a leading `$`, not a formatting bug — the
> rendered DOM contains `$0.0116`. Verified by stripping script blocks and
> reading the visible text.

### Repair actions

```
bulk-delete/preview -> candidates ['Scanned Contract.pdf'], token issued: true
sources/:id/mark    -> priority -2, embeddingStatus "synced" (unchanged)
```

Mark stays metadata-only: no re-embed triggered.

---

## Blocked

**Browser QA.** `chrome-devtools` MCP failed to connect
(`CONNECT_TIMEOUT` after 30s), so no clicking, no console/network inspection, no
viewport testing. Substituted: server-rendered HTML fetched with a real
authenticated session and asserted against, which covers rendering and data flow
but not interaction. The repair dialogs and the K selector are unverified in a
browser.

## Not covered

- **MinIO `deleteByPrefix`** is exercised only against the disk adapter. The
  MinIO path was verified by confirming `listObjectsV2` and `removeObjects` exist
  and that the client batches internally at 1,000 keys, but not run against a
  live bucket.
- **Sampled faithfulness** could not be exercised: the OpenRouter balance is
  exhausted, so the judge would 402. The skip path is unit-tested.
- **`pnpm audit`** still reports 63 vulnerabilities (3 critical, 35 high). The
  npm registry is unreachable from this environment, so no upgrade could be
  installed or verified. Unchanged from `IMPLEMENTATION_AUDIT.md` §3.4.
