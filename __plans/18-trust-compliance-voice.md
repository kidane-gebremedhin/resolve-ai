# Phase 18 — Trust, Compliance & Voice (Tiers 5–6) ✅ COMPLETE

> Roadmap Tiers 5–6. Spec: [`__specs/34-trust-compliance-voice.md`](../__specs/34-trust-compliance-voice.md). Builds on Phase 14 ([`14-integration-framework.md`](./14-integration-framework.md)) for `piiMask.ts` reuse.
>
> **Implemented**: all builds (api, web, widget) pass. See `CHANGELOG_10.md` for full diff summary.

## Goal

Harden the platform for enterprise and regulated-industry customers: per-org PII redaction before LLM calls, an operator-visible audit trail of all tool calls (with masked args), transcript export to S3 with signed URLs, a `dataRegion` stub visible to enterprise prospects, widget rate limiting and abuse detection at the message endpoint, and two voice modalities — browser-mic (MediaRecorder → STT → LLM → TTS → audio reply) and Twilio phone bridge (Media Streams WebSocket). After this phase an enterprise operator can demonstrate GDPR-conscious AI and a customer can speak to the AI instead of typing.

## Prerequisites

- Phase 14 green (`piiMask.ts` exists at `apps/api/src/services/integrations/piiMask.ts`).
- `apps/api/src/services/attachments.service.ts` working (S3 upload/sign pattern reused for transcript export and voice audio).
- `mailer.service.ts` working (email reused for rate-limit alert at threshold, if added later).
- Redis available or `ioredis` already wired (rate-limit sliding window); in-memory fallback acceptable for non-production.
- STT/TTS provider decision from BLOCKERS.md B-4 (default: OpenAI Whisper + OpenAI TTS — no new keys if `OPENAI_API_KEY` already set).
- Twilio account (BLOCKERS.md B-4 side note): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` only needed for phone bridge.

## Skills to invoke

- [[__skills/express-mongoose-scaffold]] — schema additions, new routes, new middleware.
- [[__skills/webapp-testing]] — rate-limit stress test, PII assertion via `mongo-mcp`.
- [[__skills/widget-embed-iframe]] — mic button in widget Composer, audio playback.

## Work breakdown (ordered)

### 5.1 — PII redaction

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 1 | Extend `piiMask.ts` (created in Plan 14): add US SSN (`\d{3}-\d{2}-\d{4}`) and UK NI Number patterns; add `maskPii(text: string): string` string overload alongside existing object overload | `apps/api/src/services/integrations/piiMask.ts` | express-mongoose-scaffold | Unit test: email, phone, credit card, SSN, NI Number all masked; plain text overload works |
| 2 | Add `settings.piiRedaction: boolean` (default `false`) to `Organization` schema; add PII Redaction toggle in `/app/settings` org settings page (save via `PATCH /organizations/:id`) | `apps/api/src/models/Organization.ts`, `apps/web/src/app/(dashboard)/app/settings` | express-mongoose-scaffold | Toggle saves; `mongo-mcp` confirms `settings.piiRedaction` field |
| 3 | In `generateAiReply()`: if `org.settings.piiRedaction === true`, apply `maskPii()` to `content` of all history messages and to the incoming customer message before building the LLM prompt. Do NOT mask `ContactSession.email` used by tool dispatcher (raw data needed for tool actions) | `apps/api/src/services/ai/agent.service.ts` | express-mongoose-scaffold | With redaction on: send "my email is test@example.com" → LLM prompt shows `[EMAIL]`; `ContactSession.email` unchanged in Mongo |

### 5.5 — Widget rate limiting + abuse detection

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 4 | Create `widgetRateLimit.ts` middleware: per-`contactSessionId` sliding window — `WIDGET_RATE_LIMIT_MAX` requests in `WIDGET_RATE_LIMIT_WINDOW_MS` (defaults: 30 req / 60 000 ms). Use Redis `INCR + PEXPIRE` pattern; fall back to in-memory `Map` if Redis unavailable. Apply to `POST /widget/conversations/:id/messages` | `apps/api/src/middleware/widgetRateLimit.ts`, `apps/api/src/routes/widget.routes.ts`, `apps/api/src/config/env.ts` | express-mongoose-scaffold | 31st message in 60s → 429 JSON `{error:"rate_limit_exceeded"}`; 30th → 200 |
| 5 | Add abuse detection in `POST /widget/conversations/:id/messages` handler: before AI call, check message `content` against `ABUSE_PATTERNS` regex (env var, JSON array of patterns, default: common prompt-injection phrases). On match: auto-escalate conversation, set `ContactSession.abuseSuspected: true`, skip `generateAiReply()`, return neutral response | `apps/api/src/routes/widget.routes.ts`, `apps/api/src/models/ContactSession.ts`, `apps/api/src/config/env.ts` | express-mongoose-scaffold | Prompt injection string → conversation escalated, no AI reply; `ContactSession.abuseSuspected:true` in Mongo |

### 5.2 — Per-session audit trail UI

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 6 | Add `GET /conversations/:id/audit-trail` endpoint (operator JWT auth): return `ToolCallLog.find({conversationId}).sort({createdAt:1})` with PII-masked `argsMasked` already stored | `apps/api/src/routes/conversation.routes.ts` | express-mongoose-scaffold | Endpoint returns logs; unauthorized request → 401 |
| 7 | Add "Audit Trail" tab to operator inbox conversation detail view: table of tool call rows with columns: timestamp, tool name, status badge (success/blocked/error), duration (ms), masked args summary, result summary; blocked rows show guardrail reason | `apps/web/src/app/(dashboard)/app/inbox` (conversation detail tabs) | webapp-testing | Audit trail tab visible; refund attempt shows amount (masked) and `guardrail_blocked` reason |

### 5.3 — Transcript export

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 8 | Add `POST /conversations/:id/export` endpoint (operator JWT): accept `{format: "csv"\|"json"}`; fetch all `Message` docs for conversation; serialize to chosen format; upload to S3 via `attachments.service.ts` pattern (key: `exports/{orgId}/{convId}/{timestamp}.{ext}`); return `{url: signedUrl, expiresAt}` with 1h TTL | `apps/api/src/routes/conversation.routes.ts`, `apps/api/src/services/attachments.service.ts` | express-mongoose-scaffold | `POST .../export` → signed S3 URL returned; URL downloads valid CSV/JSON; URL expires after 1h |
| 9 | Add "Export transcript" button to conversation detail header in operator inbox; on click POST to `/export`, show loading state, then open download URL in new tab with a toast "Export ready" | `apps/web/src/app/(dashboard)/app/inbox` (conversation header) | webapp-testing | Button triggers export; CSV file downloads with correct columns (timestamp, role, content) |

### 5.4 — Data residency stub

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 10 | Add `dataRegion: "us"\|"eu"` (default `"us"`, read-only in API — not settable via `PATCH`) to `Organization` schema; display as a read-only chip with "Contact us to change region" tooltip in `/app/settings` | `apps/api/src/models/Organization.ts`, `apps/web/src/app/(dashboard)/app/settings` | express-mongoose-scaffold | Field visible in settings page; `PATCH /organizations/:id` ignores `dataRegion`; Mongo default `"us"` |

### 6.1 — Browser-mic voice

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 11 | Create `stt.service.ts`: `transcribe(audioBuffer: Buffer, mimeType: string): Promise<string>`. Default provider: OpenAI Whisper (`POST /v1/audio/transcriptions`, `model: "whisper-1"`). If `STT_PROVIDER=deepgram`: POST to `api.deepgram.com/v1/listen` with WebSocket or batch API. Provider resolved at startup from env | `apps/api/src/services/voice/stt.service.ts`, `apps/api/src/config/env.ts` | express-mongoose-scaffold | `transcribe(wavBuffer)` returns correct transcript; OpenAI Whisper used by default |
| 12 | Create `tts.service.ts`: `synthesize(text: string): Promise<Buffer>`. Default: OpenAI `POST /v1/audio/speech` (`model: "tts-1"`, `voice: TTS_VOICE_ID` env, default `"alloy"`). If `TTS_PROVIDER=elevenlabs`: ElevenLabs REST API. If `TTS_PROVIDER=cartesia`: Cartesia API | `apps/api/src/services/voice/tts.service.ts`, `apps/api/src/config/env.ts` | express-mongoose-scaffold | `synthesize("Hello")` returns MP3 buffer; buffer playable |
| 13 | Add `POST /widget/conversations/:id/voice-message` endpoint (widget session auth): accept `multipart/form-data` audio blob (WebM/Opus); transcribe via `stt.service.ts`; call `generateAiReply()` with transcription as customer message content; synthesize AI reply text via `tts.service.ts`; upload audio to S3; return `{messageId, transcription, audioUrl}` | `apps/api/src/routes/widget.routes.ts` | express-mongoose-scaffold | Upload 5s WebM clip → transcription returned; AI text reply generated; S3 audio URL returned and downloadable |
| 14 | Add mic button to widget `Composer.tsx`: hold-to-record using `MediaRecorder` API (WebM/Opus codec); show recording indicator during hold; on release upload blob to `/voice-message`; display transcription as customer message text; auto-play audio reply; show text bubble alongside audio | `apps/widget/src/components/Composer.tsx` | widget-embed-iframe | Hold mic → recording indicator; release → transcription appears; AI reply plays audio; full round-trip < 8s on good connection |

### 6.2 — Twilio phone bridge

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 15 | Create `voice.routes.ts`: `POST /voice/twiml` (no auth; Twilio calls this) returns TwiML `<Response><Stream url="wss://{host}/voice/phone"/></Response>`. Add WebSocket upgrade handler at `/voice/phone`: receive Twilio Media Streams binary audio → accumulate into speech segments by silence detection (250ms silence = segment end) → `stt.service.ts` transcribe → `generateAiReply()` → `tts.service.ts` synthesize → stream mulaw audio bytes back to Twilio. Create `Conversation` record with `channel: "phone"` | `apps/api/src/routes/voice.routes.ts`, `apps/api/src/index.ts` (WebSocket upgrade) | express-mongoose-scaffold | Twilio call to configured number → AI greets verbally; speech transcription visible in operator inbox; conversation record with `channel:"phone"` in Mongo |

### Wrap-up

| # | Task | Files touched | Acceptance |
|---|------|---------------|------------|
| 16 | Run `pnpm build`, `pnpm type-check`, `pnpm test`; fix failures | — | All green |
| 17 | Update spec 34 + this plan with deltas; write `CHANGELOG_N.md` | `__specs/34-trust-compliance-voice.md`, `__plans/18-trust-compliance-voice.md`, `CHANGELOG_N.md` | Docs match shipped behavior |

## Decisions baked in

- PII redaction masks before the LLM prompt only; stored Messages are unmasked — operators need to read full conversations in inbox.
- Rate limit uses Redis where available; in-memory Map fallback prevents hard dependency on Redis for this feature.
- `ABUSE_PATTERNS` is an env var (JSON array) so patterns can be updated without code deploy.
- Data residency shipped as a read-only stub (Option C from spec); no infrastructure routing changes.
- STT/TTS default to OpenAI (existing key, no new account needed); switch providers via env vars.
- Voice audio stored on S3 with same `attachments.service.ts` pattern used for file uploads.
- `dataRegion` is not settable via `PATCH` API — prevents accidental or malicious changes; requires a manual migration.

## Verification

- [ ] With `piiRedaction: true` enabled: customer sends "my email is test@example.com, phone 555-1234" → LLM prompt contains `[EMAIL]` and `[PHONE]`; `ContactSession.email` still `test@example.com` in Mongo.
- [ ] Unit test: `maskPii()` masks email, phone, credit card, SSN, NI Number.
- [ ] 31st message in 60s from same session → 429; 30th → 200.
- [ ] Prompt injection string (`ignore previous instructions`) in message → conversation auto-escalated; `abuseSuspected:true` in Mongo; no AI reply.
- [ ] Audit trail tab in inbox: refund tool call shows masked amount, status badge "guardrail_blocked", duration.
- [ ] Export: CSV downloads with columns `timestamp,role,content`; link expires in 1h.
- [ ] Data residency chip visible in settings; `PATCH /organizations/:id {dataRegion:"eu"}` ignored; Mongo unchanged.
- [ ] Browser voice: hold mic 3s, speak → transcription appears; AI text + audio reply within 8s.
- [ ] (If Twilio configured) Phone call → AI greets; transcript appears in inbox with `channel:"phone"`.
- [ ] `pnpm build`, `pnpm type-check` green.

## Out of scope

- Data residency routing (multi-region MongoDB / regional deployments) — deferred per Option C decision.
- Inbound webhook signature verification for abuse reporting.
- Browser push notifications (separate service worker work).
- Real-time transcription display while speaking (streaming STT).
- Voice biometric identity verification.
