# End-to-End RAG Flow

How a visitor's message becomes a knowledge-grounded answer, as the code stands
today. Knowledge is keyed by **(organizationId, agentId)**: each agent maps to one
website and only ever sees its own knowledge base.

---

## 1. Ingestion

Entry `kb.routes.ts:89` (text), `:113` (upload), `:164` (website).
Pipeline `ingestion.service.ts:74`. Crawl completion `firecrawl.service.ts:85`.

```mermaid
flowchart TD
  U1["POST /knowledge/text<br/><code>kb.routes.ts:89</code>"] --> H
  U2["POST /knowledge/upload<br/><code>kb.routes.ts:113</code>"] --> SIG
  U3["POST /knowledge/website<br/><code>kb.routes.ts:164</code>"] --> CRAWL

  SIG["Magic-byte check<br/><code>file-signature.ts</code>"] -->|bytes disagree| REJ["400 rejected"]
  SIG -->|ok| PARSE["Parse<br/><code>parsers.ts:106</code>"]
  PARSE --> H["SHA-256 content hash<br/>unique on (agentId, contentHash)"]

  CRAWL["startCrawl → Firecrawl<br/><code>firecrawl.service.ts</code>"] --> POLL["Poll job, 30s<br/><code>firecrawl-ingest.job.ts</code>"]
  POLL --> H

  H --> ING["ingestSource()<br/><code>ingestion.service.ts:74</code>"]
  ING --> BUD{"Org over AI budget?<br/><code>:186</code>"}
  BUD -->|yes| ERRB["status=error<br/>'budget reached, paused'"]
  BUD -->|no| CH["chunkText 1200/150<br/><code>chunker.ts:39</code>"]
  CH --> EMPTY{"chunks == 0?"}
  EMPTY -->|yes| STE["status=empty<br/>(permanent, not retried)"]
  EMPTY -->|no| EMB["embed, batches of 96<br/><code>embedding.service.ts</code>"]
  EMB -->|provider error| ERRE["status=error + errorCode<br/><code>ingestion-errors.ts</code>"]
  EMB --> UP["Pinecone upsert<br/>id = sourceId:chunkIndex"]
  UP --> STALE["Delete only ids the new<br/>chunking no longer produces<br/><code>:256</code>"]
  STALE --> MIR["Mirror to KbChunk (P4)<br/>lexical leg + untruncated text"]
  MIR --> OK["status=synced"]

  ING -.->|every stage| EV["IngestionEvent (P8)<br/>one runId per attempt"]

  ERRE --> RECON["Reconcile job, 60s<br/><code>embedding-reconcile.job.ts</code><br/>BATCH=20, bounded retries"]
  RECON --> ING
  PROC["status=processing<br/>past KB_INGEST_STUCK_PROCESSING_MS"] --> RECON
```

**Ticks cannot overlap.** All four background loops are wrapped in `serialLoop`
(`jobs/serial-loop.ts`), which drops a tick whose predecessor is still running.
This matters because none of these jobs claim their work atomically: the
reconcile pass selects up to 20 sources by `embeddingStatus`, and that status
does not change until the ingest finishes. Before the latch, one source slower
than the 60s interval was enough for two ticks to select the *same* sources and
embed them twice, which is a duplicated provider bill rather than a race that
settles itself. Skipping is safe because each loop is a sweep, not a queue
consumer: whatever it passes over is still there next tick. Skips and overruns
are logged (`[jobs] tick skipped`, `[jobs] tick overran its interval`), because a
loop that never keeps up otherwise looks identical to one with nothing to do.

**`embeddingStatus` transitions:** `pending → processing → {synced | empty | error}`,
plus `deleting`. `empty` is deliberately its own state and is **not** retried: a
scanned PDF with no text layer produces a scanned PDF with no text layer.

## 2. Customer message flow

Entry `widget.routes.ts:888` → `generateAiReply` (re-exported from
`services/ai/index.ts`; the implementation is `graph/runner.ts`). Fire-and-forget,
so the POST returns in ~90ms while the turn runs on.

