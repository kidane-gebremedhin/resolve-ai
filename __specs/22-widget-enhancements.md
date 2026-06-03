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
- **Mobile (`≤480px`)**: unchanged full-screen behavior, offsets tightened to 8px.

### Open questions (flag in plan, default if unanswered)
- O1: Match the accent color exactly, or introduce a darker "send-pressed" shade? → Default: derive pressed shade via CSS `filter: brightness(0.92)`, no new setting.

### Files
- [`apps/widget/src/components/Composer.tsx`](../apps/widget/src/components/Composer.tsx) — glyph + button sizing/states.
- [`apps/embed/src/widget.ts`](../apps/embed/src/widget.ts) — `injectStyles()` iframe + launcher dimensions, offsets, transitions.

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
  - optional `data-api-url` attribute, falling back to
  - `VITE_API_URL` baked at build time, falling back to
  - the widget origin (last-resort, logs a warning).

### Decisions
- Keep `data-agent` / `data-agent-id` required (unchanged) — it is the resolution key.
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
- Mirror the same renderer in the operator inbox thread ([`apps/web`](../apps/web)) for parity (secondary; can defer).

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
