# Phase 5 — Widget Polish Bundle

> Post-v1 enhancement phase. Spec: [`__specs/22-widget-enhancements.md`](../__specs/22-widget-enhancements.md). Builds on Phase 2 ([`03-phase2-widget-sockets.md`](./03-phase2-widget-sockets.md)).

## Goal

Three independent widget improvements: (1) a modern filled send icon with refined sizing/positioning, (2) widget appearance fetched by `agentId` on load so preference changes never require re-copying the embed snippet, and (3) attachment previews plus content extraction that feeds file text to the AI. After this phase, a visitor can drop in an unchanged embed snippet, see correctly-styled UI driven by the operator's saved settings, upload a PDF, and have the AI answer from its contents.

## Prerequisites

- Phase 2 green (widget + embed + AI agent end-to-end).
- KB parser available (`apps/api/src/services/kb/parsers.ts` — `parseFile()`), from Phase 3.
- `API_BASE_URL` set (used for absolute attachment URLs).
- Widget + embed build/run loop understood (env inlined at build time — rebuild after env changes).

## Skills to invoke

- [[__skills/widget-embed-iframe]] — widget app + embed loader changes (all three features).
- [[__skills/express-mongoose-scaffold]] — new route + model field (features 2, 3).
- [[__skills/webapp-testing]] — Playwright + `chrome-devtools-mcp` verification.

## Work breakdown (ordered)

### Feature 1 — Send icon + sizing/positioning

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 1 | Replace outline send glyph with a filled paper-plane (`fill="currentColor"`); enlarge button to `h-10 w-10`; add hover/active/disabled states (disabled = 45% opacity) | `apps/widget/src/components/Composer.tsx` | widget-embed-iframe | Send button renders filled glyph; disabled when input empty; no layout shift |
| 2 | Resize iframe panel to `400 × min(680px, calc(100dvh - 48px))`; launcher to 60px @ 20px offset; add hover-scale + open/close cross-fade; tighten mobile offsets to 8px | `apps/embed/src/widget.ts` (`injectStyles`, `positionCss`) | widget-embed-iframe | Panel/launcher use new sizes desktop + mobile; full-screen on `≤480px` intact |

### Feature 2 — Appearance fetched by `agentId`

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 3 | Factor `resolveAppearance(agentId)` from `resolveWidgetContext` (no website/session); add `GET /widget/appearance?agentId=` returning `{position,primaryColor,theme,launcherIcon,title}` with schema-default fallback, `Cache-Control: public, max-age=60` | `apps/api/src/routes/widget.routes.ts` | express-mongoose-scaffold | `curl .../widget/appearance?agentId=<valid>` → 200 cosmetic JSON, **no** session row created (`mongo-mcp`); malformed id → 400; inactive agent → 404 |
| 4 | Embed: on bootstrap fetch appearance from API origin; apply to launcher + seed iframe params; precedence `data-* > fetched > default`; resolve API origin via `data-api-url` → `VITE_API_URL` → widget origin (warn) | `apps/embed/src/widget.ts` | widget-embed-iframe | Launcher styled from saved settings with only `data-agent` on the tag; `data-*` still overrides |
| 5 | Add `VITE_API_URL` to `.env.example` + `apps/embed/.env.local`; document in spec 19 | `.env.example`, `apps/embed/.env.local`, `__specs/19-local-development.md` | — | Embed build bakes API origin; `verify:env` passes |

