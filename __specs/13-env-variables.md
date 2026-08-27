# 13 — Environment Variables Master List

## Overview

All environment variables organized by application. Each app has its own `.env` file. A root `.env.example` must be maintained with placeholder values for every variable listed below. DO NOT SET FALLBACK VALUES IN CODE, IF ENVIRONMENT VARIABLE IS NOT SET, THE APPLICATION SHOULD THROW AN ERROR ON STARTUP.

---

## `apps/api/.env` (Express Backend)

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | ✅ | `development` | `development` / `staging` / `production` |
| `DEBUG_ENDPOINTS_ENABLED` | No | unset | Enables the unauthenticated `/api/v1/debug-sentry` smoke-test endpoints. Defaults to **off in production**, on elsewhere. Set `true` to enable them in production deliberately. |
| `TRUST_PROXY` | No | `1` | Reverse-proxy hops in front of the API (Express `trust proxy`). Governs how much of `X-Forwarded-For` is trusted for `req.ip`, which all IP rate limiting keys on. Accepts a hop count or a comma-separated list of proxy IPs/CIDRs. Never set `true` — it lets clients forge their source IP. |
| `PORT` | ✅ | `4000` | API server port |
| `API_BASE_URL` | ✅ | `http://localhost:4000` | Public-facing API URL |
| `CORS_ORIGINS` | ✅ | `http://localhost:3000,http://localhost:3001` | Comma-separated allowed origins |

### Database

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGODB_URI` | ✅ | `mongodb://localhost:27017/customer-support` | MongoDB connection string |
| `MONGODB_DB_NAME` | — | `customer-support` | Database name (overrides URI db name) |
| `REDIS_URL` | — | `redis://localhost:6379` | Redis for rate limiting / caching (optional) |

### Authentication

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | ✅ | — | ≥256-bit random secret for signing JWTs |
| `JWT_ACCESS_EXPIRY` | — | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRY` | — | `7d` | Refresh token TTL |
| `GOOGLE_CLIENT_ID` | ✅ | — | Google OAuth client ID (for token verification) |
| `SESSION_TOKEN_EXPIRY_HOURS` | — | `1` | Contact (widget visitor) session TTL in hours |

### AI / LLM

All AI tuning knobs (temperatures, thresholds, KB search bounds) are **required**
env vars — there are no hardcoded fallbacks in code. If you add a new tuning
parameter, register it in `apps/api/src/config/env.ts` and update both this
table and `.env.example` so a fresh checkout boots with sane defaults.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | ✅ | — | OpenRouter API key (or OpenAI-compatible provider) |
| `OPENROUTER_BASE_URL` | — | `https://openrouter.ai/api/v1` | LLM API base URL |
| `AI_MODEL` | ✅ | `openai/gpt-4o` | Default chat completion model |
| `AI_TEMPERATURE` | ✅ | `0.2` | Default temperature for the agent's main reply pass |
| `AI_ENHANCE_TEMPERATURE` | ✅ | `0.3` | Temperature for the operator "polish my draft" endpoint |
| `AI_SUGGESTIONS_TEMPERATURE` | ✅ | `0.4` | Temperature for the operator reply-suggestions endpoint |
| `AI_CONFIDENCE_THRESHOLD` | ✅ | `0.7` | Global default minimum confidence score (0.0–1.0). AI responses below this trigger auto-escalation. Per-agent `confidenceThreshold` field overrides. |
| `AI_KB_SEARCH_TOP_K` | ✅ | `8` | Default top-K passed to Pinecone for KB vector search |
| `AI_KB_SEARCH_MIN_SCORE` | ✅ | `0.2` | Minimum cosine similarity to keep a hit. If the first search returns zero, the agent retries with score floor 0 so the model always gets *something* to work with. |
| `EMBEDDING_MODEL` | — | `text-embedding-3-small` | OpenAI embedding model name |
| `EMBEDDING_API_KEY` | ✅ | — | API key for embedding provider (may be same as OPENROUTER_API_KEY) |
| `EMBEDDING_BASE_URL` | — | `https://api.openai.com/v1` | Embedding API base URL |
| `ENHANCE_MODEL` | — | `openai/gpt-4o-mini` | Model for operator message enhancement (falls back to `AI_MODEL` when unset) |
| `AI_LLM_TIMEOUT_MS` | — | `30000` | Per-attempt timeout for a chat-completion call |
| `AI_LLM_MAX_RETRIES` | — | `2` | Retries after a transient upstream failure (429 / 5xx / socket reset). Handled by LangChain with exponential backoff; 4xx surfaces immediately. |
| `AI_MAX_TOOL_TURNS` | — | `10` | Hard ceiling on agent↔tool round trips within one turn, so a model stuck on a failing tool cannot burn an org's budget |

