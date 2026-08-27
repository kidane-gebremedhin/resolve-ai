# Phase 20 — LangGraph / LangChain Refactor

> Spec source: [`__specs/05-ai-agent-design.md`](../__specs/05-ai-agent-design.md) ·
> Env: [`__specs/13-env-variables.md`](../__specs/13-env-variables.md)

## Goal

Replace the hand-rolled AI agent with a LangGraph `StateGraph` and LangChain primitives, without
changing a single customer-visible behaviour. The previous engine was one 1,358-line service
containing an 800-line function that owned everything at once: raw `fetch` to OpenRouter (plus a
second hand-written SSE parser for streaming), manual retry/backoff, a manual tool loop, form
generation, OTP handling, PII masking, persistence and Socket.IO broadcast. Four other services
each carried their own copy of the `fetch`/retry code.

**Non-goal:** behaviour change. Every guardrail in the old loop — the auto-form gate, the
connection fallback chain, the `book_meeting` slot/name rules, the ticket-URL strip, the
two-step resolve confirmation — is preserved, and several are now covered by tests for the
first time.

## Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Scope | Full rewrite: graph, tools, retrieval, LLM layer, side chains | Half-measures would leave two LLM-calling idioms in the codebase |
| State | Stateless per turn — **no checkpointer** | `Message` stays the single source of truth; a second store would have to be kept in sync with the inbox |
| Cutover | Temporary parallel path during the migration, then a single implementation | The old loop encoded a lot of production edge cases, so the cutover kept a one-env-var rollback until the graph proved itself. Both are gone: the graph is the only engine, and a bad deploy is rolled back by redeploying the previous image. |
| Provider | Keep OpenRouter, via `ChatOpenAICompletions` | Per-agent model selection, generation-id cost tracking and existing env vars all keep working |
| Tracing | LangSmith, off by default | Traces contain customer messages — opt-in only |

## Steps

1. **Dependencies** — add `@langchain/core`, `@langchain/openai`, `@langchain/langgraph`,
   `langchain` to `@csb/api`.
2. **Config** — `AI_LLM_MAX_RETRIES`, `AI_MAX_TOOL_TURNS`, `LANGSMITH_*` in `config/env.ts` and
   `.env.example`.
3. **Shared helpers** — extract forms, attachments, sanitisation and conversation controls out of
   the legacy service into `services/ai/shared/`, and have the legacy engine import them, so the
   rollback path cannot drift.
4. **LLM layer** — `createChatModel()` as the single factory; `initLangSmithTracing()` at startup.
   Use `ChatOpenAICompletions`, **not** `ChatOpenAI` (see the spec's provider note).
5. **Retrieval** — `KbEmbeddings` (LangChain `Embeddings`) and `KnowledgeBaseRetriever`
   (`BaseRetriever`), both wrapping the existing services so batching, metering and tenancy
   scoping stay in one place.
6. **Tools** — built-in and integration tools as `StructuredTool`s with
   `responseFormat: "content_and_artifact"`; the connection-chain reconciliation in
   `registry.ts`; the input-completeness decision in `input-gate.ts`.
7. **Graph** — `state.ts` channels + reducers, `agent`/`tools`/`finalize` nodes, conditional
   routing, compiled once as a singleton.
8. **Runner** — `streamEvents({version: "v2"})` filtered on the `final_reply` tag → Socket.IO
   `message:delta`; lazy placeholder creation; controls enforcement; persistence; usage recording.
9. **Side chains** — port draft polish, reply suggestions and ticket-transcript scoping to LCEL,
   deleting their duplicate `fetch` implementations.
10. **Facade** — `services/ai/index.ts` exports `generateAiReply`, which calls the graph directly;
    repoint all call sites at it so nothing imports the graph internals.
11. **Tests** — graph routing and tool-node behaviour against a scripted chat model; unit tests
    for the input gate and conversation controls.

## Acceptance

- [x] `pnpm --filter @csb/api type-check` clean.
- [x] Graph tests cover: no-tool answer, tool→loop→finalize, form collection, halt-on-OTP,
      KB-hit propagation, unknown tool, tool-turn ceiling, present-only mode, agent failure,
      meta-pass passthrough.
- [x] Input-gate tests cover: built-in passthrough, server-injected fields, missing field,
      placeholder value, webhook full-schema form, slot steering, placeholder attendee name.
- [x] Conversation-control tests cover: escalation gating both ways, two-step resolve.
- [x] No regression in the pre-existing suite (the two `402` failures in `widget.test.ts` /
      `rls.test.ts` reproduce identically at `HEAD` — a pre-existing budget/plan-gate issue,
      unrelated to this phase).
- [x] LangSmith tracing verified with real credentials (root `customer_reply` run, org/agent
      tags, conversation id in metadata, 23 child runs, 0 errors).
- [x] Production soak, then delete the old engine and the temporary rollback flag.
      *(Done — see CHANGELOG_14.md.)*
- [ ] Backfill `UsageRecord`s written with `costUsd: 0` before the `/generation` retry fix.

## Rollback

Redeploy the previous API image, as for any other part of the API. No data migration is involved:
the graph writes the same `Message`, `ToolCallLog`, `KnowledgeGap` and `UsageRecord` documents the
old engine did, so rolling the code back does not strand anything already written.

## Follow-ups

- Backfill historical `UsageRecord` costs (see [`QA_TEST_RESULTS_1.md`](../QA_TEST_RESULTS_1.md) §17).
- The repo has **no ESLint config** (`eslint.config.js` is absent), so `pnpm lint` fails at
  every workspace. Pre-existing, out of scope here, worth its own task.
