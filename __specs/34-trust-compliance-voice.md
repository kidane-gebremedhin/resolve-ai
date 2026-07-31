# 34 — Trust, Compliance & Voice: Tiers 5–6

> **Status**: ✅ IMPLEMENTED — see `CHANGELOG_10.md` and `__plans/18-trust-compliance-voice.md`
> **Depends on**: spec 30 § 2A.8 (PII masking helper reused here)
> **Blocks**: nothing (standalone post-launch workstream)
> **Implementation plan**: `__plans/18-trust-compliance-voice.md`

---

## Overview

Tier 5 unlocks enterprise sales by meeting compliance requirements. Tier 6 adds
voice channels post-MVP. None of these block the initial product launch.

---

# TIER 5 — Trust & Compliance

## 5.1 — PII redaction before LLM call

### Problem
Customers include email addresses, phone numbers, and credit card numbers in chat
messages. These are sent raw to the LLM via OpenRouter. Regulated buyers
(healthcare, finance, EU/UK) require redaction.

### Design

**Shared helper** (`apps/api/src/services/integrations/piiMask.ts`) was introduced
in spec 30 § 2A.8 for audit log masking. Reuse and extend it here.

The same function `maskPii(text: string): string` is used in two places:
1. **Audit log** (spec 30): masks tool call args before writing `ToolCallLog`.
2. **LLM preprocessing** (this spec): masks customer messages before `callLlm()`.

**PII patterns** (extend the list from spec 30):
```typescript
const PII_PATTERNS = [
  { pattern: /\b[\w.+'-]+@[\w.-]+\.[a-z]{2,}\b/gi,      replacement: "[EMAIL]" },
  { pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: "[CREDIT_CARD]" },
  { pattern: /\b(?:SSN|Social Security)[\s:#-]*\d{3}-?\d{2}-?\d{4}\b/gi, replacement: "[SSN]" },
  { pattern: /\b\+?[\d\s()./-]{7,15}\d\b/g,             replacement: "[PHONE]" },
  // UK National Insurance
  { pattern: /\b[A-Z]{2}\d{6}[A-D]\b/gi,               replacement: "[NI_NUMBER]" },
];
```

**Where applied** — in `generateAiReply()`, before building the messages array:
```typescript
const sanitizedHistory = conversationHistory.map(msg => ({
  ...msg,
  content: maskPii(msg.content),
}));
const sanitizedCustomerMessage = maskPii(customerMessage);
```

> **Important caveat** — tools that act on identity (refunds, subscription lookup)
> need the real email. These tools are invoked **by the model**, not by the raw
> message text. The contact session's `email` field is passed directly from the
> `ContactSession` document (not from masked message content) in `dispatchToolCall()`.
> So masking the message is safe — the tool dispatcher always uses the authoritative
> session email.

**Per-org toggle**

Add `Organization.settings.piiRedaction: boolean` (default: `false` for existing
orgs; operators opt in from the `/app/settings` page). When `true`, apply
`maskPii()` in `generateAiReply()`.

For enterprise plans: make it enforced and non-toggleable via plan gating.

**New env vars**

| Variable | Description |
|---|---|
| `PII_REDACTION_ENABLED` | Global default for PII redaction (`"true"` / `"false"`, default: `"false"`) |

### Acceptance
- [ ] Customer sends "My email is test@example.com" → LLM receives "[EMAIL]".
- [ ] CC pattern masked → LLM receives "[CREDIT_CARD]".
- [ ] Tool dispatcher still uses session email (not masked) for identity verification.
- [ ] Toggle in `/app/settings` shows "PII Redaction" toggle; saving stores to `Organization.settings`.

---

## 5.2 — Per-session audit trail

### Problem
Operators have no visibility into what actions the AI took on their behalf during
a conversation (e.g. "Did the AI actually issue that refund?").

### Design

This is the **operator-facing UI** surface of the `ToolCallLog` collection
introduced in spec 30 § 2A.8.

**New API endpoint**

```
GET /conversations/:conversationId/audit-trail
Auth: operator JWT (scoped to org)
Response: ToolCallLog[] sorted by createdAt ASC
```

**Dashboard — conversation detail view**

In the operator inbox conversation thread, add an "Audit Trail" tab alongside
"Messages":

```
AI booked a meeting       2026-06-20 14:02:11  ✓ success  120ms
Args: { slotId: "...", attendeeName: "Alice", attendeeEmail: "[EMAIL]" }
Result: { bookingId: "BK-1234", confirmationUrl: "..." }

AI attempted refund       2026-06-20 14:05:31  ✗ blocked (guardrail)
Args: { amount: 15000, orderId: "ORD-5678" }
Reason: Amount $150 exceeds maximum $100
```

The per-message inline strip (spec 30 § 2A.8) shows a one-liner; this tab shows
the full detail.