### Pinecone

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PINECONE_API_KEY` | ✅ | — | Pinecone API key |
| `PINECONE_INDEX` | ✅ | — | Pinecone index name |
| `PINECONE_ENVIRONMENT` | — | — | Pinecone environment (may not be needed with serverless) |

### Firecrawl

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FIRECRAWL_API_KEY` | ✅ | — | Firecrawl API key |
| `FIRECRAWL_BASE_URL` | — | `https://api.firecrawl.dev/v1` | Firecrawl endpoint |
| `FIRECRAWL_MAX_PAGES` | — | `50` | Max pages per website crawl |

### Paddle (Billing)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PADDLE_API_KEY` | ✅ | — | Paddle API key |
| `PADDLE_WEBHOOK_SECRET` | ✅ | — | Paddle webhook signing secret |
| `PADDLE_ENVIRONMENT` | — | `sandbox` | `sandbox` / `production` |
| `PADDLE_PRICE_STARTER` | ✅ | — | Paddle price ID for starter plan |
| `PADDLE_PRICE_PRO` | ✅ | — | Paddle price ID for pro plan |
| `PADDLE_PRICE_ENTERPRISE` | ✅ | — | Paddle price ID for enterprise plan |

### Email (SMTP)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SMTP_HOST` | ✅ | — | SMTP server hostname (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | — | `587` | SMTP port |
| `SMTP_USER` | ✅ | — | SMTP username |
| `SMTP_PASS` | ✅ | — | SMTP password (for Gmail, a 16-char App Password) |
| `SMTP_FROM` | ✅ | — | Default "from" address (e.g., `noreply@yourdomain.com`) |
| `SMTP_SECURE` | — | `false` | Implicit TLS. Port `465` **always** uses TLS regardless of this flag (Changelog 6) |
| `CONTACT_INBOX_EMAIL` | — | — | Where public "Contact Us" submissions (`POST /public/contact`) are forwarded. When unset the inquiry is still persisted; only the notification email is skipped (Changelog 2) |

> **Changelog 6 — the mailer reads these.** `mailer.service.ts` prefers the admin panel's
> `PlatformSetting.smtp`, but now **falls back to these `SMTP_*` env vars** when it isn't
> configured (previously the env vars were ignored, so a `.env`-only deploy sent no mail —
> including OTP identity-verification codes). Port `465` is forced to implicit TLS to avoid
> the common `SMTP_PORT=465` + `SMTP_SECURE=false` handshake failure.

### File Storage

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STORAGE_PROVIDER` | — | `local` | `local` / `s3` |
| `STORAGE_LOCAL_PATH` | — | `./uploads` | Local file storage directory |
| `AWS_S3_BUCKET` | — | — | S3 bucket name (when STORAGE_PROVIDER=s3) |
| `AWS_S3_REGION` | — | `us-east-1` | S3 region |
| `AWS_ACCESS_KEY_ID` | — | — | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | — | — | AWS secret key |
| `AWS_S3_ENDPOINT` | — | — | Custom S3 endpoint (for MinIO, etc.) |

### Logging

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LOG_LEVEL` | — | `info` | `debug` / `info` / `warn` / `error` |
| `LOG_DIR` | — | `./logs` | Log file directory |
| `LOG_MAX_FILES` | — | `14d` | Max log retention |

### Error monitoring — Sentry (spec 35)

Read at runtime. All optional: with no DSN the SDK never initialises and every
`Sentry.*` call is a no-op, so the API boots and behaves identically.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SENTRY_DSN` | — | — | Backend project DSN (`chataxispro-backend`). Unset → reporting disabled |
| `SENTRY_ENVIRONMENT` | — | `NODE_ENV` | Environment tag on each event (`development` / `staging` / `production`) |
| `SENTRY_RELEASE` | — | — | Build identifier, usually the git SHA. Set by the Coolify compose files |

---

### LangSmith tracing — OPTIONAL (spec 05)

Traces every LangGraph node, LLM call and tool call for the AI agent. **Off by default**:
tracing ships conversation content (including customer messages) to LangSmith, so it must be an
explicit opt-in. Requires **both** `LANGSMITH_TRACING=true` **and** a non-empty
`LANGSMITH_API_KEY` — `initLangSmithTracing()` clears the SDK's env vars otherwise, so a stray
flag in a deployment environment cannot switch tracing on by accident.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LANGSMITH_TRACING` | — | `false` | Master switch. Only honoured alongside an API key. |
| `LANGSMITH_API_KEY` | — | — | LangSmith API key. Absent ⇒ tracing stays off regardless of the flag. |
| `LANGSMITH_ENDPOINT` | — | `https://api.smith.langchain.com` | LangSmith API endpoint (self-hosted installs override this) |
| `LANGSMITH_PROJECT` | — | `customer-service-chatbot` | Project traces are grouped under |

