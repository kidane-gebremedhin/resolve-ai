# 13 — Environment Variables Master List

## Overview

All environment variables organized by application. Each app has its own `.env` file. A root `.env.example` must be maintained with placeholder values for every variable listed below. DO NOT SET FALLBACK VALUES IN CODE, IF ENVIRONMENT VARIABLE IS NOT SET, THE APPLICATION SHOULD THROW AN ERROR ON STARTUP.

---

## `apps/api/.env` (Express Backend)

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | ✅ | `development` | `development` / `staging` / `production` |
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
| `NEXT_PUBLIC_PADDLE_ENVIRONMENT` | — | `sandbox` | Paddle client-side environment |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | — | — | Paddle client-side token (for Paddle.js) |

### Server-side only

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXTAUTH_SECRET` | ✅ | — | NextAuth secret (≥256-bit random) |
| `NEXTAUTH_URL` | ✅ | `http://localhost:3000` | NextAuth callback URL |
| `GOOGLE_CLIENT_ID` | ✅ | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | — | Google OAuth client secret |

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
