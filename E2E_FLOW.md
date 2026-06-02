# End-to-End RAG Flow

How a visitor's message becomes a knowledge-grounded answer. Three phases —
**indexing**, **retrieval**, **generation** — plus the config that ties them
together. Knowledge is keyed by **(organizationId, agentId)**: each agent maps to
exactly one website and only ever sees its own knowledge base.

---

## 1. Indexing — knowledge → vectors

Adding knowledge (raw text, file upload, or website crawl) runs a common
pipeline: **parse → chunk → embed → upsert**.

| Step | Where | What |
|------|-------|------|
| Entry | [`kb.routes.ts`](apps/api/src/routes/kb.routes.ts) | `POST /knowledge/text`, `/knowledge/upload`, `/knowledge/website`. Each creates a `KnowledgeSource` (status `pending`/`processing`) and dedupes on a SHA-256 content hash. |
| Parse | [`parsers.ts`](apps/api/src/services/kb/parsers.ts) | PDF (`pdf-parse`), DOCX (`mammoth`), Excel/CSV (`xlsx`), HTML (tag strip), plain/markdown. Website crawls arrive as markdown from Firecrawl. |
| Chunk | [`chunker.ts`](apps/api/src/utils/chunker.ts) | `chunkText(text, 1200, 150)` — ~1200-char chunks, 150-char overlap, prefers paragraph/sentence boundaries. |
| Embed | [`embedding.service.ts`](apps/api/src/services/ai/embedding.service.ts) | OpenAI-compatible `POST /embeddings` (`EMBEDDING_MODEL`, default `text-embedding-3-small`, 1536 dims). Batched 96 at a time, retry + backoff. Falls back to a deterministic pseudo-embed outside production when no key is set. |
| Upsert | [`ingestion.service.ts`](apps/api/src/services/kb/ingestion.service.ts) (text/file) · [`firecrawl.service.ts`](apps/api/src/services/kb/firecrawl.service.ts) (crawl) | Vectors written to Pinecone. Stale ids from a prior run are deleted after the new upsert. |

**Vector id:** `{sourceId}:{chunkIndex}`

**Vector metadata (both ingestion paths, identical):**

```json
{
  "organizationId": "…",
  "agentId": "…",          // REQUIRED — retrieval filters on this
  "sourceId": "…",
  "chunkIndex": 5,
  "text": "the chunk text (capped at 8000 chars)"
}
```

> The crawl path previously omitted `agentId` and stored only a 500-char preview,
> which made website-crawled knowledge invisible to the agent's search. Both
> paths now tag `agentId` and store the full (≤8000-char) chunk.

**Website crawl is async:** `POST /knowledge/website` starts a Firecrawl job and
stores the crawl id; a 30 s polling job
([`firecrawl-ingest.job.ts`](apps/api/src/jobs/firecrawl-ingest.job.ts)) waits for
completion, then runs chunk → embed → upsert.

---

## 2. Retrieval — `searchKb`

[`search.service.ts`](apps/api/src/services/kb/search.service.ts):

1. Embed the query (same embedding service as ingestion).
2. Query Pinecone with `topK = AI_KB_SEARCH_TOP_K` and a filter **always scoped to
   the agent**, AND-ed with the org as defence in depth:
   ```js
   { $and: [ { agentId: { $eq: agentId } }, { organizationId: { $eq: organizationId } } ] }
   ```
   `agentId` is required — an unscoped call is refused (returns `[]` + logs) so one
   agent can never read another's KB.
3. Keep matches with `score >= AI_KB_SEARCH_MIN_SCORE`; join source titles from
   MongoDB; return `KbHit[]` (`{ sourceId, sourceTitle, chunkIndex, text, score }`).

Retrieval is an **enhancement, not a dependency**: if embedding or Pinecone fails
(after their own retries) it degrades to "no hits" so the reply still happens.

---

## 3. Generation — `generateAiReply`