---

### Tier 1 — Widget polish additions (spec 29)

_No new env vars. All features build on existing `OPENROUTER_API_KEY` and
Socket.io infrastructure._

---

### Tier 2A — Integration framework (spec 30)

> **Integration credentials are NOT env vars (Changelog 7).** Provider API keys and
> OAuth tokens are stored per-connection, encrypted at rest. OAuth **app** credentials
> (`<PROVIDER>_CLIENT_ID` / `_CLIENT_SECRET` for Jira/Atlassian, Calendly, Linear,
> Shopify, Stripe) moved to a per-org encrypted `OAuthAppConfig` configured in the
> Integrations UI — they are no longer read from the environment. Only the vault key +
> the webhook timeout remain here. (Operators enter these in the Integrations UI; the
> old env→DB seeding one-off has been retired.)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CREDENTIALS_ENCRYPTION_KEY` | ✅ | — | 32-byte base64 key for AES-256-GCM per-org credential storage. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `WEBHOOK_TIMEOUT_MS` | — | `10000` | Max ms for custom webhook connector calls |
| `OTP_EXPIRY_SECONDS` | — | `600` | OTP validity window (seconds) for identity verification before high-stakes tool calls |

---

### Tier 2B — Agentic tools (spec 31)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AI_KB_GAP_SCORE_THRESHOLD` | — | `0.65` | Max Pinecone similarity score below which a question is logged as a knowledge gap |

---

### Tier 3 — Rich messages (spec 32)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AI_VISION_MODEL` | — | _(same as `AI_MODEL`)_ | Model for image-understanding requests. Must be vision-capable (e.g. `openai/gpt-4o`). |
| `AI_VISION_MAX_IMAGE_BYTES` | — | `4194304` | Max image size in bytes before resizing for vision API (default: 4 MB) |

---

### Tier 4 — Proactive & lifecycle (spec 33)

_No new env vars. Proactive triggers are stored in MongoDB and fetched by the embed at runtime._

---

### Tier 5 — Trust & compliance (spec 34)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PII_REDACTION_ENABLED` | — | `false` | Global default for PII redaction before LLM calls. Per-org toggle in `/app/settings` overrides. |
| `WIDGET_RATE_LIMIT_REQUESTS` | — | `30` | Max messages per rate-limit window per contact session |
| `WIDGET_RATE_LIMIT_WINDOW_MS` | — | `60000` | Rate-limit window duration in milliseconds |
| `ALLOW_WIDGET_VOICE_INPUT` | — | `false` | Show the voice-input (mic) button in the widget composer. Read by the API and delivered to the widget via `/widget/init` + `/widget/settings` as `features.voiceInput`. `"true"` enables; anything else hides. |

---

### Tier 6 — Voice (spec 34)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STT_PROVIDER` | — | `openai_whisper` | Speech-to-text provider: `openai_whisper` or `deepgram` |
| `DEEPGRAM_API_KEY` | — | — | Deepgram API key (required if `STT_PROVIDER=deepgram`) |
| `TTS_PROVIDER` | — | `openai` | Text-to-speech provider: `openai`, `elevenlabs`, or `cartesia` |
| `ELEVENLABS_API_KEY` | — | — | ElevenLabs API key (required if `TTS_PROVIDER=elevenlabs`) |
| `CARTESIA_API_KEY` | — | — | Cartesia API key (required if `TTS_PROVIDER=cartesia`) |
| `TTS_VOICE_ID` | — | `nova` | Provider-specific voice ID (default `nova` for OpenAI TTS) |
| `TWILIO_ACCOUNT_SID` | — | — | Twilio account SID (required for phone bridge) |
| `TWILIO_AUTH_TOKEN` | — | — | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | — | — | Purchased Twilio phone number in E.164 format (e.g. `+15551234567`) |

---

## `apps/web/.env.local` (Next.js Dashboard)