### Acceptance
- [ ] Audit trail tab visible in conversation detail.
- [ ] Shows all tool calls, args (PII-masked), result, status, duration.
- [ ] Guardrail-blocked entries shown with the block reason.

---

## 5.3 — Transcript export

### Problem
Enterprise customers want downloadable records of conversations for their own
compliance archives.

### Design

**New API endpoint**

```
POST /conversations/:conversationId/export
Auth: operator JWT
Body: { format: "csv" | "json" }
Response: { downloadUrl: string, expiresAt: string }
```

Implementation:
1. Fetch all `Message` documents for the conversation.
2. Serialize to the requested format.
3. Upload to S3/local storage as a signed temporary object:
   - Path: `exports/<orgId>/<conversationId>/<timestamp>.<ext>`
   - Pre-signed URL with 1-hour TTL (S3) or signed token in API route (local).
4. Return the URL.

The existing signed-URL / S3 infrastructure from attachment handling
(`attachments.service.ts`) can be reused here.

**CSV format**:
```
Timestamp,Role,Sender,Content
2026-06-20T14:02:11Z,customer,Alice,"Hello, I need help..."
2026-06-20T14:02:15Z,ai,Support Agent,"Sure! Let me look that up..."
```

**JSON format**: array of `Message` documents (stripped of internal IDs for privacy).

**Dashboard UI**: "Export transcript" button in conversation detail header
(operator only). Opens a toast "Download ready" with a link.

**Bulk export** (optional, enterprise): `POST /organizations/:orgId/export` with
a date range → zip of all conversations. Runs as a background job; emails the
operator when ready.

### Acceptance
- [ ] Export button generates a download link in < 5 s for conversations < 500 messages.
- [ ] CSV opens in Excel with correct columns.
- [ ] Download URL expires after 1 hour.

---

## 5.4 — Data residency flag

### Problem
EU customers require personal data to stay within EU data centers.

### Design

> **Major architectural blocker — user action required.**
>
> Data residency is **not a feature toggle**. It requires:
> 1. **MongoDB**: multi-region clusters (Atlas Global Clusters, or separate EU
>    cluster). Data must be stored in the EU region; queries must not cross regions.
> 2. **Pinecone**: separate EU index (Pinecone supports regional pods — GCP EU West).
> 3. **File storage**: separate S3 bucket in `eu-west-*` or `eu-central-*` region.
> 4. **API deployment**: a second API instance deployed in an EU region (e.g. via
>    Coolify on an EU VPS), routing EU org requests to EU data stores.
>
> This is a **2–4 week infrastructure project** before any code ships.
>
> **Decision required**: choose the residency model:
> - **Option A** — EU-only: serve all customers from EU. Simplest; loses US latency.
> - **Option B** — US + EU dual-region: route by `Organization.dataRegion`. Requires
>   org-at-creation-time region selection; can't easily migrate later.
> - **Option C** — Defer entirely: offer data residency as a custom enterprise
>   contract with dedicated infrastructure per-customer.
>
> **Recommendation**: Option C for initial enterprise deals; return to Option B when
> a second region deployment is operationally mature.

**Minimum code stub (ship with Option C)**:

Add `Organization.dataRegion: "us" | "eu"` (default: "us"). Show in `/app/settings`
as a read-only field ("Contact us to migrate"). This signals the feature to
enterprise prospects without requiring the infrastructure immediately.

---

## 5.5 — Rate limit + abuse detection (widget)

### Problem
A malicious actor can flood the widget with messages (DoS the AI pipeline, inflate
billing usage).

### Design

**Per-`contactSessionId` rate limiting**

```typescript
// apps/api/src/middleware/widgetRateLimit.ts
const WIDGET_MESSAGE_LIMIT = { requests: 30, windowMs: 60_000 };  // 30 msg/min

async function widgetRateLimit(req, res, next) {
  const sessionId = req.contactSession._id.toString();
  const key = `widget:rl:${sessionId}`;

  if (redis) {
    const count = await redis.incr(key);
    if (count === 1) await redis.pexpire(key, WIDGET_MESSAGE_LIMIT.windowMs);
    if (count > WIDGET_MESSAGE_LIMIT.requests) {
      return res.status(429).json({ error: "Too many messages. Please wait a moment." });
    }
  }
  next();
}
```

Apply this middleware to `POST /widget/conversations/:id/messages`.

**Abuse detection**

Beyond rate limiting, flag sessions for human review when:
- More than 100 messages in a single conversation.
- Message content matches known abuse patterns (profanity, PII harvesting attempts,
  prompt injection signatures).

```typescript
const ABUSE_PATTERNS = [
  /ignore (previous|prior|above) instructions/i,
  /you are now (a|an) (DAN|jailbreak)/i,
  /repeat (your|the) (system|system prompt|instructions)/i,
];

function detectAbuse(content: string): boolean {
  return ABUSE_PATTERNS.some(p => p.test(content));
}
```

