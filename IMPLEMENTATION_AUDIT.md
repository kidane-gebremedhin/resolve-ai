# Implementation Audit

Date: 2026-09-02
Scope: the whole monorepo — what exists, what is unfinished, and what stands
between this and real users.

Every claim below traces to a file, a command output, or a spec section. Where I
could not establish something, it says so rather than guessing.

> **Update, 2026-09-04 (second pass).** A full end-to-end review of the running
> system found **four more defects**, three of them in code the test suite was
> already passing on. All are fixed; see `CHANGELOG_1.md` and
> `QA_TEST_RESULTS_1.md`. The headline one: **all API logging had been silently
> disabled** by the redaction formatter added during the first pass. §8 below
> covers it.
>
> **Update, 2026-09-02.** The P0 blockers below have been worked. Each one now
> carries a **RESOLVED** or **OPEN** marker with what was done and how it was
> verified. §7 is a new section covering what changed. The original findings are
> left intact rather than rewritten — an audit that quietly edits itself once the
> work is done is not a record of anything.
>
> This file is no longer gitignored: the rule that discarded it, and that
> destroyed `CHANGELOG_1–3` and every `QA_TEST_RESULTS` file (§2.3), has been
> removed from `.gitignore`.

---

## Verdict in one paragraph

**Original (2026-09-02, before remediation).** The product is feature-complete
and unusually well tested at the API layer, and it is not deployable to real
users today. Two things block it outright: CI is red on every single run, and
the four user-facing apps have zero automated tests between them. Beyond those,
most of the answer-quality work built in Phase 2 is shipped switched off.

**After remediation.** CI is green (lint 10/10, type-check 10/10, test 5/5), the
suite has grown from 585 to **714 tests across all five packages**, and four
security controls that the checklist required and the code did not have are now
implemented and asserted — including a **cross-tenant websocket leak** and a
**GDPR-breaking account deletion** that this pass found rather than inherited.
What remains before real users is: a dependency-vulnerability backlog that could
not be patched from this environment (§3.4), no end-to-end journey test (§3.3),
no backup runbook (§3.7), and the decision about the four disabled quality flags
(§2.2). The uncommitted-work risk (§2.4) is unchanged and still the largest.

---

## 1. What is built

### 1.1 Scale of the codebase

| Area | Count | Evidence |
| --- | --- | --- |
| API route modules | 29 | `apps/api/src/routes/` |
| Mongoose models | 39 | `apps/api/src/models/` |
| Service modules | 92 | `apps/api/src/services/**` |
| Background jobs | 5 (+ orchestrator) | `apps/api/src/jobs/` |
| API test files | 26 (**579 tests**) | `pnpm --filter @csb/api exec vitest run` |
| Eval harness tests | 5 (**84 tests**) | `pnpm --filter @csb/rag-eval exec vitest run` |
| Web dashboard tests | 3 (**35 tests**) | `pnpm --filter @csb/web exec vitest run` |
| Widget tests | 1 (**20 tests**) | `pnpm --filter @csb/widget exec vitest run` |
| **Total** | **718 tests, 5 packages** | `pnpm turbo run test` → 5/5 tasks |
| Web dashboard pages | 37 | `apps/web/src/app/**/page.tsx` |
| Admin portal pages | 11 | `apps/admin/src/app/**/page.tsx` |
| Design specs | 43 | `__specs/` |
| Deployable apps | 5 | `apps/{api,web,widget,embed,admin}` |

### 1.2 Platform and infrastructure — **built**

- Five apps, each with a `Dockerfile`; `docker-compose.yml` (Mongo, Redis,
  MailHog, MinIO) and `docker-compose.full.yml` (the whole stack incl. admin).
- Health endpoint at `apps/api/src/index.ts:77`.
- Schema migrations run automatically on API boot
  (`apps/api/src/scripts/migrate.ts`, `models/SchemaMigration.ts`,
  `migrations/001-integration-defaults.ts`).