### Public (available in browser — `NEXT_PUBLIC_` prefix)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | ✅ | `http://localhost:4000/api/v1` | Express API base URL |
| `NEXT_PUBLIC_SOCKET_URL` | ✅ | `http://localhost:4000` | Socket.io server URL |
| `NEXT_PUBLIC_WIDGET_URL` | ✅ | `http://localhost:3001` | Widget app URL (for preview) |
| `NEXT_PUBLIC_EMBED_URL` | ✅ | `http://localhost:3002/widget.js` | Embed script URL |
| `NEXT_PUBLIC_APP_NAME` | — | `Chataxis` | App display name. Drives navbar wordmark, document `<title>` template, footer logo alt, marketing body copy via `apps/web/src/lib/app-config.ts`. |
| `NEXT_PUBLIC_APP_TAGLINE` | — | `AI customer support for modern websites` | Marketing tagline appended after `APP_NAME` in the home `<title>` and OG description. |
| `NEXT_PUBLIC_APP_LEGAL_NAME` | — | `${APP_NAME} AI, Inc.` | Footer copyright entity. |
| `NEXT_PUBLIC_SUPPORT_PHONE` | — | `(239) 555-0108` | Contact section phone. |
| `NEXT_PUBLIC_SUPPORT_ADDRESS` | — | `4140 Parker Rd, Allentown, NM 31134` | Contact section address. |
| `NEXT_PUBLIC_APP_URL` | ✅ | `http://localhost:3000` | Dashboard app URL |
| `KB_HYBRID_ALPHA` | — | `0.7` | Dense/lexical blend. 1.0 dense-only, 0.0 lexical-only. Default is the measured peak of a sweep, see [`41-hybrid-retrieval.md`](41-hybrid-retrieval.md) |
| `KB_HYBRID_FUSION` | — | `rrf` | `rrf` (fuse on rank) or `weighted` (fuse on normalised score) |
| `KB_LEXICAL_TIMEOUT_MS` | — | `1500` | Past this the lexical leg is dropped and retrieval proceeds dense-only |
| `KB_HEADING_PATH_EMBEDDING` | — | `true` | Prepend the chunk's heading path to the embedded text |
| `EMBEDDING_DIMENSIONS` | — | *(native)* | Output dimensionality. Required for a model whose native size exceeds the index dimension. **Changing the embedding model requires a full reindex**: mixed vector spaces return nonsense |
| `AI_CONTEXT_TOKEN_BUDGET` | — | `3000` | Token ceiling for the numbered context block. Enforced by dropping whole passages, never truncating one |
| `AI_MAX_UNCITED_RATIO` | — | `0.5` | Uncited factual sentences allowed before the turn's confidence is lowered, feeding the existing escalation threshold |
| `KB_INGEST_MAX_RETRIES` | — | `3` | Bounded retries for a **transient** ingest failure. Permanent classes consume none |
| `KB_INGEST_STUCK_PROCESSING_MS` | — | `900000` | A source in `processing` longer than this was interrupted and is re-queued |
| `KB_INGEST_RETRY_BACKOFF_MS` | — | `60000` | Base retry delay, doubled per attempt |
| `KB_INGEST_FAILURE_ALERT_RATE` | — | `0.3` | Org failure rate that raises an operator alert |
| `KB_INGEST_FAILURE_ALERT_MIN_SOURCES` | — | `5` | Floor before the rate above means anything |
| `KB_CONFLICT_DETECTION_ENABLED` | — | `false` | Detect and resolve contradictory sources. See [`44-knowledge-conflicts.md`](44-knowledge-conflicts.md) |
| `KB_CONFLICT_SCORE_GAP` | — | `0.15` | How close the top two sources must score before a conflict check runs. The budget gate |
| `KB_RERANK_ENABLED` | — | `false` | Cross-encoder reranking. Off by default: a measured trade, not a clear win. See [`42-reranking.md`](42-reranking.md) |
| `KB_RERANK_PROVIDER` | — | `pinecone` | `pinecone` (hosted cross-encoder) or `llm` (fallback) |
| `KB_RERANK_MODEL` | — | `bge-reranker-v2-m3` | Hosted reranker model |
| `KB_RERANK_CANDIDATES` | — | `50` | Stage-1 candidate count. **Distinct from `AI_KB_SEARCH_TOP_K`**, the final context size |
| `KB_RERANK_TIMEOUT_MS` | — | `3000` | Past this, stage-1 ordering stands |
| `KB_RERANK_MIN_SCORE` | — | `0.0005` | Relevance floor on the calibrated score, applied to the **best** candidate, not each one |
| `AI_QUERY_REWRITE_ENABLED` | — | `false` | Query understanding in front of KB search. Off by default: it improves retrieval measurably but costs ~2.5s p95, 6x its stated budget. See [`40-query-understanding.md`](40-query-understanding.md) |
| `AI_QUERY_REWRITE_MODEL` | — | `anthropic/claude-haiku-4.5` | Small, fast OpenRouter model for rewriting. Never the answering model |
| `AI_QUERY_REWRITE_TIMEOUT_MS` | — | `4000` | Past this, fall back to the raw query |
| `AI_QUERY_REWRITE_HISTORY_TURNS` | — | `6` | Prior turns used to resolve a follow-up |
| `AI_QUERY_EXPANSION_COUNT` | — | `2` | Paraphrases per query, fused with RRF. `0` disables expansion |
| `AI_QUERY_HYDE_ENABLED` | — | `false` | Embed a hypothetical answer instead of the question. Corpus-dependent |
| `AI_QUERY_FOLLOWUP_ROUND_ENABLED` | — | `false` | At most one extra retrieval round for multi-hop questions |
| `RAG_EVAL_JUDGE_MODEL` | — | a strong Claude model | OpenRouter model id for the offline eval judge (`pnpm eval:rag`). Must not be the answering model. See [`__specs/39-rag-evaluation.md`](39-rag-evaluation.md) |
| `RAG_TELEMETRY_ENABLED` | — | `true` | Persist one `RagTurnMetric` per customer turn. Every write is fire-and-forget, after the reply is sent. See [`39-rag-evaluation.md`](39-rag-evaluation.md) |
| `RAG_TELEMETRY_RETENTION_DAYS` | — | `90` | TTL on `ragturnmetrics`. Matches every other per-turn telemetry collection ([`12-security-compliance.md`](12-security-compliance.md)) |
| `RAG_FAITHFULNESS_SAMPLE_RATE` | — | `0.05` | Share of turns sent to the judge for an online faithfulness score. `0` disables sampling without disabling telemetry |
| `RAG_FAITHFULNESS_JUDGE_MODEL` | — | `RAG_EVAL_JUDGE_MODEL` | Online judge model. Must not be the answering model; defaults to the offline judge so the two numbers stay comparable |
| `RAG_FAITHFULNESS_TIMEOUT_MS` | — | `20000` | Ceiling on one out-of-band judge call |
| `RAG_ALERT_ENABLED` | — | `true` | Notify an org when a rolling-window quality rate crosses its threshold |
| `RAG_ALERT_WINDOW_MINUTES` | — | `60` | Rolling window the rates are computed over |
| `RAG_ALERT_MIN_TURNS` | — | `20` | Turns required in the window before a rate means anything |
| `RAG_ALERT_NO_HIT_RATE` | — | `0.4` | No-hit rate that raises an alert. The fix is writing documents |
| `RAG_ALERT_LOW_CONFIDENCE_RATE` | — | `0.3` | Low-confidence rate that raises an alert. Usually retrieval quality, not missing content |
| `RAG_ALERT_ESCALATION_RATE` | — | `0.5` | Escalation rate that raises an alert |
| `RAG_ALERT_COOLDOWN_MINUTES` | — | `360` | Silence per org per rate after one alert |
| `RAG_ALERT_INTERVAL_MS` | — | `900000` | How often the sweep job runs |
| `RAG_EVAL_REPORTS_DIR` | — | `../../packages/rag-eval/reports` | Offline eval reports read by the RAG Quality page's eval-history panel. Absent directory → panel reports none available, not an error |
| `KB_INDEX_HEALTH_ENABLED` | — | `false` | The **scheduled** half of index health. Off until the scoring is trusted on real data. The dashboard reads and the four repair actions are unaffected. See [`04-pinecone-firecrawl.md`](04-pinecone-firecrawl.md) |
| `KB_INDEX_HEALTH_INTERVAL_MS` | — | `1800000` | How often the job wakes. Work is gated to the off-peak hour below |
| `KB_INDEX_HEALTH_HOUR_UTC` | — | `3` | UTC hour the job may re-embed in. Re-embedding competes with live retrieval for the same provider quota |
| `KB_INDEX_HEALTH_MAX_REEMBED_PER_RUN` | — | `10` | Sources re-embedded per run. A drifted corpus is repaired over several nights, never in one burst |
| `KB_HEALTH_WINDOW_DAYS` | — | `30` | Telemetry window every health metric is computed over |
| `KB_HEALTH_MIN_RETRIEVALS` | — | `5` | Volume floor before a rate about a chunk means anything |
| `KB_HEALTH_DOWNVOTE_RATE` | — | `0.3` | Downvote rate among **citing** answers that marks a passage misleading |
| `KB_HEALTH_UNCITED_RATE` | — | `0.2` | Citation rate at or below which a retrieved passage counts as ignored |
| `KB_HEALTH_STRONG_SCORE` | — | `0.5` | Score a passage must reach before "never cited" reads as a chunking defect |
| `KB_HEALTH_GAP_SIMILARITY` | — | `0.55` | Cosine similarity at which two gap queries are the same question. **Measured**, not guessed: 0.86 clustered nothing. See the sweep in [`04-pinecone-firecrawl.md`](04-pinecone-firecrawl.md) |
| `KB_HEALTH_EMBEDDING_MODEL_TAG` | — | `EMBEDDING_MODEL` | Vector-space tag on cached gap embeddings. Changing the embedding model must change this |
| `NEXT_DEV_ALLOWED_ORIGINS` | — | *(empty)* | **Dev only.** Comma-separated hosts allowed to reach the Next dev server's internal endpoints (HMR, RSC payloads, `/_next/*`). Required when `pnpm dev` is served through a tunnel, e.g. a Cloudflare quick tunnel used to receive Paddle webhooks locally; without it the page loads but never hydrates. Production is served from its own origin and ignores this. |
| `NEXT_PUBLIC_PADDLE_ENVIRONMENT` | — | `sandbox` | Paddle client-side environment |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | — | — | Paddle client-side token (for Paddle.js) |
| `NEXT_PUBLIC_SENTRY_DSN` | — | — | Frontend project DSN (`chataxispro-frontend`). **Build-time**: inlined into the client bundle, so it must be a docker build arg — setting it only at runtime leaves the browser SDK uninitialised |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | — | `NODE_ENV` | Environment tag on browser events |