When abuse is detected: save the message, skip AI reply, auto-escalate to an
operator, flag the `ContactSession` with `abuseSuspected: true`.

**New env vars**

| Variable | Description |
|---|---|
| `WIDGET_RATE_LIMIT_REQUESTS` | Max messages per window per session (default: `30`) |
| `WIDGET_RATE_LIMIT_WINDOW_MS` | Rate limit window in ms (default: `60000`) |

### Acceptance
- [ ] Sending 31 messages/min returns 429 on the 31st.
- [ ] Prompt injection pattern detected → conversation auto-escalated; `ContactSession.abuseSuspected: true`.

---

# TIER 6 — Voice (post-MVP)

## 6.1 — Browser-mic voice

### Problem
Text chat excludes customers who prefer speaking. Voice reduces resolution time
for complex issues.

### Design overview

**Architecture**:
```
Widget (browser mic) → WebRTC audio → API voice endpoint
→ STT (Speech-to-Text) → existing LLM pipeline → TTS (Text-to-Speech) → audio back to widget
```

This reuses: same KB, same tools, same transcript storage. Adds audio I/O layer.

**STT provider options** (pick one):
- **OpenAI Whisper API** (`WHISPER_API_KEY` = same as `OPENROUTER_API_KEY` if using
  OpenAI directly): `POST /audio/transcriptions`. Low latency, good accuracy.
- **Deepgram** (`DEEPGRAM_API_KEY`): streaming STT, better real-time latency.
  Preferred for voice where streaming matters.

**TTS provider options**:
- **OpenAI TTS** (`TTS_MODEL`: `tts-1`, voice: `nova`): `POST /audio/speech`.
- **ElevenLabs** (`ELEVENLABS_API_KEY`): higher quality, higher cost.
- **Cartesia** (`CARTESIA_API_KEY`): low latency, good for real-time.

**API changes**:

New endpoint: `POST /widget/conversations/:id/voice-message`
- Accepts `multipart/form-data` with `audio` file (WebM/Opus, max 25 MB).
- Server transcribes via STT → runs `generateAiReply()` with transcribed text.
- Synthesizes AI reply text → TTS audio file stored in S3.
- Returns `{ messageId, audioUrl }`.

**Widget UI changes**:

New "mic" button in `Composer.tsx`. On hold → records via `MediaRecorder` API.
On release → uploads audio blob, shows transcription + plays audio reply.
`getUserMedia({ audio: true })` is called **only** inside `startRecording()` (the mic
button press) — never on mount — so the browser only prompts for the microphone when the
visitor presses the button.

