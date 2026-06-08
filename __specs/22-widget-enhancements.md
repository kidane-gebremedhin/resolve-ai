# 22 — Widget Enhancements (Polish Bundle)

## Overview

Post-v1 enhancement spec covering three widget-facing improvements requested in the product backlog. These build on the Phase 2 widget/embed architecture ([`09-widget-state-machine.md`](./09-widget-state-machine.md), [`__plans/03-phase2-widget-sockets.md`](../__plans/03-phase2-widget-sockets.md)) and the widget API ([`07-api-specification.md`](./07-api-specification.md)). The implementation plan is [`__plans/06-widget-polish.md`](../__plans/06-widget-polish.md).

The three features:

1. **Modern send icon + refined widget sizing/positioning** — purely presentational; embed CSS + composer.
2. **Appearance fetched by `agentId` on load** — so updating widget preferences never requires re-copying the embed snippet.
3. **Attachment preview + content extraction** — render inline previews and feed extracted attachment text to the AI so it understands files the visitor sends.

Each feature is independently shippable; they share no hard ordering except that all three touch the widget build (rebuild once at the end).

---

## Current state (as of this spec)

| Concern | Where | Today |
|---------|-------|-------|
| Send button | [`apps/widget/src/components/Composer.tsx:204-216`](../apps/widget/src/components/Composer.tsx) | Outline paper-airplane SVG (`polygon`), 36px (`h-9 w-9`) circle, `primaryColor` background |
| Iframe / launcher size + position | [`apps/embed/src/widget.ts:214-277`](../apps/embed/src/widget.ts) | Iframe 380×600 fixed; launcher 56px; 24px offset; position from `positionCss()` |
| Appearance source | embed `data-*` attrs → iframe query params; `/widget/init` also returns saved `WidgetSettings` | Widget UI **already** prefers saved settings over `data-*` (`WidgetRoot.tsx`). Launcher (pre-iframe) still uses `data-*` only. No session-free appearance endpoint. |
| Attachment URL | [`apps/api/src/routes/widget.routes.ts:480`](../apps/api/src/routes/widget.routes.ts) | Returns API-**relative** path `/api/v1/widget/attachments/{sha}` |
| Attachment render | [`apps/widget/src/components/MessageList.tsx:115-135`](../apps/widget/src/components/MessageList.tsx) | Plain `<a href>` link; **no preview**; href resolves against widget origin (`:3001`) → 404 cross-origin |
| Attachment → AI | [`apps/api/src/services/ai/agent.service.ts:252-271`](../apps/api/src/services/ai/agent.service.ts) | Only `message.content` is sent; attachment bytes/text are **never extracted or seen by the AI** |
| Reusable extractor | [`apps/api/src/services/kb/parsers.ts`](../apps/api/src/services/kb/parsers.ts) | `parseFile()` extracts text from PDF/DOCX/Excel/CSV/HTML/text — the "existing flow" to reuse |

---

## Feature 1 — Modern send icon + sizing/positioning

### Goals
- Send button reads as a modern, **filled** action (reference: Intercom / Crisp / Drift composers): solid accent fill, filled glyph, clear hover/active/disabled states, comfortable tap target.
- Panel and launcher sized and positioned to current best-practice defaults; graceful on small viewports.

