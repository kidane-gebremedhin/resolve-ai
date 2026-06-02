# 15 — Risks, Decisions & Open Questions

## Architectural Decisions (Resolved)

### ADR-01: Conversation-First vs Lead-First
- **Decision**: Conversation-first
- **Rationale**: Lower friction increases engagement; AI resolves simple queries without needing contact info
- **Consequence**: Contact form is blocking; may increase friction for some users.

### ADR-02: Session Identity — Token vs Email
- **Decision**: Session token (UUID v4 in localStorage)
- **Rationale**: Privacy-first; no cross-device tracking; simpler data model.
- **Consequence**: Customer loses history if localStorage cleared or session expires (24h). No cross-device continuity — acceptable for v1

### ADR-03: BFF vs Direct API JWT
- **Decision**: Direct API JWT
- **Rationale**: Simpler architecture; no double-hop latency; Express API is single source of truth; NextAuth provides JWT that Express validates
- **Consequence**: CORS must be properly configured; token refresh logic lives in frontend API client

### ADR-04: File Storage — S3 vs GridFS
- **Decision**: S3 (local disk for dev)
- **Rationale**: Better scalability; CDN-friendly; pre-signed URLs; cheaper at scale; GridFS adds DB load
- **Consequence**: Extra infrastructure (S3 bucket); file deletion must sync with DB record deletion

### ADR-05: Image Processing — Vision Model vs OCR
- **Decision**: OCR (primary) + Vision model (fallback)
- **Rationale**: OCR is better for scanned documents with dense text at lower cost; Vision models produce richer semantic descriptions but at higher cost
- **Consequence**: Need to detect image type to route to correct pipeline

### ADR-06: Monorepo — pnpm + Turborepo
- **Decision**: pnpm workspaces + Turborepo
- **Rationale**: Fastest installs; task caching; parallel execution; simpler than Nx; excellent Next.js support

### ADR-07: Single Shared AI Agent
- **Decision**: Single shared agent with org-scoped tools
- **Rationale**: One codebase for prompt and tools; org differentiation via Pinecone namespace and optional `systemPromptOverride`

### ADR-08: Session TTL — Sliding Window
- **Decision**: Sliding window (24h from last activity)
- **Rationale**: Better UX — active customers keep their session; MongoDB TTL index + application-level `expiresAt` refresh

---

## Identified Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | Pinecone cold start / transient connection failures (`PineconeConnectionError` from stale undici keep-alive sockets) | Medium | Medium | Serverless Pinecone; retry-with-backoff (3 attempts) on transient/5xx errors in `config/pinecone.ts`; `searchKb` degrades to zero hits on failure so the AI reply still proceeds |
| R2 | LLM response latency (>5s) | High | Medium | Stream via Socket.io; typing indicator; 30s timeout; queue-based retry |
| R3 | Firecrawl rate limits / failures | Medium | Low | Async job queue; exponential backoff (max 3); failure status in KB UI |
| R4 | MongoDB TTL index precision | Low | Low | Application-level expiry check on token validation (don't rely solely on TTL) |
| R5 | Cross-org data leakage | Low | 🔴 Critical | Mandatory `organizationId` middleware; multi-org integration tests in CI |
| R6 | Paddle webhook failures | Medium | High | Idempotency keys; retry logic; manual reconciliation endpoint; log raw events |
| R7 | File upload abuse | Medium | Medium | Signed upload URLs; MIME validation via magic bytes; per-org storage quotas |
| R8 | Socket.io connection storms | Medium | Medium | Connection limit per user/session; graceful degradation to polling; Redis adapter |
| R9 | Embedding cost spikes | Medium | Medium | Per-org daily quotas tied to plan; batch embedding; chunk dedup via contentHash |
| R10 | localStorage cleared by user | Medium | Low | Accepted trade-off; user starts fresh session; old sessions exist in DB for operator |

---

## Open Questions

### OQ-1: Widget Audio Notifications
- **Question**: Widget sounds on new messages, or dashboard only?
- **Recommendation**: Dashboard only — widget sounds may annoy customers and trigger browser autoplay restrictions
- **Status**: In Both

### OQ-2: Conversation Reopening Limit
- **Question**: Limit reopens on resolved conversations?
- **Recommendation**: No limit for v1; track reopen frequency via analytics for future policy
- **Status**: No Limit for v1

### OQ-3: Multi-Organization Users
- **Question**: Can one user belong to multiple organizations?
- **Recommendation**: Yes — `memberships` already models this; org switcher is a UI feature (Phase 4)
- **Status**: Yes

### OQ-4: Widget Conversation Limit per Session
- **Question**: Multiple conversations per session?
- **Recommendation**: Yes — allows topic separation; widget shows conversation list or latest active
- **Status**: No

### OQ-5: AI Response When Operators Online
- **Question**: Should AI stop responding when operators are online?
- **Recommendation**: AI always responds first — reduces operator load; operator can jump in anytime
- **Status**: Yes

### OQ-6: Free Plan Limits
- **Proposed**: 100 AI messages/month, 5 KB sources, 1 website, 1 agent, 2 team members, no Firecrawl, no enhancement
- **Status**: should be configurable

### OQ-7: KB Versioning on Update
- **Question**: Keep old version on update or replace in-place?
- **Recommendation**: Replace in-place for v1 (increment `version`, delete old vectors, re-embed)
- **Status**: Replace in-place for v1

---