### Server-side only

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXTAUTH_SECRET` | ✅ | — | NextAuth secret (≥256-bit random) |
| `NEXTAUTH_URL` | ✅ | `http://localhost:3000` | NextAuth callback URL |
| `GOOGLE_CLIENT_ID` | ✅ | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | — | Google OAuth client secret |
| `SENTRY_DSN` | — | `NEXT_PUBLIC_SENTRY_DSN` | DSN for the Next.js server runtime. Runtime-read, so it can change without a rebuild |
| `SENTRY_ENVIRONMENT` | — | `NODE_ENV` | Environment tag on server events |
| `SENTRY_RELEASE` | — | — | Build identifier (git SHA) |

### Build-time only — Sentry source maps (spec 35)

Optional. Without `SENTRY_AUTH_TOKEN` the build still succeeds; production stack
traces just stay minified.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SENTRY_ORG` | — | — | Sentry org slug (`mllabs-xk`) |
| `SENTRY_PROJECT` | — | — | Sentry project slug (`chataxispro-frontend`) |
| `SENTRY_AUTH_TOKEN` | — | — | Token with `project:releases` scope. Used only in the build stage; never copied into the runtime image |

---

## `apps/widget/.env.local` (Next.js Widget)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | ✅ | `http://localhost:4000/api/v1` | Express API base URL |
| `NEXT_PUBLIC_SOCKET_URL` | ✅ | `http://localhost:4000` | Socket.io server URL |
| `NEXT_PUBLIC_WIDGET_PORT` | — | `3001` | Widget dev server port |

