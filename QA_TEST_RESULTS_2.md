# QA test results 2: review-and-fix pass

Covers the four fixes in `CHANGELOG_2.md`. Every external API call is stubbed;
the one live exercise below was constructed so that no LLM call could occur.

**Environment:** local API on port 4000 against the dev MongoDB
(`customer-support`), Node 24.13.1, `mongodb-memory-server` for the suites.

**Blocked:** the `chrome-devtools` MCP server failed to connect again this
session (`CONNECT_TIMEOUT` after 30s), so the browser-rendering check of the RAG
Quality panel's new truncation notice could not be run. It is verified by unit
test and by reading the rendered branch, not visually. Also still blocked from
earlier sessions and unchanged here: the OpenRouter balance is exhausted (402s),
so no eval or judge run is possible.

---

## 1. Socket authorization (fix 1): automated and live

### Automated

`apps/api/src/__tests__/socket-message-auth.test.ts`, 12 cases, run against a
real Mongo instance.

To confirm the tests actually characterize the bug rather than the fix, the two
changed handlers were reverted to `HEAD` (`git stash push`) and the suite re-run:

```
× message:send > refuses another visitor in the same organization
× message:send > does not trigger a billable AI reply for a foreign conversation
× customer:typing > refuses another visitor's conversation in the same organization
× customer:typing > looks the conversation up once no matter how many keystrokes arrive
× legacy typing:start relay > refuses a socket that never joined the room
  Tests  5 failed | 7 passed (12)
```

With the fix in place: `Tests 12 passed (12)`.

The seven that passed both ways are the positive controls (the owner can still
post, an operator can still reply, a visitor can still mint a first
conversation), which is what keeps the fix from being "deny everything".

### Live, against the running app

The unit tests drive the handlers directly. This exercise drove the **whole
stack**: real HTTP session minting, real websocket handshake, real auth
middleware, real handlers, real database.

Setup: two widget sessions minted through `POST /api/v1/widget/sessions` for the
same agent, so both visitors share an `organizationId` and a `websiteId`. One
conversation, owned by visitor A. Its status was set to `resolved` **on purpose**:
`message.handler` only calls `generateAiReply` for an `active` conversation, so
the positive control writes a message with **zero LLM spend**.

| Step | Expected | Observed |
| --- | --- | --- |
| A emits `message:send` into A's own conversation | message persisted | persisted, `role: customer`, `senderId` = A's session |
| B emits `message:send` into A's conversation | nothing persisted | nothing persisted (`total=1`, the owner's) |
| B emits `join:conversation` on A's conversation | silently refused, logged | `[socket] refused conversation join` |
| B emits `customer:typing` / `typing:start` | no broadcast | **not directly observable in this run**: no operator socket was connected to receive one, and these two refusals are not logged. Covered by unit test instead |
| Any LLM call | none | none: the only `[ai]` line in the log is the LangSmith startup notice |

API log during the run:

```
{"conversationId":"6a9b7d19…","kind":"contact","level":"warn",
 "message":"[socket] refused message:send","organizationId":"6a908562…"}
{"conversationId":"6a9b7d19…","kind":"contact","level":"warn",
 "message":"[socket] refused conversation join","organizationId":"6a908562…"}
```

Final message count on the conversation: **1** (the owner's). Before the fix this
would have been 2, the second one attributed to the victim's thread and followed
by a billable AI turn.

All rows created for this exercise (1 conversation, 3 contact sessions, 1
message) were deleted afterwards; the dev database is back to its starting 71
conversations.

---

## 2. Background job latch (fix 2)

`apps/api/src/__tests__/serial-loop.test.ts`, 6 cases, `Tests 6 passed (6)`:

| Case | What it pins |
| --- | --- |
| runs the tick when idle | the latch does not break the normal path |
| drops ticks that arrive while a run is in flight | three timer ticks produce one run, `skipped == 2` |
| accepts the next tick once the run finishes | the latch is not a one-shot |
| releases the latch when a tick rejects | a crashed run cannot wedge the loop forever |
| releases the latch when a tick throws synchronously | same, for the non-promise path |
| reports an overrun | the `[jobs] tick overran its interval` warning fires |

**Live boot check.** The API was started with the rewired scheduler and ran for
64 seconds:

```
{"firecrawlIntervalMs":30000,"level":"info","message":"[jobs] scheduling background jobs",
 "reconcileIntervalMs":60000,"startupDelayMs":5000}
{"level":"info","message":"[api] listening on port 4000"}
```

All four loops scheduled and ticked through `serialLoop` with no errors. No
`tick skipped` line appeared, which is the correct result on an idle dev
database: there was no work slow enough to overlap. The skip path itself is
covered by the unit tests above, where the overlap can be forced deterministically.

---

## 3. Index-health truncation reporting (fix 3)

Two cases added to `apps/api/src/__tests__/index-health.test.ts`; the file passes
at `Tests 40 passed (40)`.

| Case | Result |
| --- | --- |
| reports a complete scan as complete | `truncated === false`, `scanLimit === CHUNK_SCAN_LIMIT` |
| says so when the index is larger than one scan | `truncated === true`, and `totals.chunks === CHUNK_SCAN_LIMIT` (the +1 probe row does not leak into the count) |

The oversize case fakes only the index-scan query. `withPreviews` issues its own
`KbChunk.find` for the flagged rows and continues to hit the real collection, so
the test does not accidentally verify a fully mocked code path.

Not verified in a browser (see the blocked note at the top): the panel's
truncation notice is confirmed by reading the rendered branch and by the
`totals.truncated` contract the test pins, not visually.

---

## 4. Corrected comments (fix 4)

No behaviour change, so nothing to test dynamically. Verified by search that the
claim is gone and that the description now matches the code:

- `grep -rn "confidenceThreshold" apps/api/src` confirms the only runtime
  consumers are `finalize.node.ts` (which lowers the value) and
  `rag-telemetry.service.ts:188` (which sets `flags.lowConfidence`).
- `runner.ts:442` shows escalation gated solely on `action === "escalate"`.

The existing suite covering the uncited-ratio path continues to pass, which is
the point: the code was not touched, only its description.

---

## 5. Flaky test closed

`socket-room-auth.test.ts` > "lets a visitor join their own conversation" failed
roughly one run in three under `turbo run test` (all four packages in parallel),
while passing every time when the API suite ran alone. The cause was a fixed
20ms sleep standing in for a Mongo round trip, not a product defect.

After changing the helper to poll for the outcome:

```
turbo run test --force --filter=@csb/api   (x3)
Tests  599 passed (599)
Tests  599 passed (599)
Tests  599 passed (599)
```

## Full run

```
@csb/widget:test:    Tests  20 passed (20)
@csb/web:test:       Tests  35 passed (35)
@csb/api:test:       Tests  599 passed (599)   (was 579)
@csb/rag-eval:test:  Tests  84 passed (84)

turbo run test type-check lint  →  Tasks: 14 successful, 14 total
type-check: 0 errors
lint:       0 errors (warnings pre-existing and unchanged)
```

## Cost

$0.00. No LLM, embedding, Pinecone, Firecrawl or Paddle call was made. The suites
stub every external call through `apps/api/src/test/no-external-calls.ts`, and the
live exercise in §1 was built on a non-active conversation specifically so the AI
path could not be reached.
