# Changelog 1 — End-to-end review pass

A review of the whole system, running, rather than a feature. Four defects found
and fixed, three of them in code written earlier in this project and none of them
caught by the existing tests. Plus a spec correction.

Verified after every change: lint 10/10, type-check 10/10, **718 tests across 5
packages**, build 5/5.

---

## 1. All logging was silently disabled (critical)

`config/logger.ts` emitted **nothing**. Not a reduced level, not a dropped field:
the API produced zero log lines, and had since PII redaction was added to it.

The redaction formatter rebuilt winston's `info` object from its string keys.
Winston carries the level and the rendered message on **symbol** keys
(`Symbol.for("level")`, `Symbol.for("message")`), so the rebuilt object lost
them and the transport had nothing to print. No error, no warning, silence.

Fixed by mutating `info` in place instead of returning a new object, so the
symbols stay attached.

**Why nothing caught it.** The tests covered `redact()` — a pure function, tested
thoroughly and entirely correct. They never asserted that the logger *emits*.
Added `still actually emits a log line`, which writes through a real winston
transport into a capture stream and asserts the output. Tests of the helper are
not tests of the wiring, and this is the shape that lesson takes.

## 2. Unresolved provider costs were recorded as $0.00

Caught on a live turn: a conversation with three real generations reported
`promptTokens: 0, completionTokens: 0, costUsd: 0`.

`fetchGeneration` retries OpenRouter's `/generation?id=` endpoint, which 404s
until the record lands, then gives up. `recordUsage` writes the `UsageRecord`
with zeros regardless — deliberately, so the row exists for reconciliation — and
was **returning** those zeros to its caller. RAG telemetry wrote them onto the
turn, and the dashboard then counted it as *priced* and averaged a real cost
toward zero. An operator would read "$0.0000 per conversation" for an assistant
that is costing money.

This is precisely the trap `__specs/39` describes ("Cost is the trap... a fake
zero in a budget table is worse than a blank"), and the schema comment on
`RagTurnMetric.generation.costUsd` says the same. The telemetry backfill I wrote
went and undid it.

Fixed with the spec's own rule: a row that **names generations but reports zero
tokens is a give-up**, so `recordUsage` returns `null` (unknown) while still
writing the row. Tokens are the evidence the provider answered — a row *with*
tokens is trusted even if its cost rounds to zero, because a free model really
can cost nothing.

Confirmed on a live turn after the fix: `tokens: [null, null], costUsd: null`.

## 3. A scheduled job loaded every document's full text into memory

`findDriftedSources` read up to 1,000 `KnowledgeSource` documents **including
`extractedText`** in one query. A crawled website's text is routinely megabytes,
so the nightly job's memory was set by the customer's largest documents rather
than by anything the code chose. My own comment called it "cheap".

Now streamed with a cursor, hashing one document at a time and stopping as soon
as enough drift is found, so memory is O(1) in document size. The scan cap moved
to a named constant and bounds *work*, not memory.

## 4. The dashboard loaded the whole corpus to show 100 previews

`scoreChunks` projected `text` for every chunk in the index — up to 20,000 rows —
to render a 200-character preview of at most 100 of them. It runs on a dashboard
load, so request memory scaled with the knowledge base.

The full scan is still needed (dead weight is a chunk with *no* telemetry, so the
index itself is the only place it exists), but it no longer carries the text.
Previews are fetched in a second, bounded query for the page actually returned.

## 5. The API spec documented two endpoints that do not exist

`GET /analytics/overview` and `GET /analytics/conversations` were specified in
`__specs/07`, referenced from three more spec files, and **never implemented**.
Nothing calls them; the dashboard is built from `/analytics/conversations-daily`,
`/volume`, `/feedback`, `/knowledge-gaps`, `/csat-ratings`, `/low-rated-answers`
and `/tool-calls`, four of which the spec did not document at all.

Corrected `__specs/07` to describe the endpoints that exist, and fixed the
references in `11-page-wiremap.md`, `16-production-readiness-audit.md` and
`17-template-asset-inventory.md`. A spec naming endpoints the code does not serve
is worse than an incomplete one, because it is what a regeneration builds from.

---

## Verified working end to end

Against the running stack (API on :4000, Next on :3000, Mongo, Redis):

- **21 GET endpoints** across orgs, websites, agents, conversations, knowledge,
  billing, analytics, rag-metrics, index-health and notifications: all 200 except
  the one documented-but-missing route above.
- **A real widget turn**: session → conversation → message → grounded AI reply
  citing the knowledge base → telemetry written, including the per-chunk records
  added for index health.
- **Six dashboard pages** rendered with a real authenticated session, zero
  application errors, all ten RAG Quality panels populated.
- **The four repair actions**: weak-chunk report with previews, the bulk-delete
  review token, and a metadata-only `mark` that left `embeddingStatus` untouched.

## Proceeded under assumption

- **No backfill for historical fake-zero costs.** RAG telemetry has never been
  deployed, so the only rows carrying a fake zero are in this dev database. If
  any pre-existing `RagTurnMetric` rows exist elsewhere, rows with
  `costUsd: 0` **and** `promptTokens: 0` and a non-empty `generationIds` on their
  `UsageRecord` are give-ups and should be set to null.
- **The drift scan cap is 5,000 sources per night**, newest first. A larger
  corpus is covered across successive nights. It bounds time, not memory.

## Files

**Changed** — `apps/api/src/config/logger.ts`,
`apps/api/src/services/openrouter-usage.service.ts`,
`apps/api/src/jobs/index-health.job.ts`,
`apps/api/src/services/kb/index-health.service.ts`,
`apps/api/src/__tests__/{security-controls,rag-telemetry,index-health}.test.ts`.

**Docs** — `__specs/07-api-specification.md`, `__specs/11-page-wiremap.md`,
`__specs/16-production-readiness-audit.md`,
`__specs/17-template-asset-inventory.md`, `IMPLEMENTATION_AUDIT.md`.

No new environment variables.