- Socket.IO with an auth middleware (`apps/api/src/socket/index.ts:31`).
- CI covering lint, type-check, test, build, per-app Docker build, CodeQL,
  `pnpm audit` and gitleaks (`.github/workflows/ci.yml`).
- Coolify deployment topology documented across dev/staging/production
  (`__specs/20-coolify-deployment.md`).

### 1.3 Auth, tenancy and security — **built**

- Helmet, per-scope CORS (widget open, dashboard locked to `CORS_ORIGINS`), and
  an explicit `trust proxy` setting chosen to stop X-Forwarded-For spoofing
  defeating IP rate limits (`apps/api/src/index.ts:51-61`).
- JWT access/refresh with silent rotation, 2FA/TOTP, recovery codes, Google SSO
  with first-login org provisioning (`services/auth.service.ts`,
  `services/security/totp.ts`).
- Four-rank org role hierarchy enforced method-aware server-side
  (`middleware/org-role.middleware.ts`), mirrored in the UI for UX only
  (`apps/web/src/lib/permissions.ts`).
- Rate limiting on auth, coupons, messages, TTS and the public contact form.
- Multi-org row-level isolation, with a dedicated test suite
  (`__tests__/rls.test.ts`) and per-feature scoping tests in
  `rag-metrics.test.ts` and `index-health.test.ts`.
- PII masking before persistence (`services/integrations/piiMask.ts`), applied
  unconditionally to telemetry.
- SSRF guards on outbound integration and OG-preview fetches.

### 1.4 Core product — **built**

Widget → socket → agent → operator inbox is complete: contact sessions, widget
settings/studio, conversations and messages with streaming deltas, operator
takeover, leads, proactive triggers, rich message blocks (cards, forms, OTP,
link previews), voice input/TTS, CSAT and thumbs feedback, knowledge base
(upload / paste / crawl), an integration framework with OAuth, guardrails and an
audit log, Paddle billing with coupons, referrals/affiliates, and a platform
admin portal.

### 1.5 The AI pipeline — **built, largely switched off**

| Prompt | Feature | Code | Default |
| --- | --- | --- | --- |
| P2 | Offline RAG eval harness | `packages/rag-eval/` | n/a (manual) |
| P3 | Query rewriting, expansion, HyDE, follow-up round | `services/ai/retrieval/query-rewrite.ts` | **OFF** |
| P4 | Hybrid dense + lexical retrieval with RRF | `services/kb/lexical-search.service.ts`, `hybrid-fusion.ts`, `models/KbChunk.ts` | **ON** (`KB_HYBRID_ALPHA=0.7`) |
| P5 | Cross-encoder reranking | `services/ai/retrieval/rerank.ts` | **OFF** |
| P6 | Grounded prompting + enforced citations | `services/ai/context-block.ts`, `citation-validator.ts` | **ON** (unconditional in `finalize.node.ts`) |
| P7 | Contradictory-source detection and resolution | `services/kb/conflict.ts` | **OFF** |
| P8 | Ingestion observability and failure alerts | `services/kb/ingestion-events.ts`, `ingestion-health.service.ts` | ON |
| P9 | Per-turn RAG telemetry + sampled faithfulness | `models/RagTurnMetric.ts`, `services/ai/telemetry/` | ON |
| P10 | RAG Quality dashboard | `routes/rag-metrics.routes.ts`, `app/analytics/rag/` | ON |
| P11 | Index health + four repair actions | `services/kb/index-health.service.ts`, `routes/index-health.routes.ts` | Reads/repairs ON, **job OFF** |

**All 11 implementation prompts in `TODO_PROMPTS.md` are implemented.** Only P12
(analysis, see §2.1) remains.

---

## 2. What is pending

### 2.1 P12 — the deferred analysis pass

`TODO_PROMPTS.md:1112`. Produces four documents, none of which exist:

- `__specs/37-rag-pipeline-audit.md` — **missing** (spec numbering jumps 36 → 39)
- `__specs/38-scale-and-load-risks.md` — **missing**
- `E2E_FLOW.md` verification + Mermaid diagrams — **not done**
- A "ReAct conformance" section in `__specs/05-ai-agent-design.md` — **not done**

