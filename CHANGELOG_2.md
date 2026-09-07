# Changelog 2: codebase review and fixes

A review pass, the fixes it produced, and the documentation updates that keep
them from being undone by a regeneration from specs. No new environment
variables were introduced, so `.env.example` and `__specs/13-env-variables.md`
are unchanged.

Four defects, in descending order of severity.

---

## 1. Socket events trusted a client-supplied conversation id

**Severity: high (cross-visitor write, plus unmetered AI spend).**

`join:conversation` was hardened in the previous session, but its siblings were
not. `message:send` and `customer:typing` checked only the caller's
`organizationId`.

That is not a sufficient check, because **same tenant is not the same person**.
Two visitors on one customer's website share an `organizationId`. So one visitor,
with a legitimate widget session, could send `message:send` with another
visitor's `conversationId` and:

- write a message into that conversation, stored with `role: "customer"` and
  attributed to the victim's thread, and
- trigger `generateAiReply` on it, which is a real, billable LLM turn on someone
  else's conversation.

`customer:typing` had the same hole, one severity tier down: it broadcast the
attacker's chosen `conversationId` into the org room, putting a false "customer
is typing" indicator on another visitor's chat in the operator inbox.

The legacy `typing:start` / `typing:stop` relays were a third variant.
`socket.to(room)` broadcasts into a room **whether or not the sender is a member**,
so any authenticated socket, from any tenant, could inject typing events into any
conversation room. Their own comment already assumed the sender had joined the
room; nothing checked it.

### The fix

One rule, in a new module, used by all three handlers:

- `apps/api/src/socket/authorize.ts`, providing `isConversationVisibleTo(auth, conversation)`
  (a pure predicate for callers that already loaded the document) and
  `mayAccessConversation(socket, conversationId)` (the lookup form). Operators may
  act on any conversation in their own organization; contacts only on
  conversations belonging to their own session.
- `message.handler.ts` now applies the predicate to the conversation it already
  loaded, and logs a refusal.
- `typing.handler.ts` gates `customer:typing` on the same rule, and the legacy
  relays on actual room membership.
- `conversation.handler.ts` now calls the shared rule instead of its own copy.

Three copies of an authorization check is three chances to drift, which is
exactly what had happened. Now there is one.

Decisions are memoized per socket, because `customer:typing` fires on every
keystroke and a Mongo round trip per keystroke is a load test rather than a
typing indicator. Both inputs are immutable for a connection's lifetime: the
socket's identity is fixed at handshake and a conversation never changes owner.
Non-existence is deliberately **not** cached, since the socket may be about to
create that very conversation.

**Verification:** `socket-message-auth.test.ts` (12 tests). Five of them fail
against the previous code and pass against the fix. Also verified live against a
running API and the dev database, with two real widget sessions over real
websockets: see `QA_TEST_RESULTS_2.md` §1.

---

## 2. Background job loops could run on top of themselves

**Severity: medium (duplicated embedding spend).**

Four loops run on plain `setInterval` timers: embedding reconciliation (60s),
Firecrawl polling (30s), the RAG quality alert sweep, and index health. Each tick
started an async run and returned immediately, so the timer never waited for it.

None of these jobs claim their work atomically. `reconcileOnce` selects up to 20
sources by `embeddingStatus`, and that status does not change until the ingest
finishes. So a run that outlasted its interval overlapped itself, and both runs
selected the **same** sources and embedded them twice. That is a duplicated
provider bill and a duplicated write, not a race that resolves itself. One source
slower than 60s is enough to trigger it, which a large PDF can manage alone.

### The fix

`apps/api/src/jobs/serial-loop.ts` wraps each loop and drops a tick whose
predecessor is still running. Skipping is safe because every one of these loops
is a sweep, not a queue consumer: whatever it passes over is still there next
tick.

Skips and overruns are logged (`[jobs] tick skipped`, `[jobs] tick overran its
interval`) because a loop that quietly never keeps up is indistinguishable from a
loop with nothing to do. The latch releases on rejection **and** on a synchronous
throw, since a stuck latch would silently stop the loop forever, which is worse
than the overlap it prevents.

**Scope, stated plainly:** this is an in-process latch, not a distributed lock.
Running more than one API replica still runs every loop more than once. That was
already documented in `RUNBOOK.md` §10.3 and the note there now says so explicitly.

**Verification:** `serial-loop.test.ts` (6 tests).

---

## 3. The index-health scan silently reported partial counts as complete

**Severity: medium (wrong number presented as authoritative).**

`scoreChunks` capped its chunk scan at 20,000 with `.limit(20000)` and reported
the result as `totals.chunks`. An organization with 25,000 chunks was told it had
exactly 20,000, with a dead-weight count computed from an arbitrary subset, and
nothing anywhere marked either number as partial. The operator-facing
`kb_weak_chunks` notification quoted the same truncated figures.