---

## `apps/embed/.env` (Vite Embed Script)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_WIDGET_URL` | ✅ | `http://localhost:3001` | Widget iframe URL |
| `VITE_EMBED_PORT` | — | `3002` | Embed dev server port |

---

## Docker Compose Variables (`docker-compose.yml`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_INITDB_ROOT_USERNAME` | — | `admin` | MongoDB root user |
| `MONGO_INITDB_ROOT_PASSWORD` | — | `password` | MongoDB root password |
| `MONGO_INITDB_DATABASE` | — | `customer-support` | Initial database |
| `REDIS_PASSWORD` | — | — | Redis password (optional for dev) |

---

## CI/CD Variables (GitHub Actions — see [18-cicd-pipeline.md](./18-cicd-pipeline.md))

### GitHub repository secrets

| Variable | Required | Description |
|----------|----------|-------------|
| `TURBO_TOKEN` | ✅ | Turborepo remote cache token (read+write for `main`/`staging`/`dev`, read-only for fork PRs) |
| `GITHUB_TOKEN` | ✅ | Auto-provided by Actions; used for GHCR push + CodeQL |
| `COOLIFY_WEBHOOK_URL` | ✅ | Coolify deploy webhook used for **dev + staging** (branch in payload routes to the correct project) |
| `COOLIFY_API_TOKEN` | ✅ | Coolify bearer token for dev + staging |
| `COOLIFY_PROD_WEBHOOK_URL` | ✅ | Production Coolify deploy webhook (scoped to `production` env) |
| `COOLIFY_PROD_API_TOKEN` | ✅ | Production Coolify bearer token |
| `NEXT_PUBLIC_SENTRY_DSN` | — | Frontend Sentry DSN, passed as a build arg to the web image (spec 35). Unset → the built bundle has no browser reporting |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | — | Source-map upload during the web image build. Unset → build succeeds, traces stay minified |