P12 also requires collecting every "proceeded under assumption" line from the
P1–P11 changelogs. See §2.3 — most of those changelogs no longer exist.

### 2.2 Quality features shipped disabled

Four flags default to `false`, each for a stated reason, and each represents
built-and-tested capability the product is not using:

| Flag | Why it was defaulted off | What turning it on costs |
| --- | --- | --- |
| `AI_QUERY_REWRITE_ENABLED` | Measured ~2.5s p95 added per KB turn — 6× the 400ms budget it was specified under | Latency; measurably better follow-up retrieval (MRR 0.55 → 1.00 on the fixture set) |
| `KB_RERANK_ENABLED` | "A measured trade, not a clear win" | Latency + per-call rerank cost |
| `KB_CONFLICT_DETECTION_ENABLED` | Adds an LLM call on turns where the top two sources score closely | Tokens on a minority of turns |
| `KB_INDEX_HEALTH_ENABLED` | Scoring must be watched on real traffic before a job acts on it | Nightly re-embed of drifted sources only |

This is a **decision backlog, not a defect** — but shipping to users without
deciding means shipping the weaker pipeline by default.

### 2.3 Lost session artifacts

`CHANGELOG_1.md`, `CHANGELOG_2.md`, `CHANGELOG_3.md` and **all four**
`QA_TEST_RESULTS_*.md` files are gone from the working tree. Only
`CHANGELOG_4.md` survives.

Cause: both patterns are gitignored (`.gitignore:60`, `.gitignore:68`), so the
files were never tracked and a clean or reset removed them. The *code* they
described is intact and tested; the written record of the decisions and the QA
evidence is not.

This directly blocks P12, which is specified to read those changelogs. It also
means the "proceeded under assumption" register has to be reconstructed from
code comments and specs rather than read off.

**Recommendation:** un-ignore both patterns, or move them under `__docs/`. A
changelog nobody can read after a reset is not a changelog.

### 2.4 Uncommitted work

`git status --porcelain` reports **121 entries** (63 modified, 58 untracked)
against `HEAD = 5c08a39 "Converted into langgraph agent"`. Everything from P2
onward — the eval harness, hybrid retrieval, reranking, grounded prompting,
conflict detection, ingestion observability, telemetry, both dashboards, index
health and the test-cost guard — is uncommitted.

Per the repo's standing instruction I have not committed. This is the single
largest operational risk in the audit: **the work exists only in one working
directory.**

---

## 3. What is missing to deploy to real users

### P0 — blockers

**3.1 CI is red on every run.** — ✅ **RESOLVED**
`pnpm turbo run lint` fails on `@csb/web`:

```
Error: Cannot find module 'eslint-module-utils/resolve'
Require stack: … eslint-plugin-import/lib/rules/no-unresolved.js
Failed: @csb/web#lint
```

The `lint` job has **no path filter** (`.github/workflows/ci.yml`, zero `if:`
conditions in that job), so it runs on every push and PR and fails every time.
Nobody can currently lint the web app either. Fix: add the missing
`eslint-module-utils` peer dependency, or drop `eslint-plugin-import`'s
resolver rules from the web config.

> **Resolved.** Not a config bug at all: the pnpm store held a **dangling
> symlink** — `eslint-plugin-import`'s `eslint-module-utils` pointed at a
> peer-suffixed directory that did not exist. A plain `pnpm install` rebuilt it.
> `pnpm turbo run lint` now reports **10 successful, 10 total**, and the web app
> lints with 0 errors (42 pre-existing warnings).

**3.2 One API test fails intermittently, and it is a real race.** — ✅ **RESOLVED**
`auth-2fa.test.ts` → *"accepts a code from the PREVIOUS window (device clock
running behind)"*. Observed failing in 1 of 3 full-suite runs, reproduced.

The cause is time-of-check versus time-of-use across a slow bcrypt. The test
captures `nowSec()`, generates a TOTP for `nowSec() - 30s`, then logs in — and
login hashes a password at bcrypt cost ≥12. Under load that took **10.4
seconds**. If those seconds cross a 30-second TOTP boundary, a code that was one
window old at generation is two windows old at verification, and the server
correctly rejects it. The production code is right; the test is racing itself.