The cap itself is justified: dead weight is defined by the *absence* of telemetry,
so the scan has to list every chunk and therefore needs a ceiling on a dashboard
request. The defect was the silence.

### The fix

The scan now reads one row past `CHUNK_SCAN_LIMIT` (exported, was a bare literal)
to detect the overflow, trims the probe row, and reports `totals.truncated` and
`totals.scanLimit`. The RAG Quality panel renders a note when truncated, the
`kb_weak_chunks` notification appends the same caveat, and the API logs
`[index-health] chunk scan truncated`.

Repairs are unaffected: they act on the passages actually listed.

A full-index aggregation remains the real fix and is still recorded as S9 in
`__specs/38-scale-and-load-risks.md`, now marked partially fixed.

**Verification:** two new cases in `index-health.test.ts`.

---

## 4. Two comments described an escalation path that does not exist

**Severity: low as code, high as documentation.**

`finalize.node.ts` lowers a turn's confidence when too much of the answer is
uncited, and its comment said this let "the EXISTING `AI_CONFIDENCE_THRESHOLD`
escalation" catch the turn. `config/env.ts` said the same thing, and so did
`__specs/37` and `__specs/08`.

There is no such escalation. The only consumer of `AI_CONFIDENCE_THRESHOLD` at
runtime is `rag-telemetry.service.ts`, which sets the turn's `lowConfidence`
flag. Escalation comes solely from the meta pass returning `action: "escalate"`.
So the P6 uncited-ratio path is a signal, not a control: it surfaces the turn on
the RAG Quality dashboard and in the alert sweep, and changes nothing about the
answer the customer receives.

### The fix

The comments and the specs now describe what the code does. **The behaviour is
deliberately unchanged.**

> **Proceeded under assumption.** Wiring low confidence to an automatic handoff
> is a product behaviour change, not a comment fix, and it is the kind that
> misfires expensively: every false positive pulls a human into a conversation
> the AI was answering correctly. The documented behaviour in `E2E_FLOW.md` and
> `__specs/05` is telemetry-only, so telemetry-only is what the code now honestly
> claims. Making it a real control needs a false-positive rate measured against
> real traffic first, which needs the faithfulness sampling that has never been
> funded (risk 2 in `__specs/37`). Recorded as A20 in
> `__specs/45-deferred-decisions.md`, still open.

---

## Also fixed: a flaky security test

`socket-room-auth.test.ts` failed intermittently on
"lets a visitor join their own conversation" when the packages ran in parallel
under turbo. Not a product bug and not caused by these changes, but a security
test that fails at random gets muted, so it was worth closing.

Cause: `join:conversation` is a synchronous handler wrapping a fire-and-forget
async authorization check, so there is no promise for the test to await. The
helper slept a fixed 20ms, which is not always enough for the Mongo round trip
when four suites compete for the machine.

The helper now polls for the outcome (`vi.waitFor`) in the cases that expect a
room to be joined, and keeps a fixed but longer window for refusals, where there
is no effect to poll for and a longer wait only strengthens the assertion.
Confirmed with three consecutive full API runs: 599 passed each time.

## Documentation updated

| File | Change |
| --- | --- |
| `E2E_FLOW.md` | New "Who may drive a turn" subsection in §2 (socket authorization); job-overlap note in §1; §4 callout rewritten now that the comments are corrected and the cross-reference corrected to point at the right spec entry |
| `RUNBOOK.md` | New §11.1b on the background loops, their two log lines and how to read them; new troubleshooting entry for socket refusals; scan-cap caveat in the index-health flags section; §10.3 replica warning now states that the new latch is not a distributed lock |
| `__specs/08-socketio-design.md` | New "Per-Event Authorization" section (the rule, why it is per-conversation rather than per-tenant, and the three properties the implementation must keep); removed the false `low_confidence` auto-escalation claim from the events table |
| `__specs/37-rag-pipeline-audit.md` | Generation-stage bullet corrected from "control" to "signal" |
| `__specs/38-scale-and-load-risks.md` | Risk table gains a Status column; S1 and S2 marked fixed, S9 partially fixed |
| `__specs/45-deferred-decisions.md` | A20 and A22 gain a Status column entry |

## Test counts

| Package | Before | After |
| --- | --- | --- |
| `@csb/api` | 579 | 599 |
| `@csb/web` | 35 | 35 |
| `@csb/widget` | 20 | 20 |
| `@csb/rag-eval` | 84 | 84 |

`turbo run test type-check lint` is green: 0 type errors, 0 lint errors
(pre-existing warnings unchanged).