```mermaid
flowchart TD
  W["Widget POST /messages<br/><code>widget.routes.ts:888</code>"] --> SAVE["Persist customer Message"]
  SAVE --> RUN["generateAiReplyWithGraph<br/><code>graph/runner.ts</code>"]
  RUN --> CTX["Load agent, org, history,<br/>build tool registry + system prompt"]
  CTX --> START(["START"])

  START --> RS{"presentToolResult?<br/><code>agent.graph.ts:51</code>"}
  RS -->|yes, form/OTP already ran| FIN
  RS -->|no| AG["agent node<br/><code>agent.node.ts</code><br/>model + bound tools"]

  AG --> RA{"routeFromAgent<br/><code>agent.graph.ts:24</code>"}
  RA -->|no tool calls| FIN
  RA -->|halt latched| FIN
  RA -->|toolTurns >= maxToolTurns| FIN
  RA -->|tool calls| TL["tools node<br/><code>tools.node.ts</code>"]

  TL --> RT{"routeFromTools<br/><code>:41</code>"}
  RT -->|halt| FIN
  RT -->|else| AG

  FIN["finalize node<br/><code>finalize.node.ts</code>"] --> TWO["Two calls, concurrent :180<br/>• streamed prose reply<br/>• structured meta pass"]
  TWO --> VAL["Context block + verbatim assert<br/>+ citation validation"]
  VAL --> PERSIST["Persist AI Message,<br/>emit message:done / message:new"]
  PERSIST --> TEL["recordRagTurn (fire-and-forget)<br/><code>runner.ts:26</code>"]
  PERSIST --> USG["recordConversationUsage<br/><code>runner.ts:403</code>"]
  USG -.->|resolved cost| TEL
```

**The `halt` latch** is set by a tool that hands control to the customer (an
inline form or an OTP challenge). It latches on: once something awaits the
visitor, no further tool may run this turn, or the model would claim an action
that has not happened.

**The ceiling** is `AI_MAX_TOOL_TURNS` (default 10), checked at
`agent.graph.ts:30`. Each agent↔tool round trip costs two graph steps, and the
runner sets `recursionLimit = maxToolTurns * 2 + 10`.

**Who may drive a turn.** Every conversation-scoped socket event carries a
client-supplied `conversationId`, and that id is attacker-controlled. One rule
decides them all, in `socket/authorize.ts`: an operator may act on any
conversation in their own organization, a contact only on conversations
belonging to their own session. The handshake middleware (`socket/auth.ts`)
establishes *who* a socket is and cannot vet the ids that follow, so the check
has to live here.

This is per-conversation, not per-tenant, because same tenant is not the same
person: two visitors on one customer's website share an `organizationId`. An
org-only check let one of them post into the other's chat through `message:send`
(writing a message attributed to that visitor *and* triggering a billable AI
reply on their thread) and put a false typing indicator on it. Decisions are
memoized per socket, since `customer:typing` fires on every keystroke. The
legacy `typing:start` / `typing:stop` relays require the sender to have joined
the room, because `socket.to(room)` broadcasts whether or not the sender is a
member. Covered by `socket-room-auth.test.ts` and `socket-message-auth.test.ts`.

## 3. Retrieval, expanded

`understoodSearch()` (`understood-search.ts:50`) when P3/P5/P7 flags are on;
`searchKb()` (`search.service.ts:34`) always. **Every leg is tenancy-filtered.**