**Microphone permission is not requested on page load (2026-07 batch).** The embed
(`apps/embed/src/widget.ts`) delegates `microphone` to the widget iframe's `allow`
attribute **only when voice input is enabled**; otherwise the iframe is created with
`allow="clipboard-write; autoplay"`. Requesting the capability unconditionally made some
browsers show a device-permission prompt ("… would like to access other services on this
device") on page load, before the visitor interacted with anything — voice input is off by
default (`ALLOW_WIDGET_VOICE_INPUT=false`). The embed reads the flag from
`GET /widget/appearance` (which now returns `voiceInput`) before creating the iframe.

**Latency targets**:
- STT: < 1 s for < 10 s clips (Deepgram streaming).
- LLM: existing pipeline (~2–4 s).
- TTS: < 1 s for typical AI reply lengths.
- Total: < 5 s end-to-end. Acceptable for voice chat; display "Thinking..."
  animation during processing.

### User actions required

> 1. **Choose STT provider**: sign up for Deepgram (`deepgram.com`) or use existing
>    OpenAI key. Add `DEEPGRAM_API_KEY` (or confirm `OPENROUTER_API_KEY` reaches
>    OpenAI Whisper).
> 2. **Choose TTS provider**: sign up for ElevenLabs (`elevenlabs.io`) or
>    Cartesia (`cartesia.ai`). Add the respective API key to `.env.example`.
> 3. Verify browser microphone permission UX (needs HTTPS in production).

### New env vars

| Variable | Description |
|---|---|
| `STT_PROVIDER` | `"deepgram"` \| `"openai_whisper"` (default: `"openai_whisper"`) |
| `DEEPGRAM_API_KEY` | Deepgram API key (if STT_PROVIDER = deepgram) |
| `TTS_PROVIDER` | `"openai"` \| `"elevenlabs"` \| `"cartesia"` (default: `"openai"`) |
| `ELEVENLABS_API_KEY` | ElevenLabs API key (if TTS_PROVIDER = elevenlabs) |
| `CARTESIA_API_KEY` | Cartesia API key (if TTS_PROVIDER = cartesia) |
| `TTS_VOICE_ID` | Voice ID (provider-specific; default: `"nova"` for OpenAI) |

### Blockers
- Browser microphone requires HTTPS (already required in production).
- Mobile browsers have inconsistent `MediaRecorder` support; test on iOS Safari.
- Streaming STT (Deepgram) requires a WebSocket from the API to Deepgram — adds
  complexity; start with batch (Whisper) and upgrade to streaming if latency is
  too high.

---

## 6.2 — Twilio phone bridge

### Problem
Some customers prefer to call a phone number rather than use web chat.

### Design overview

**Architecture**:
```
Customer calls Twilio number → Twilio Media Streams (WebSocket) → API phone endpoint
→ STT → LLM pipeline → TTS → audio back to Twilio → played to customer
```

Same KB, tools, transcript. Only the I/O changes.

**Twilio setup**:
1. Buy a Twilio phone number.
2. Configure a TwiML App: on incoming call → `<Stream>` to WebSocket URL
   `wss://{API_BASE_URL}/api/v1/voice/phone`.
3. API opens a WebSocket handler at `/voice/phone`:
   - Receives audio chunks from Twilio.
   - Buffers and detects silence (end of utterance).
   - Runs STT on the buffered audio.
   - Runs `generateAiReply()`.
   - Runs TTS on the reply.
   - Streams TTS audio back to Twilio via the WebSocket.

**Transcript**: Every call creates a `Conversation` with `channel: "voice_phone"`.
Messages stored normally. Operators can see call transcripts in the inbox.

### User actions required

> 1. **Sign up for Twilio** (`twilio.com`). Obtain:
>    - Account SID (`TWILIO_ACCOUNT_SID`)
>    - Auth token (`TWILIO_AUTH_TOKEN`)
>    - A purchased phone number (`TWILIO_PHONE_NUMBER`)
> 2. Configure the TwiML App at `console.twilio.com`:
>    - Voice URL (webhook): `{API_BASE_URL}/api/v1/voice/twiml`
>    - WebSocket Media Stream URL: `wss://{API_BASE_URL}/api/v1/voice/phone`
> 3. The API domain must be publicly accessible (HTTPS + WSS) — already required
>    for production.

### New env vars

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Twilio phone number (E.164 format, e.g. `+15551234567`) |

### Blockers
- Media Streams WebSocket latency must be < 300 ms per audio chunk to avoid
  noticeable lag. Test extensively before launch.
- Twilio charges per minute; set a per-call cost alert in the Twilio console.
- STT + TTS latency is the primary bottleneck; streaming STT (Deepgram) is
  likely required for acceptable voice UX.

---

## Files summary (Tier 5)

| File | Change |
|---|---|
| `apps/api/src/services/integrations/piiMask.ts` | Extend patterns (already created in spec 30) |
| `apps/api/src/services/ai/agent.service.ts` | Apply `maskPii()` before LLM call when enabled |
| `apps/api/src/models/Organization.ts` | Add `settings.piiRedaction` + `dataRegion` |
| `apps/api/src/middleware/widgetRateLimit.ts` | New — per-session rate limit + abuse detection |
| `apps/api/src/routes/conversations.routes.ts` | `GET /audit-trail`, `POST /export` |
| `apps/web/src/app/(dashboard)/app/inbox` | Audit trail tab, export button |
| `apps/web/src/app/(dashboard)/app/settings` | PII redaction toggle, data region display |

## Files summary (Tier 6)

| File | Change |
|---|---|
| `apps/api/src/services/voice/stt.service.ts` | New — STT abstraction (Whisper / Deepgram) |
| `apps/api/src/services/voice/tts.service.ts` | New — TTS abstraction (OpenAI / ElevenLabs / Cartesia) |
| `apps/api/src/routes/voice.routes.ts` | New — `/voice/twiml`, WebSocket `/voice/phone` |
| `apps/api/src/routes/widget.routes.ts` | `POST /voice-message` endpoint |
| `apps/widget/src/components/Composer.tsx` | Mic button, MediaRecorder, audio playback |

## Acceptance (Tier 5)

- [ ] Message with `test@example.com` → LLM receives "[EMAIL]" (verify via `ToolCallLog` or logging).
- [ ] Audit trail shows all tool calls for a conversation.
- [ ] Transcript export returns a valid CSV/JSON download with a 1-hour-expiring URL.
- [ ] 31 messages in 1 minute → 429 on message 31.
- [ ] Prompt injection detected → conversation escalated, `ContactSession.abuseSuspected: true`.

## Acceptance (Tier 6)

- [ ] Browser: click mic, speak, release → transcript shown, AI reply plays as audio.
- [ ] Phone: call Twilio number → hear AI greeting → speak → AI responds verbally.
- [ ] Call transcript visible in operator inbox.
- [ ] End-to-end latency < 5 s on a 10-word utterance.