Fix: freeze time for the assertion, or generate the code *after* the expensive
setup rather than before it. Left unfixed here — this audit was scoped to
document, not change, and a flaky test is exactly the kind of thing that should
be fixed deliberately rather than in passing.

Consequence: CI cannot be trusted to be green even once §3.1 is fixed.

> **Resolved.** Generation is now deferred until the current TOTP window has at
> least 15 seconds left (`awaitWindowSlack`), so the login round trip cannot
> cross a boundary. Only the previous-window case needed it — a next-window code
> only becomes more current as time passes, and a two-windows-old code only
> becomes staler, so both drift toward their expected result rather than away
> from it. Green four times in isolation and in every full-suite run since.

**3.3 No tests outside the API.** — ⚠️ **PARTLY RESOLVED**
`apps/web`, `apps/widget`, `apps/admin`, `apps/embed` and `packages/ui` have
**no `test` script at all**, so `pnpm turbo run test` silently covers only
`@csb/api` and `@csb/rag-eval`. 585 tests protected the backend; **zero** protected
the widget a customer actually types into, the dashboard an operator uses, or
the embed script that loads on customer websites.

There are also **no end-to-end tests** — no Playwright config, no `*.spec.ts`
anywhere — despite `__specs/14-testing-strategy.md` §3 specifying critical user
journeys.

Minimum to launch: a smoke E2E covering signup → add knowledge → embed widget →
ask a question → operator sees it in the inbox.

> **Partly resolved.** `apps/web` and `apps/widget` now have vitest configured
> and **55 tests** between them, aimed at the logic that carries real risk:
>
> - **`apps/widget` (20)** — the 362-line state machine reducer, the highest-risk
>   untested code in the repo: it decides when a streamed reply becomes a bubble,
>   when the contact form appears, and whether a conversation reads as active,
>   escalated or resolved. Covers delta accumulation, the temp-bubble upgrade
>   that stops an answer appearing twice, the contact prompt firing once and
>   never on a proactive message, status mapping, and that the in-flight map is
>   never mutated in place.
> - **`apps/web` (35)** — the role-permission mirror, the admin list query
>   builder, and the dashboard's null-vs-zero formatting. The permission suite
>   includes a **drift test** that parses the API's own `requireOrgRole` calls
>   and fails if the dashboard claims a role the API does not use — turning
>   "update it in the same change" from a comment into a check.
>
> **Still open: no end-to-end journey test.** Playwright is not installed and the
> npm registry is unreachable from this environment (§3.4), so it could not be
> added. The AI-answer leg would also need either a paid provider call or a stub,
> which is a design decision worth making deliberately rather than at the end of
> a session.

**3.4 The pre-launch security checklist is entirely unverified.** — ⚠️ **PARTLY RESOLVED**
`__specs/12-security-compliance.md:176-191` — 16 items, **all unchecked**.
The controls are implemented (§1.3 above); what is missing is the verification
pass. Several can be checked in minutes; four need real work:

- *No API keys or secrets in client bundles, verified in build output* — never
  run.
- *`pnpm audit` shows zero critical/high* — CI runs it with
  `continue-on-error: true`, so its result has never gated anything.
- *Org deletion cascades all data including the Pinecone namespace* —
  `DELETE /orgs/current` exists (`routes/org.routes.ts:72`) but I found no test
  asserting vector purge. GDPR-relevant.
- *File upload MIME validation via magic bytes* — not confirmed.