```mermaid
flowchart TD
  Q["search_kb tool call<br/><code>builtin.tools.ts</code>"] --> RW{"AI_QUERY_REWRITE_ENABLED?<br/>default OFF"}
  RW -->|off| RAW["rawPlan: the model's own query"]
  RW -->|on| REW["rewriteQuery + paraphrases<br/><code>query-rewrite.ts</code>"]
  RAW --> GUARD
  REW --> GUARD

  GUARD{"agentId present?<br/><code>search.service.ts:57</code>"} -->|no| REFUSE["REFUSED, returns []<br/>never widened to the org"]
  GUARD -->|yes| LEGS

  LEGS --> DENSE["Dense: embed + Pinecone<br/><code>search.service.ts:131</code><br/>filter: org AND agent"]
  LEGS --> LEX["Lexical: Mongo $text<br/><code>lexical-search.service.ts</code><br/>filter: org AND agent"]

  DENSE --> FUSE["RRF on rank<br/><code>fusion.ts</code>"]
  LEX --> FUSE
  FUSE --> WIDEN{"0 hits and rerank OFF?"}
  WIDEN -->|yes| RETRY["Retry with minScore 0<br/><code>kb-retriever.ts</code>"]
  WIDEN -->|no| RR
  RETRY --> RR

  RR{"KB_RERANK_ENABLED?<br/>default OFF"} -->|on| RERANK["Cross-encoder rerank<br/><code>rerank.ts</code><br/>floor on BEST candidate"]
  RR -->|off| HYD
  RERANK --> HYD["Hydrate text from KbChunk<br/><code>search.service.ts:110</code>"]

  HYD --> CONF{"KB_CONFLICT_DETECTION_ENABLED?<br/>default OFF"}
  CONF -->|on, top-2 scores close| CHK["checkForConflict<br/><code>conflict.ts</code>"]
  CONF -->|off| CB
  CHK --> CB["Numbered context block<br/><code>context-block.ts</code><br/>assertVerbatim"]
  CB --> CITE["Reply must cite markers;<br/>invalid markers stripped<br/><code>citation-validator.ts</code>"]

  NS["Per-org Pinecone namespaces"] -.-> DENSE
  style NS stroke-dasharray: 5 5
```

`NS` is dashed: `__specs/12` once claimed per-org namespaces as a critical
control. They are not implemented; isolation is the AND-ed metadata filter plus
the refusal above. See `__specs/04` "Vector-store tenancy".

## 4. Escalation and handoff

```mermaid
flowchart TD
  META["Meta pass returns<br/>confidence + action<br/><code>finalize.node.ts:79</code>"] --> UNC{"uncitedRatio ><br/>AI_MAX_UNCITED_RATIO?<br/><code>:243</code>"}
  UNC -->|yes| LOWER["confidence lowered below<br/>AI_CONFIDENCE_THRESHOLD"]
  UNC -->|no| ACT
  LOWER --> ACT{"action"}

  LOWER -.->|intended by the code comment| AUTOESC["Auto-escalate on<br/>low confidence"]
  style AUTOESC stroke-dasharray: 5 5

  ACT -->|escalate| CTRL{"allowHumanEscalation?<br/><code>controls.ts:51</code>"}
  ACT -->|resolve| RESCONF{"requireResolveConfirmation?"}
  ACT -->|reply| SEND["Send reply"]

  CTRL -->|off| DOWNGRADE["Downgraded to reply<br/>(org disabled handoff)"]
  CTRL -->|on| ESC["conversation.status = escalated<br/><code>runner.ts:442</code>"]
  RESCONF -->|first ask| PEND["pendingResolveConfirmation"]
  RESCONF -->|confirmed| RES["status = resolved"]

  ESC --> OPS["Operator inbox<br/>socket: conversation:updated"]
  OPS --> TAKE["Operator takeover<br/><code>message.routes.ts</code>"]

  NOHIT["Retrieval found nothing"] --> GAP["KnowledgeGap kind='gap'<br/><code>builtin.tools.ts</code>"]
  CHK2["Sources contradict"] --> CONFREC["KnowledgeGap kind='conflict'<br/><code>conflict.ts</code>"]
  LOWFLAG["confidence < threshold"] --> FLAG["RagTurnMetric flags.lowConfidence<br/><code>rag-telemetry.service.ts:188</code>"]
```