### Feature 3 — Attachment preview + extraction

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 6 | Return **absolute** attachment URL (`${API_BASE_URL}/api/v1/widget/attachments/{sha}`) from upload + download metadata; widen MIME allowlist to match `parseFile` (add docx/excel/csv/markdown) | `apps/api/src/routes/widget.routes.ts` | express-mongoose-scaffold | Uploaded file link opens from widget origin without 404 |
| 7 | Add `extractedText?: string` to the attachment subdoc | `apps/api/src/models/Message.ts` | express-mongoose-scaffold | `type-check` green; field persists |
| 8 | On upload, run `parseFile()` for supported types under `ATTACHMENT_EXTRACT_MAX_BYTES`; store truncated (`ATTACHMENT_EXTRACT_MAX_CHARS`) text in `extractedText`; failures non-fatal (log + omit) | `apps/api/src/routes/widget.routes.ts`, `apps/api/src/services/kb/parsers.ts` (reuse) | express-mongoose-scaffold | PDF upload → `extractedText` populated (`mongo-mcp`); oversize → marker; corrupt file → uploads anyway |
| 9 | Include attachment `extractedText` as a delimited block in the AI user turn, respecting existing size guards | `apps/api/src/services/ai/agent.service.ts` | express-mongoose-scaffold | Ask "what's in this file?" after PDF upload → AI answers from content |
| 10 | Add the env vars (`ATTACHMENT_EXTRACT_MAX_CHARS=8000`, `ATTACHMENT_EXTRACT_MAX_BYTES=5242880`) to `.env.example` + `apps/api/.env` | `.env.example`, `apps/api/.env`, `apps/api/src/config/env.js` | — | `env.js` validates them; defaults applied |
| 11 | Widget message list: render `image/*` as inline thumbnail (click → full), other types as file chip (icon + name + size) | `apps/widget/src/components/MessageList.tsx`, `apps/widget/src/lib/api-client.ts` (types) | widget-embed-iframe | Image → thumbnail; PDF → chip; both open correctly |
| 12 | (defer-able) Mirror the preview renderer in the operator inbox thread | `apps/web` thread component | widget-embed-iframe | Operator sees same previews |

### Wrap-up

| # | Task | Files touched | Acceptance |
|---|------|---------------|------------|
| 13 | Rebuild widget + embed; restart; smoke-test all three features end-to-end | — | All acceptance checks below green |
| 14 | Update spec 22 + this plan with any deltas discovered during build; write `CHANGELOG_1.md` (this session's changes only) | `__specs/22-widget-enhancements.md`, `__plans/06-widget-polish.md`, `CHANGELOG_1.md` | Docs match shipped behavior |

## Decisions baked in (from spec)

- Send button 40px, filled glyph; panel 400×680 (dvh-capped); launcher 60px @ 20px.
- Appearance endpoint is public, session-free, cosmetic-only.
- Extraction is synchronous on upload, under size cap, non-fatal on failure; no image OCR.

## Open questions (default if unanswered)

- **O1** Pressed-shade for send button → default `filter: brightness(0.92)`, no new setting.
- **O2** Operator-chosen launcher icon → field shipped `null`, no Studio UI this phase.
- **O3** Image OCR/vision → out of scope.
- **O4** Extraction caps as env vars → yes (`ATTACHMENT_EXTRACT_MAX_CHARS=8000`, `ATTACHMENT_EXTRACT_MAX_BYTES=5242880`).

## Verification

- [ ] `pnpm build`, `pnpm type-check`, `pnpm test` green.
- [ ] Send button: filled glyph, correct states, no layout shift; panel/launcher new sizes; mobile full-screen intact.
- [ ] Change position/color/theme in Widget Studio → host page launcher restyles **without** editing the snippet (only `data-agent` on the tag).
- [ ] `GET /widget/appearance` creates no `ContactSession` (`mongo-mcp`).
- [ ] Image upload → inline thumbnail; PDF upload → file chip; links open (no 404) from the tunnel/widget origin.
- [ ] PDF upload + "what does this say?" → AI answers from extracted text; `Message.attachments[].extractedText` populated (`mongo-mcp`).
- [ ] `chrome-devtools-mcp`: zero console errors across launcher → chat → upload → AI reply.

## Out of scope (defer)

- Image OCR / vision-model file understanding.
- Launcher-icon picker in Widget Studio.
- Attachment virus scanning; large-file async extraction queue.
- Operator-thread preview parity may slip to a follow-up (task 12).