### Decisions
- **Send glyph**: filled paper-plane (single `path` with `fill="currentColor"`), white on the accent-filled button. Disabled state at 45% opacity, not color-shifted.
- **Send button size**: 40px (`h-10 w-10`) circle, up from 36px; 18–20px glyph.
- **Panel size**: `width: 400px` (from 380); `height: min(680px, calc(100dvh - 48px))` (from fixed 600). Use `dvh` so mobile browser chrome doesn't clip it.
- **Launcher**: 60px (from 56); offset 20px (from 24); add subtle scale-on-hover + open/close cross-fade.
- **Mobile (`≤480px`)**: the panel is **true fullscreen** — `inset: 0`, `width: 100vw`,
  `height: 100dvh`, no border-radius, all set with `!important` so the widget's
  `csb:resize` messages can't shrink it back to a desktop card (the resize handler
  also early-returns on this breakpoint). The launcher sits **one z-index above**
  the iframe (`2147483647` vs `2147483646`) so it stays visible and tappable on top
  of the fullscreen panel — it toggles to a ✕ to close. (Earlier it shared the
  iframe's z-index and was painted over once the panel opened.)
- **Persistent sections bar**: the configured section shortcuts stay pinned at the
  bottom of the widget **during a conversation** (`SectionsBar`), so they don't
  disappear once the visitor starts chatting. Tapping a chip opens a `link`, or
  sends the `topicPrompt` (falling back to the title) into the **current**
  conversation rather than starting a new one. Hidden while the contact-prompt
  overlay is forcing the composer closed.
- **Sections panel before the first message** _(Changelog 28)_: there is no
  separate full-screen sections state. Before a conversation starts, the configured
  sections render as a scrollable `SectionCard` panel **floating over the bottom of
  the transcript, just above the composer** in `pre_chat`, so a new visitor can
  either tap a topic or type their own message. The panel is shown until the first message is sent (then the view is
  `chat_active`, where the compact `SectionsBar` takes over). See
  [09-widget-state-machine.md](./09-widget-state-machine.md).

### Open questions (flag in plan, default if unanswered)
- O1: Match the accent color exactly, or introduce a darker "send-pressed" shade? → Default: derive pressed shade via CSS `filter: brightness(0.92)`, no new setting.

### Files
- [`apps/widget/src/components/Composer.tsx`](../apps/widget/src/components/Composer.tsx) — glyph + button sizing/states.
- [`apps/embed/src/widget.ts`](../apps/embed/src/widget.ts) — `injectStyles()` iframe + launcher dimensions, offsets, transitions, mobile fullscreen + launcher z-index, `isFullscreenViewport()` resize guard.
- [`apps/widget/src/components/SectionsBar.tsx`](../apps/widget/src/components/SectionsBar.tsx) — persistent bottom sections bar shown during a conversation.
- [`apps/widget/src/components/PreChatScreen.tsx`](../apps/widget/src/components/PreChatScreen.tsx) — renders the sections `SectionCard` panel above the composer before the first message _(Changelog 28)_.
- [`apps/widget/src/components/WidgetRoot.tsx`](../apps/widget/src/components/WidgetRoot.tsx) — renders `SectionsBar` on chat states; `handleSectionShortcut`. Boot routes a no-conversation visitor to `pre_chat` (the standalone `sections` state was removed in Changelog 28).

---

## Feature 2 — Appearance fetched by `agentId` on load

### Problem
Operators currently bake `data-position` / `data-primary-color` / `data-theme` into the embed `<script>`. Changing a preference in Widget Studio means re-copying the snippet. The widget *iframe* already self-corrects from `/widget/init`, but the **launcher** (shown before the iframe opens) and any host that copied an old snippet stay stale.

### Design
Add a **public, unauthenticated, side-effect-free** appearance endpoint and have the embed loader fetch it on bootstrap.

**New endpoint:** `GET /api/v1/widget/appearance?agentId=<24-hex>`
- Returns only cosmetic, non-sensitive fields; **creates no session** (contrast with `POST /widget/init`):
  ```json
  { "position": "bottom-right", "primaryColor": "#7c3aed", "theme": "auto",
    "launcherIcon": null, "title": "Support" }
  ```
- Resolves `WidgetSettings` by `agentId` (reusing the `agentId → agent → org` resolution already in `resolveWidgetContext`, minus website/session). Falls back to schema defaults when no settings doc exists.
- 400 on malformed `agentId`; 404 only if the agent itself is inactive/missing.
- Cache-friendly: `Cache-Control: public, max-age=60`.

**Embed loader change** ([`apps/embed/src/widget.ts`](../apps/embed/src/widget.ts)):
- On bootstrap, if `agentKey` present, `fetch()` appearance from the API origin, then style the launcher (and seed the iframe query params) from the response.
- `data-*` attributes become **optional overrides**: precedence `data-* attr > fetched appearance > built-in default`.
- The embed must know the **API origin** (distinct from the widget origin). Add it as:
  - `data-api-url` attribute (**now emitted by the generated snippet** from `NEXT_PUBLIC_API_URL`, so the live fetch works on any host without relying on the embed build env), falling back to
  - `VITE_API_URL` baked at build time, falling back to
  - the widget origin (last-resort, logs a warning).

**CORS (critical):** the embed loader calls `GET /widget/appearance` from the **host page's origin** (an arbitrary customer site), not from the widget origin. The global CORS allowlist (`CORS_ORIGINS`) would block that, leaving the launcher stuck at the default position. So all public `/api/v1/widget/*` endpoints are mounted with **reflect-any-origin CORS** (`cors({ origin: true })`, no credentials — they authenticate via bearer session tokens, not cookies). Without this, position/color/theme never apply on a pasted snippet.

### Decisions
- Keep `data-agent` / `data-agent-id` required (unchanged) — it is the resolution key.
- The generated snippet emits `data-agent`, `data-widget-url`, and `data-api-url` only; cosmetics (position/color/theme) stay out of the snippet and are fetched live so Studio changes apply without re-copying.
- Public widget endpoints use permissive CORS; cookie-authed dashboard/admin routes keep the strict `CORS_ORIGINS` allowlist.
- Appearance endpoint returns a **stable, minimal** shape; it must never leak org-internal fields (no IDs, no quotas).
- `VITE_API_URL` is a **new env var** → add to [`.env.example`](../.env.example) and per-app `apps/embed/.env.local` (per repo env convention; see [`19-local-development.md`](./19-local-development.md)).

### Open questions
- O2: Should the operator be able to choose a launcher icon (the spec leaves `launcherIcon` nullable)? → Default: ship the field in the response as `null`, no Studio UI yet; wire it in a later item.

### Files
- [`apps/api/src/routes/widget.routes.ts`](../apps/api/src/routes/widget.routes.ts) — add `GET /appearance`; factor a `resolveAppearance(agentId)` helper from `resolveWidgetContext`.
- [`apps/embed/src/widget.ts`](../apps/embed/src/widget.ts) — fetch + apply appearance; API-origin resolution.
- [`.env.example`](../.env.example), `apps/embed/.env.local` — `VITE_API_URL`.

---

## Feature 3 — Attachment preview + content extraction

### Problem
Two defects in one: (a) previews don't render (and the link 404s cross-origin), and (b) the AI never sees attachment content, so a visitor who uploads a PDF and asks "what does this say?" gets a blind answer.

### Design

**3a. Fix attachment URLs (absolute).**
The upload endpoint must return an **absolute** URL built from `env.apiBaseUrl` (`API_BASE_URL`, already configured), so the widget at `:3001`/tunnel resolves it against the API:
- `fileUrl`/`url` → `${API_BASE_URL}/api/v1/widget/attachments/{sha}`.
- Fixes both widget and dashboard rendering.

**3b. Inline previews** ([`apps/widget/src/components/MessageList.tsx`](../apps/widget/src/components/MessageList.tsx)):
- `image/*` → inline thumbnail (`<img>` capped at ~160px, rounded, click opens full in new tab).
- PDF/doc/sheet/text → a **file chip**: type icon + filename + human size, linking to the file.
- Mirror the same renderer in the operator inbox thread — **shipped** (Changelog 18): see Feature 3d.

**3d. Operator (inbox) attachments — send & render.** _(Changelog 18.)_
Operators authenticate with a NextAuth bearer (not a widget session), so they get parallel, operator-authed endpoints over the **same** content-addressed storage:
- Shared logic lives in [`attachments.service.ts`](../apps/api/src/services/attachments.service.ts) (MIME allow-list, `org/<orgId>/<sha>.bin` key, multer, `extractAttachmentText`, `storeAttachment`, `streamStoredAttachment` with the cross-tenant guard + `Cross-Origin-Resource-Policy: cross-origin`). The widget routes reuse it.
- `POST /messages/attachments` (multipart, operator JWT, scoped to a conversation in the operator's org) and `GET /messages/attachments/:hash`; `POST /messages` accepts `attachments[]`.
- The dashboard `<img>`/link can't send the bearer header, so it loads files through a **same-origin Next proxy** ([`apps/web/.../api/attachments/[hash]/route.ts`](../apps/web/src/app/api/attachments/[hash]/route.ts)) that resolves the session server-side and forwards to the API with the bearer — no token in URLs, no CORP needed.
- The customer's widget renders operator-sent attachments by rewriting the stored `/messages/attachments/<sha>` path to the widget route `/widget/attachments/<sha>` (same key) before appending `?t=` ([`MessageList.tsx`](../apps/widget/src/components/MessageList.tsx)).

**3c. Content extraction → AI (reuse the existing KB flow).**
- At **upload time** (buffer in hand), route the file through `parseFile()` from [`parsers.ts`](../apps/api/src/services/kb/parsers.ts) for supported types (pdf/docx/excel/csv/html/text). Store the extracted text on the attachment.
- Persist a new optional field on `Message.attachments[]`: `extractedText?: string` (truncated to a configurable cap, default 8k chars — mirror the embedding batch guard). Add to [`apps/api/src/models/Message.ts`](../apps/api/src/models/Message.ts).
- In [`agent.service.ts`](../apps/api/src/services/ai/agent.service.ts), when building the user turn, append a delimited block per attachment:
  ```
  [Attachment: invoice.pdf]
  <extracted text, truncated>
  ```
  so the model answers from file content. Respect the existing token/size guards.
- **Images**: no OCR in this bundle (out of scope below). The filename is still surfaced to the model.

### Decisions
- Extraction happens **synchronously on upload** for files under a size cap (default 5 MB); larger files store the attachment but skip extraction and set `extractedText` to a marker (`"[file too large to read]"`). This keeps the chat responsive and avoids a job queue.
- Extraction failures are **non-fatal**: the attachment still uploads; `extractedText` is omitted and a warning logged.
- Widen the upload MIME allowlist to match `parseFile` support (add DOCX/Excel/CSV/markdown) — currently only `image/*`, `application/pdf`, `text/plain`.

### Open questions
- O3: Image OCR / vision-model understanding? → **Out of scope** for this bundle (separate item); only filename is surfaced.
- O4: Extraction cap (chars) and max-extract file size — confirm 8k chars / 5 MB defaults, or make them env vars (`ATTACHMENT_EXTRACT_MAX_CHARS`, `ATTACHMENT_EXTRACT_MAX_BYTES`)? → Default: env vars with those defaults (added to `.env.example`).

### Files
- [`apps/api/src/routes/widget.routes.ts`](../apps/api/src/routes/widget.routes.ts) — absolute URL; extract on upload; widen MIME allowlist.
- [`apps/api/src/models/Message.ts`](../apps/api/src/models/Message.ts) — `extractedText` on attachment subdoc.
- [`apps/api/src/services/ai/agent.service.ts`](../apps/api/src/services/ai/agent.service.ts) — include extracted text in the prompt.
- [`apps/widget/src/components/MessageList.tsx`](../apps/widget/src/components/MessageList.tsx) — preview renderer.
- [`apps/widget/src/lib/api-client.ts`](../apps/widget/src/lib/api-client.ts) — types (`extractedText`, absolute url).
- (defer) operator thread renderer in `apps/web`.

---

## Feature 4 — Suggested questions at the bottom of the widget _(Changelog 19)_

### Problem
Per-agent **Suggested questions** (set in `/app/widget`, persisted on `Agent.suggestedQuestions`, delivered to the widget as `agent.suggestedQuestions`) were rendered at the **top** of the pre-chat conversation area, left-aligned under a "Suggested" label — not matching the expected Chatbase-style placement.

### Design
- Render them as **right-aligned outlined pills pinned to the bottom**, just above the composer (like the customer's own message bubbles). Clicking a chip **sends it immediately** (`onStart`/`onSend`), and the chips disappear after the first message. Reference: Chatbase widget UI.
- Primary surface: [`PreChatScreen.tsx`](../apps/widget/src/components/PreChatScreen.tsx) (the first-visit entry view that also shows the welcome message). Also added to [`ChatScreen.tsx`](../apps/widget/src/components/ChatScreen.tsx) for an empty active conversation (shown only while `messages.length === 0`).
- Source precedence unchanged: `settings.suggestedQuestions ?? agent.suggestedQuestions`. Capped at 4.

---

## Cross-cutting notes

- **Rebuild discipline**: `NEXT_PUBLIC_*` (widget) and `VITE_*` (embed) are inlined at build time — rebuild widget + embed after env changes. See [`19-local-development.md`](./19-local-development.md).
- **RLS**: the appearance endpoint is public but exposes only cosmetic fields; the attachment download endpoint keeps its existing cross-tenant guard.
- **Env additions** (per repo convention, add to [`.env.example`](../.env.example)): `VITE_API_URL`, `ATTACHMENT_EXTRACT_MAX_CHARS`, `ATTACHMENT_EXTRACT_MAX_BYTES`.

## Out of scope (separate backlog items)
- Image OCR / vision understanding of screenshots.
- Operator-configurable launcher icon UI in Widget Studio.
- Attachment virus scanning.
- Streaming/real-time extraction for very large files (job queue).

## Acceptance
- [ ] Send button renders a filled modern glyph; panel/launcher use the new sizes; mobile full-screen intact; zero console errors.
- [ ] Changing position/color/theme in Widget Studio reflects on a host page **without** editing the embed snippet (launcher restyles from `GET /widget/appearance`).
- [ ] Visitor uploads an image → inline thumbnail; uploads a PDF → file chip; both links open (no 404).
- [ ] Visitor uploads a PDF and asks about its contents → AI answers from extracted text (verified via `mongo-mcp`: `Message.attachments[].extractedText` populated).
- [ ] `pnpm build` + `pnpm type-check` + `pnpm test` green.