> **`AUTOESC` is dashed: low confidence does not escalate.** Nothing in
> `controls.ts` or `runner.ts` routes on confidence. The only escalation is the
> model choosing `action: "escalate"`, plus the runner's fallback when the graph
> produces nothing (`runner.ts:137`). The P6 uncited-ratio path is therefore a
> *signal*, not a control: it sets `flags.lowConfidence`
> (`rag-telemetry.service.ts:188`) and surfaces on the RAG Quality dashboard and
> in the alert sweep, and changes nothing about the turn the customer sees.
>
> The code used to claim otherwise. Comments in `finalize.node.ts` and
> `config/env.ts` both said the drop let "the EXISTING `AI_CONFIDENCE_THRESHOLD`
> escalation" catch the turn, and both have been corrected to describe what the
> code does. The *behaviour* is unchanged and deliberately so: routing low
> confidence to a human is a product decision, not a comment fix. It stays open
> as A20 in `__specs/45-deferred-decisions.md`, and the generation-stage note in
> `__specs/37-rag-pipeline-audit.md` describes the same thing.

## 5. One turn, with measured latency

Measured from **4** `RagTurnMetric` rows in the development database. Four
samples is a range, not a distribution: the p50 is a midpoint and there is **no
meaningful p95**. Cost is from 1,516 `UsageRecord` rows and is a real sample.

```mermaid
sequenceDiagram
  participant V as Visitor
  participant API as widget.routes.ts
  participant G as LangGraph runner
  participant KB as searchKb
  participant PC as Pinecone
  participant MG as Mongo
  participant LLM as OpenRouter

  V->>API: POST /messages
  API->>MG: persist customer message
  API-->>V: 201 (measured ~90ms)
  Note over API,G: reply runs fire-and-forget

  G->>LLM: agent step (bind tools)
  Note right of LLM: failure -> log, skip to finalize<br/>customer still answered

  G->>KB: search_kb
  par tenancy-filtered legs
    KB->>PC: dense query (org AND agent)
    KB->>MG: $text lexical (org AND agent)
  end
  Note right of KB: measured retrieval 0 / 3.9s / 10.0s / 17.0s<br/>outage -> zero hits, reply proceeds ungrounded
  KB->>MG: hydrate passage text from KbChunk

  G->>LLM: finalize, two concurrent calls
  Note right of LLM: measured 1.9 / 2.3 / 2.6 / 4.2s<br/>meta-pass failure -> confidence 0.5, action reply<br/>(observed live on a 402)

  G->>MG: persist AI message
  G-->>V: message:done, message:new
  G->>MG: RagTurnMetric (fire-and-forget)
  G->>LLM: /generation cost lookup
  Note right of LLM: 404s until the record lands.<br/>Gives up on 0.13% of rows -> cost recorded as NULL, not 0
```

**Turn wall time, all four samples:** 7.9s, 10.9s, 21.3s, 31.5s.
**Cost per answered turn:** $0.0158 (=$0.9978 over 63 turns).

---

## Config

Per-agent `model` / `temperature` override the env defaults at call time
(`runner.ts`). `AI_CONFIDENCE_THRESHOLD` is **telemetry and dashboard only** —
see the note under diagram 4. Pinecone upserts batch at 100 and deletes at 1000
(`config/pinecone.ts:101-102`).

## Related

- [`__specs/37-rag-pipeline-audit.md`](__specs/37-rag-pipeline-audit.md) — stage audit, failure modes, measured numbers
- [`__specs/38-scale-and-load-risks.md`](__specs/38-scale-and-load-risks.md) — what breaks under load
- [`__specs/05-ai-agent-design.md`](__specs/05-ai-agent-design.md) — graph design and ReAct conformance
- [`__specs/04-pinecone-firecrawl.md`](__specs/04-pinecone-firecrawl.md) — vector store, crawl, index health
- [`__specs/39-rag-evaluation.md`](__specs/39-rag-evaluation.md) — offline harness and online telemetry