Entry: a visitor message via the Socket.io
[`message.handler.ts`](apps/api/src/socket/handlers/message.handler.ts) or the REST
[`widget.routes.ts`](apps/api/src/routes/widget.routes.ts). The customer message is
saved, then `generateAiReply` runs **fire-and-forget** in
[`agent.service.ts`](apps/api/src/services/ai/agent.service.ts):

1. **Load** the conversation's agent + organization (agent resolved from
   `conversation.agentId`; throws if missing — so `agentId` is always present).
2. **System prompt** ([`prompts.ts`](apps/api/src/services/ai/prompts.ts)) — base
   rules ("ground facts in the KB, search before answering"), safety boundaries,
   escalation policy, org + agent persona, optional per-agent override.
3. **Tool loop** (≤ 6 turns) — calls the LLM via OpenRouter (`callLlm`,
   `tool_choice: auto`). The model chooses
   [tools](apps/api/src/services/ai/tools.ts): `search_kb`, `escalate_conversation`,
   `resolve_conversation`. `search_kb` → `searchKb({ query, organizationId, agentId })`;
   if it returns nothing it **retries once with `minScore: 0`** to widen recall.
   Hits are appended back as tool messages.
4. **Final reply** — one more LLM call, tools off, JSON required:
   `{ reply, confidence, action }` where `action ∈ { reply, escalate, resolve }`.
5. **Persist + emit** — save the AI `Message` (with `confidence` and a `toolCalls`
   log), flip conversation status on escalate/resolve, and emit `message:new` over
   Socket.io to the org dashboard, the conversation thread, and the contact session.

**Model / temperature** are per-agent with env fallback:
`agent.model ?? env.ai.model`, `agent.temperature ?? env.ai.temperature`.
`AI_CONFIDENCE_THRESHOLD` is **telemetry only** — the agent does not auto-escalate
on low confidence; it asks the visitor whether they want a human first.

---

## Call chain

```
visitor message
  └─ message.handler.ts / widget.routes.ts   (save customer message)
       └─ generateAiReply()                   (fire-and-forget)
            ├─ buildSystemPrompt()
            ├─ tool loop ×N  ─ callLlm(toolMode:auto)
            │                   └─ search_kb → searchKb()
            │                                   ├─ embed(query)
            │                                   └─ Pinecone query (agentId+org filter, minScore)
            ├─ callLlm(toolMode:none, requireJson) → { reply, confidence, action }
            └─ save Message + update status + socket emit "message:new"
```

---

## Config & plumbing

- **Pinecone:** [`config/pinecone.ts`](apps/api/src/config/pinecone.ts)
  `getPineconeIndex()` — `PINECONE_API_KEY`, `PINECONE_INDEX`. Upserts batched ≤100,
  deletes batched ≤1000 (direct data-plane HTTP, an SDK workaround). Degrades to a
  no-op index returning empty results when unconfigured.
- **Env** ([`config/env.ts`](apps/api/src/config/env.ts)): `AI_MODEL`,
  `AI_TEMPERATURE`, `AI_CONFIDENCE_THRESHOLD` (telemetry), `AI_KB_SEARCH_TOP_K`,
  `AI_KB_SEARCH_MIN_SCORE`, `OPENROUTER_API_KEY`/`OPENROUTER_BASE_URL`,
  `EMBEDDING_*`, `FIRECRAWL_*`, `PINECONE_*`.
- **Per-agent overrides:** `Agent.model` / `Agent.temperature` override the env
  defaults at call time; `Agent.confidenceThreshold` is kept for analytics only.

---

## Related specs

- [`__specs/04-pinecone-firecrawl.md`](__specs/04-pinecone-firecrawl.md) — vector store + crawl design
- [`__specs/05-ai-agent-design.md`](__specs/05-ai-agent-design.md) — agent / tool-loop design
- [`__specs/07-api-specification.md`](__specs/07-api-specification.md) — KB + auth endpoints