> **Partly resolved.** Four controls the checklist required and the code did not
> have are now implemented and asserted by **62 new tests**
> (`security-controls.test.ts`, `org-deletion.test.ts`, `socket-room-auth.test.ts`,
> `vector-tenancy.test.ts`). Two of them were live defects, not gaps in
> documentation:
>
> **A cross-tenant websocket leak.** `join:conversation` took the client's word
> for the id — any authenticated socket, including a widget visitor from another
> organization, could join `conversation:<anyId>` and receive that conversation's
> `message:new`, `conversation:updated` and typing events. The connection-time
> middleware authenticates the socket and scopes the rooms it joins *itself*, but
> it never vetted a room the client asked for afterwards. Joining is now an
> authorization decision: operators may join conversations in their own org,
> visitors only their own session's, refusals are silent so the handler is not an
> existence oracle, and a lookup failure fails **closed**.
>
> **Account deletion left 16 collections behind.** `DELETE /orgs/current` deleted
> 11 of 28 org-scoped collections. Surviving the "irreversible" delete were
> `KbChunk` (the full text of every knowledge document), `Connection` (encrypted
> third-party credentials), `OAuthAppConfig`, `RagTurnMetric`, `ToolCallLog`,
> `MessageFeedback`, `Payment` and nine others. The `StorageAdapter` had **no
> delete operation at all**, so §6.7's "delete S3 files" was never implementable
> and every uploaded attachment stayed on disk. Now: `deleteByPrefix` on the
> interface and both adapters, all 28 collections in the cascade, storage purged
> by the `org/<orgId>/` prefix, and a **drift test that enumerates the models
> carrying an `organizationId` and fails when one is not deleted** — because the
> failure mode is silent and the list grows with every feature.
>
> **Magic-byte upload validation** (`file-signature.ts`): uploads are checked
> against their leading bytes, not their Content-Type or filename. Deliberately
> narrow — container formats (PDF, OOXML, OLE2) are verified, text formats have
> nothing to verify and are not pretended to, and anything whose bytes say
> executable or script is refused whatever it claims to be.
>
> **Log redaction** (`config/logger.ts`): a winston formatter redacts credential
> and PII fields by **name** rather than by value shape, so an unfamiliar field
> called `apiSecret` is caught without anyone having predicted its format. Depth-
> and breadth-bounded, cycle-safe.
>
> **Still open — the dependency backlog.** `pnpm audit --prod` was run for the
> first time: **63 vulnerabilities, 3 critical and 35 high**. The critical two are
> `next-auth`/`@auth/core` (auth-existence disclosure, patched in beta.32 from the
> beta.31 in use). Directly-exposed highs include `next` (middleware bypass),
> `multer` (upload DoS), `socket.io-parser` and `ws` (memory exhaustion),
> `nodemailer`, and `xlsx` — **prototype pollution with no fix available at any
> version**, reachable from the spreadsheet upload path.
>
> I attempted the upgrades. The jumps are small (`next` 16.2.6→16.2.11,
> `next-auth` beta.31→beta.32, `multer` 2.1→2.2, plus overrides for transitives),
> but **the npm registry is unreachable from this environment** (`ECONNRESET`,
> `ENOTFOUND` fetching `next-16.2.11.tgz`), so nothing could be downloaded,
> installed or verified. The half-applied install left the tree broken; I reverted
> every version change and the overrides, restored `pnpm-lock.yaml` from `HEAD`,
> and confirmed lint, type-check and all 714 tests are green on the original
> dependency set. **The upgrade is unstarted, not half-done** — but it now has a
> measured scope.

**3.5 Pinecone tenancy diverges from the spec.** — ✅ **RESOLVED**
`__specs/12` §1.3 marks "Pinecone namespace = organizationId, no default or
fallback namespace ever" as 🔴 Critical. The code does **not** do this:

```
apps/api/src/services/kb/ingestion.service.ts:217-219
  // NOTE: per __specs/04 vectors should be upserted into the org-scoped
  // namespace. The current pinecone client stub doesn't expose a
  // `.namespace()` method — once the parallel rewrite lands we should switch…
```

Isolation today is enforced by a metadata filter, and it *is* enforced —
`search.service.ts:152` `$and`s `organizationId` and `agentId`, and
`search.service.ts:54-58` hard-refuses a query with no `agentId`. So this is
**not a live leak**. It is a weaker guarantee than the spec claims, with a
single filter between tenants instead of physical partitioning. Either implement
namespaces or amend the spec — do not ship with the two disagreeing.