### GitHub repository variables (non-secret)

| Variable | Required | Description |
|----------|----------|-------------|
| `TURBO_TEAM` | ✅ | Turborepo team slug |
| `DEV_WEB_URL` / `DEV_WIDGET_URL` / `DEV_API_URL` | ✅ | Post-deploy health-check targets for dev |
| `STAGING_WEB_URL` / `STAGING_WIDGET_URL` / `STAGING_API_URL` | ✅ | Same for staging |
| `PROD_WEB_URL` / `PROD_WIDGET_URL` / `PROD_API_URL` | ✅ | Same for production |

---

## Coolify Deployment Variables (see [20-coolify-deployment.md](./20-coolify-deployment.md))

Set per-environment in the Coolify UI (encrypted at rest). Most are the same as `apps/api/.env` and `apps/web/.env.local`, but a few are Coolify-specific:

| Variable | Required | Description |
|----------|----------|-------------|
| `GHCR_OWNER` | ✅ | GitHub org/user that owns the published images |
| `IMAGE_TAG` | ✅ | Image tag to deploy. Staging: `staging` (mutable). Production: full git SHA (immutable, injected by deploy webhook) |
| `METRICS_TOKEN` | ✅ | Bearer token required to scrape `GET /metrics` on the API |
| `SENTRY_DSN` | — | Sentry project DSN (per environment); enables error reporting if set |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OpenTelemetry collector endpoint for APM |
| `LOG_SHIPPER_TOKEN` | — | Auth token for Better Stack / Loki log shipping |

> Per-environment overrides (full matrix in §"Environment Differences" below):
> - **Dev**: `IMAGE_TAG=dev`, sandbox third-party keys, MailHog SMTP, `*.dev.customer-service-chatbot.app` URLs
> - **Staging**: `IMAGE_TAG=staging`, sandbox third-party keys, Mailtrap SMTP, `*.staging.customer-service-chatbot.app` URLs
> - **Production**: `IMAGE_TAG=<git-sha>` (immutable), production keys, real SMTP provider, `MONGODB_URI` points at MongoDB Atlas (`mongodb+srv://...`), real AWS/R2 for `STORAGE_PROVIDER=s3`

---

## MCP Session Variables (developer shell — see [21-mcp-tooling.md](./21-mcp-tooling.md))

These are **not** required at runtime — they exist only in a developer's shell for MCP servers to consume via `${VAR}` expansion in `.mcp.json`.

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | for `mongo-mcp` | Dev DB URI; **never** production credentials |
| `PADDLE_API_KEY`, `PADDLE_ENVIRONMENT` | for `paddle-mcp` | Sandbox keys only on dev machines |
| `PINECONE_API_KEY` | for `pinecone-mcp` | — |
| `GITHUB_TOKEN` | for `github-mcp` | Fine-grained PAT, single repo, rotated quarterly |
| `CHROME_REMOTE_DEBUG_PORT` | for `chrome-devtools-mcp` | Default `9222` |
| `MDB_MCP_READ_ONLY` | for `mongo-mcp` | Set `true` if connected to staging/prod |
| `MCP_LOG_PATH` | recommended | Where MCP audit log is written |

---

## Environment Differences (Local / Dev / Staging / Production)

Four environments. `local` is your laptop; `dev` / `staging` / `production` are Coolify-managed and described in [20-coolify-deployment.md](./20-coolify-deployment.md).

| Variable | Local | Dev | Staging | Production |
|----------|-------|-----|---------|------------|
| `NODE_ENV` | `development` | `development` | `staging` | `production` |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:3001` | `https://dev.customer-service-chatbot.app,https://widget.dev.customer-service-chatbot.app` | `https://staging.customer-service-chatbot.app,https://widget.staging.customer-service-chatbot.app` | `https://app.customer-service-chatbot.app,https://widget.customer-service-chatbot.app` |
| `STORAGE_PROVIDER` | `local` | `s3` (MinIO) | `s3` (MinIO) | `s3` (AWS / R2) |
| `PADDLE_ENVIRONMENT` | `sandbox` | `sandbox` | `sandbox` | `production` |
| `LOG_LEVEL` | `debug` | `debug` | `info` | `info` |
| `SMTP_HOST` | MailHog (`mailhog:1025`) | MailHog | Mailtrap | SES / Resend / Postmark |
| URLs (`*_URL`) | `localhost:*` | `*.dev.customer-service-chatbot.app` | `*.staging.customer-service-chatbot.app` | `app.customer-service-chatbot.app` / `widget.customer-service-chatbot.app` |
| `MONGODB_URI` | Local Docker `mongo:27017` | Coolify-managed Mongo | Coolify-managed Mongo | MongoDB Atlas |
| `PINECONE_INDEX` | `csb-local` | `csb-dev` | `csb-staging` | `csb-prod` |
| `SENTRY_ENVIRONMENT` | (unset) | `dev` | `staging` | `production` |
| `IMAGE_TAG` (Coolify only) | — | `dev` (mutable) | `staging` (mutable) | `<git-sha>` (immutable) |

**Rule**: every secret value is **distinct across environments**. A leaked dev secret must not grant access to staging or production resources.

---

## `.env.example` Template

The root `.env.example` must contain all variables with placeholder values and comments. Example format:

```bash
# ══════════════════════════════════════
# API Server (apps/api)
# ══════════════════════════════════════
NODE_ENV=development
PORT=4000
API_BASE_URL=http://localhost:4000
CORS_ORIGINS=http://localhost:3000,http://localhost:3001

# Database
MONGODB_URI=mongodb://localhost:27017/customer-support
# REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-256-bit-secret-here
GOOGLE_CLIENT_ID=your-google-client-id

# AI / LLM
OPENROUTER_API_KEY=sk-or-xxx
AI_MODEL=openai/gpt-4o
AI_TEMPERATURE=0.2
AI_ENHANCE_TEMPERATURE=0.3
AI_SUGGESTIONS_TEMPERATURE=0.4
AI_CONFIDENCE_THRESHOLD=0.7
AI_KB_SEARCH_TOP_K=8
AI_KB_SEARCH_MIN_SCORE=0.2
EMBEDDING_API_KEY=sk-xxx

# Pinecone
PINECONE_API_KEY=pc-xxx
PINECONE_INDEX=customer-support

# Firecrawl
FIRECRAWL_API_KEY=fc-xxx

# Paddle Billing
PADDLE_API_KEY=pdl_xxx
PADDLE_WEBHOOK_SECRET=pdl_whsec_xxx
PADDLE_ENVIRONMENT=sandbox
PADDLE_PRICE_STARTER=pri_xxx
PADDLE_PRICE_PRO=pri_xxx
PADDLE_PRICE_ENTERPRISE=pri_xxx

# SMTP
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-pass
SMTP_FROM=noreply@yourdomain.com

# File Storage
STORAGE_PROVIDER=local
# AWS_S3_BUCKET=your-bucket
# AWS_ACCESS_KEY_ID=your-key
# AWS_SECRET_ACCESS_KEY=your-secret

# ══════════════════════════════════════
# Web Dashboard (apps/web)
# ══════════════════════════════════════
NEXTAUTH_SECRET=your-nextauth-secret
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_SECRET=your-google-client-secret
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
NEXT_PUBLIC_WIDGET_URL=http://localhost:3001
NEXT_PUBLIC_EMBED_URL=http://localhost:3002/widget.js
NEXT_PUBLIC_APP_URL=http://localhost:3000

# ══════════════════════════════════════
# Widget (apps/widget)
# ══════════════════════════════════════
# Uses NEXT_PUBLIC_API_URL and NEXT_PUBLIC_SOCKET_URL from above

# ══════════════════════════════════════
# Embed (apps/embed)
# ══════════════════════════════════════
VITE_WIDGET_URL=http://localhost:3001
```