> **Resolved by amending the spec and asserting the real guarantee.** §1.3 now
> describes what the code does — an AND-ed metadata filter on `organizationId`
> and `agentId`, plus a **refusal** to run a query with no `agentId` rather than
> widening it to the whole org — and records per-org namespaces as future
> hardening in `__specs/04`, with the reason they have not shipped: every
> existing vector is in the default namespace, so switching makes every indexed
> knowledge base invisible until re-embedded. That is a migration with customer
> impact and embedding cost, not a code change.
>
> `vector-tenancy.test.ts` (5 tests) asserts the outcome rather than the
> mechanism — both clauses present, an unscoped query refused before it reaches
> the store, no query ever sent unfiltered, and a store outage degrading to zero
> hits rather than to an unfiltered query. If namespaces are implemented later,
> those tests should pass unchanged.
>
> A spec claiming a stronger guarantee than the code provides is worse than one
> admitting the weaker one, because it is the document a reviewer trusts.

### P1 — required before real traffic

**3.6 `apps/admin` is not in the Docker build matrix.** — ✅ **RESOLVED**
`.github/workflows/ci.yml:170` builds `[web, widget, embed, api]`.
`apps/admin/Dockerfile` exists and `docker-compose.full.yml:136` deploys it, so
the admin portal image is **never smoke-built in CI**. It is also absent from
the `paths-filter` list.

> **Resolved.** `admin` added to both the `docker-build` matrix and the
> `paths-filter` list in `.github/workflows/ci.yml`.

**3.7 No backup or restore procedure in the runbook.**
`grep -n backup RUNBOOK.md` → no matches. `__specs/20` §7 and §10 describe
backups and disaster recovery at the design level; the operational runbook —
the document someone reads at 3am — has neither. `__specs/12` §6.5 promises
"daily automated backups with 30-day retention"; nothing implements or verifies
that.

**3.8 Load behaviour is unknown.**
This is P12 Part D and it has not been run. Specific unknowns the code raises:
background jobs are plain `setInterval` with no queue, and a reconcile tick
fires a batch of 20 `ingestSource()` calls with no guard against overlapping the
next tick; file parsing is in-memory with no documented ceiling; `topK` is fixed
regardless of KB size. None of these have a measured threshold.

**3.9 Provider cost per tenant is unbudgeted at the top line.**
Per-org budget gates exist and work (`budget-alert.service.ts`, enforced in
ingestion and telemetry sampling). What does not exist is a platform-wide view
or cap — one org cannot bankrupt itself, but the platform's own exposure across
all orgs has no ceiling.

### P2 — soon after launch

- **Decide the four disabled flags** (§2.2), using the P2 harness and the P9
  telemetry now available.
- **Run P12** to produce the pipeline audit, load-risk register and ReAct
  conformance analysis.
- **Re-verify `KB_HEALTH_GAP_SIMILARITY`** — currently 0.55, calibrated on 7
  queries from one corpus. Recorded in `__specs/04` as a starting point, not a
  tuned value.
- **Per-source retrieval scores in telemetry.** `RagTurnMetric` records one
  `topScore` per turn, so a source's mean score is exact only when it ranked
  first. A `sourceScores` array would make the P10 per-source panel exact at
  every rank.
- **`__specs/16` (MCP-driven production readiness audit)** has never been
  executed. Note it mandates three MCP tools; `chrome-devtools`, `mongo`,
  `paddle` and `pinecone` all failed to connect in this session, so that audit
  cannot currently run as written.

---

## 4. Risk register

| # | Risk | Severity | Evidence | Fix effort | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | All post-P1 work is uncommitted, in one directory | **Critical** | `git status` 140 entries vs `HEAD 5c08a39` | Minutes | **OPEN** — excluded by request |
| 2 | CI lint fails on every run | **High** | `turbo run lint` → 10/10 successful | Done | ✅ **RESOLVED** |
| 3 | Zero tests for web/widget/admin/embed; no E2E | **High** | web + widget now 55 tests; E2E still absent | Days | ⚠️ **PARTLY** |
| 3a | `auth-2fa.test.ts` clock-skew test races bcrypt | **High** | Window-slack guard; green 4/4 + every suite run | Done | ✅ **RESOLVED** |
| 4 | Security pre-launch checklist unverified | **High** | 62 new tests; 4 controls implemented | Days | ⚠️ **PARTLY** |
| 5 | Pinecone tenancy weaker than spec claims | **Medium** | Spec corrected; `vector-tenancy.test.ts` | Done | ✅ **RESOLVED** |
| 6 | Changelogs and QA records lost to `.gitignore` | **Medium** | Rules removed; docs now tracked | Done | ✅ **RESOLVED** (lost files unrecoverable) |
| 7 | Admin image never built in CI | **Medium** | Added to matrix + paths-filter | Done | ✅ **RESOLVED** |
| 8 | No backup/restore runbook | **Medium** | No `backup` in `RUNBOOK.md` | Hours | **OPEN** |
| 9 | Load thresholds unmeasured | **Medium** | P12 Part D not run | Days | **OPEN** |
| 10 | Best retrieval features default off | **Medium** | 4 flags in `config/env.ts` | Decision | **OPEN** — your call |
| 11a | 63 dependency vulns (3 critical, 35 high) | **High** | `pnpm audit --prod`; registry unreachable here | Hours | **OPEN** |
| 11b | `pnpm audit` never gates | **Low** | Kept advisory until 11a is triaged; reason documented in `ci.yml` | Minutes | **DEFERRED** |
| 12 | No platform-wide cost ceiling | **Low** | Per-org gates only | Days | **OPEN** |

---

## 5. What is left, in order

Items 2, 3a, 5, 6 and 7 from the original list are done. What remains:

1. **Commit everything.** Still the largest risk, and still untouched — 140
   uncommitted entries against `HEAD`. Excluded from this pass by request.
2. **Patch the dependency vulnerabilities** (#11a). Scope is now measured: three
   critical/high direct bumps plus overrides for transitives. Needs an
   environment with npm registry access, and `next-auth` beta.31→beta.32 and
   `nodemailer` 8→9 both deserve a deliberate test pass.
3. **Decide what to do about `xlsx`.** Prototype pollution, no fixed version at
   any release, reachable from the spreadsheet upload path. Either replace the
   parser, sandbox it, or drop Excel support.
4. **Write the smoke E2E journey** (#3), and decide whether its AI leg stubs the
   provider or spends money.
5. **Backup and restore runbook**, verified by doing a restore once (#8).
6. **Run P12** — its Part D answers the load questions (#9), its Part E gives you
   the evidence for the four disabled flags (#10).

Items 2–3 are the security work. Items 4–6 are the launch work.

---

## 7. What changed in this remediation pass

Verified after every change: `pnpm turbo run lint` 10/10, `type-check` 10/10,
`test` 5/5 — **714 tests, 0 failures**.

### Fixed

| Area | Change | Verified by |
| --- | --- | --- |
| CI lint | Rebuilt a dangling pnpm symlink (`eslint-module-utils`) | `turbo run lint` 10/10 |
| Flaky test | TOTP window-slack guard in `auth-2fa.test.ts` | 4 isolated runs + every suite run |
| Widget tests | vitest + 20 reducer tests | `@csb/widget:test` |
| Web tests | vitest + 35 tests, incl. a permissions drift test | `@csb/web:test` |
| **Websocket leak** | `join:conversation` now authorizes; fails closed | `socket-room-auth.test.ts` (9) |
| **Account deletion** | 28/28 collections + storage prefix purge | `org-deletion.test.ts` (34) |
| Upload validation | Magic-byte checking (`file-signature.ts`) | `security-controls.test.ts` (26) |
| Log redaction | Name-based winston formatter | `security-controls.test.ts` |
| Vector tenancy | Spec corrected; isolation asserted | `vector-tenancy.test.ts` (5) |
| CI coverage | `admin` added to Docker matrix + paths filter | `ci.yml` |
| Doc retention | `.gitignore` no longer discards changelogs/QA/audit | `git check-ignore` |

### Two of these were live defects

Neither was on the checklist as "unverified" — both were found by working it.

**Any authenticated socket could join any conversation room**, including a widget
visitor from another organization. Cross-tenant, in production code.

**"Delete my account" left 16 of 28 org-scoped collections behind**, including
the full text of every knowledge document and encrypted third-party credentials,
and every uploaded file — the storage adapter had no delete operation at all.
That is a GDPR erasure failure, and it reported success.

Both now have tests that derive their expectations from the code (the model list,
the socket's identity) rather than from a hand-maintained list, because both
failure modes are silent.

### Attempted and reverted

The dependency upgrade. The npm registry is unreachable from this environment,
the partial install broke the tree, and I reverted every version change and the
overrides, restored `pnpm-lock.yaml` from `HEAD`, and re-verified green. Scope is
measured and recorded in §3.4; the work is unstarted rather than half-done.

### Not attempted

The git commit (excluded by request), the E2E journey (no Playwright, no
registry), the backup runbook, P12, and the four flag decisions — which are
yours, not mine.

---

## 8. Second review pass (2026-09-04)

Ran the system rather than reading it. Four defects, three invisible to a passing
test suite.

| # | Defect | Severity | How it was found |
| --- | --- | --- | --- |
| 1 | **All logging silently disabled.** The redaction formatter rebuilt winston's `info`, dropping the symbol keys it renders from. Zero log lines, no error | **Critical** | Smoke-ran the logger |
| 2 | **Unresolved provider costs recorded as $0.00.** `recordUsage` returned its give-up zeros; telemetry wrote them; the dashboard counted the turn as priced | **High** | Drove a live turn, read the row |
| 3 | **Nightly job buffered every document's full text** (up to 1,000 sources including megabyte `extractedText`) | **Medium** | Runtime review of the query |
| 4 | **Dashboard load projected chunk text across the whole index** to preview 100 of them | **Medium** | Same |

Plus: `__specs/07` documented two endpoints (`/analytics/overview`,
`/analytics/conversations`) that have never existed and nothing calls, referenced
from three further spec files, while omitting four that do. Corrected.

### The pattern worth naming

Defects 1 and 2 were in code with **passing, correct tests**. The tests covered
the units — `redact()` is a pure function and every assertion about it was right;
`buildRagTurnMetric` shapes its document correctly. What neither covered was the
**wiring**: that the formatter still produces output through a real transport,
and that the number handed to the backfill means what the schema says it means.

Both now have tests at that seam. It is the same lesson twice, and it is the
argument for running a system end to end even when the suite is green.

### Verified after the fixes

lint 10/10 · type-check 10/10 · **718 tests, 5 packages** · build 5/5 · 21 API
endpoints · a real grounded customer turn · 6 dashboard pages · the repair
actions.

---

## 6. What I could not determine

- **Whether backups are configured on the target infrastructure.** Coolify is
  documented but I have no access to a deployed environment.
- **Whether any secrets leak into client bundles.** Requires inspecting a
  production build's output; not run.
- **Real-traffic behaviour of any kind** — latency under concurrency, largest
  survivable upload, KB size at which fixed `topK` degrades. All need a load
  test that has not been written.
- **Whether the widget and admin apps have UI defects.** The widget's state
  machine is now tested, but nothing renders a component, and the
  `chrome-devtools` MCP server failed to connect this session, so no browser
  verification was possible.
- **Whether the dependency upgrades are safe.** The registry is unreachable from
  here, so `next` 16.2.6→16.2.11 and `next-auth` beta.31→beta.32 could not be
  installed, built or tested. The version jumps are small, but "small" is not
  "verified".
- **Whether deleting `Payment` and `UsageRecord` on account deletion is correct.**
  `__specs/12` §6.7 says delete every collection, so they are deleted. If tax or
  accounting retention requires keeping financial records past erasure, that
  exception needs writing into §6.7 and carving out deliberately. Flagged in the
  code rather than decided.
