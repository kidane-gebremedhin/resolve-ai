# Phase 16 — Rich Messages (Tier 3)

> **Status: COMPLETE** — all block types, OG previews, image vision, inline forms, and dispatcher `resultToBlocks()` implemented. See `CHANGELOG_8.md`.
>
> Roadmap Tier 3. Spec: [`__specs/32-rich-messages.md`](../__specs/32-rich-messages.md). Builds on Phase 13 ([`13-tier1-widget-polish.md`](./13-tier1-widget-polish.md)) and Phase 14 ([`14-integration-framework.md`](./14-integration-framework.md)).

## Goal

Add a `blocks` payload system to `Message` so the AI can send structured UI alongside (or instead of) prose text. Tool results are post-processed into interactive cards and carousels (calendar slots, subscription info), customer inputs can be gathered via inline forms that submit directly to tools, image attachments are analyzed via a vision model, and URLs in AI replies get automatic OG link preview cards. The result is a widget that feels like a native app rather than a chat bubble.

## Prerequisites

- Phase 13 green (Markdown renderer + `MessageList.tsx` blocks branch needed).
- Phase 14 green (`dispatcher.ts` exists for `resultToBlocks()` hook; `assertSafeUrl()` created there for reuse).
- `AI_VISION_MODEL` env var set (defaults to `AI_MODEL` value if absent).
- `AI_VISION_MAX_IMAGE_BYTES` env var set (default `4194304` — 4 MB).
- `sharp` and `node-html-parser` packages available in `apps/api`.

## Skills to invoke

- [[__skills/express-mongoose-scaffold]] — `Message.blocks` schema field, send-message route change.
- [[__skills/widget-embed-iframe]] — `BlockRenderer` component tree.
- [[__skills/webapp-testing]] — visual verification via `chrome-devtools-mcp`.

## Work breakdown (ordered)

### 3.0 — Message blocks foundation (prerequisite for all below)

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 1 | Create `apps/api/src/types/messageBlocks.ts` defining `MessageBlock` as a discriminated union: `CardBlock`, `CarouselBlock`, `FormBlock`, `LinkPreviewBlock`. Each has a `type` discriminant and typed `data` payload | `apps/api/src/types/messageBlocks.ts` | express-mongoose-scaffold | File compiles with zero TypeScript errors; all four block shapes type-safe |
| 2 | Add `blocks?: MessageBlock[]` as `Mixed` array to `Message` schema (schema-level type; not a subdocument for flexibility); return in widget message DTO | `apps/api/src/models/Message.ts`, `apps/api/src/routes/widget.routes.ts` | express-mongoose-scaffold | Field persists in Mongo; widget `GET messages` returns `blocks` array |
| 3 | Create `BlockRenderer.tsx` dispatcher: `switch(block.type)` → `<CardBlockRenderer>`, `<CarouselBlockRenderer>`, `<FormBlockRenderer>`, `<LinkPreviewBlockRenderer>` (stubs initially) | `apps/widget/src/components/blocks/BlockRenderer.tsx` | widget-embed-iframe | Component renders without error for all four stubs |
| 4 | In `MessageList.tsx`: when `message.blocks?.length > 0` render `<BlockRenderer blocks={message.blocks} onSendMessage={...}>` instead of Markdown content; messages without blocks unchanged | `apps/widget/src/components/MessageList.tsx` | widget-embed-iframe | Existing plain-text and Markdown messages unaffected; block messages route to BlockRenderer |

### 3.1 — Card + carousel

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 5 | Implement `CardBlockRenderer.tsx`: `image?`, `badge?`, `title`, `subtitle?`, `price?`, `buttons[]`. Button action `send_message` calls `onSendMessage(text)`; `open_url` opens in `_blank` | `apps/widget/src/components/blocks/CardBlockRenderer.tsx` | widget-embed-iframe | Card renders image, title, badge, buttons; `send_message` button dispatches message; `open_url` opens new tab |
| 6 | Implement `CarouselBlockRenderer.tsx`: horizontal scroll container (`overflow-x: auto; scroll-snap-type: x mandatory`) wrapping N `CardBlockRenderer`s | `apps/widget/src/components/blocks/CarouselBlockRenderer.tsx` | widget-embed-iframe | Multiple cards swipe/scroll; snap-x behavior on mobile |
| 7 | Add `resultToBlocks(toolKey, result)` function in `dispatcher.ts`: `list_calendar_slots` → `CarouselBlock` of slot cards (each card has date/time title + "Book This Slot" `send_message` button); `get_subscription` → single `CardBlock` with plan name, status, renewal date. Append returned blocks to `Message.blocks` after dispatching | `apps/api/src/services/integrations/dispatcher.ts` | express-mongoose-scaffold | `list_calendar_slots` tool result → carousel of slot cards visible in widget; `get_subscription` → info card |

### 3.2 — Inline forms

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 8 | Implement `FormBlockRenderer.tsx`: renders typed fields (`text`, `email`, `tel`, `select`, `textarea`) from `FormBlock.data.fields`; client-side `required` validation; on submit POST `{formPayload, toolKey}` alongside the message to the send-message API | `apps/widget/src/components/blocks/FormBlockRenderer.tsx` | widget-embed-iframe | Form renders all field types; required validation fires; submit sends payload; shows "Submitted!" feedback |
| 9 | In `POST /widget/conversations/:id/messages` route handler: detect `body.formPayload + body.toolKey`; validate `formPayload` against `ToolDefinition.jsonSchema` with `ajv`; if valid, inject as a pre-formed tool-call result (bypassing LLM tool loop) → dispatcher executes tool → AI generates acknowledgement reply | `apps/api/src/routes/widget.routes.ts` | express-mongoose-scaffold | Form submission → tool executes directly; AI reply acknowledges action; `ToolCallLog` written |

### 3.3 — Image vision

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 10 | In `generateAiReply()` when building the user turn: for attachments with `contentType.startsWith("image/")`, if image URL size > `AI_VISION_MAX_IMAGE_BYTES`, resize with `sharp` to fit within limit (preserve aspect ratio, JPEG quality 80); append OpenAI-compatible vision content block `{type:"image_url", image_url:{url, detail:"auto"}}` to the multimodal user message. Use `AI_VISION_MODEL` env for the vision call (or fall back to `AI_MODEL`) | `apps/api/src/services/ai/agent.service.ts`, `apps/api/src/config/env.ts` | express-mongoose-scaffold | Customer uploads screenshot + "What does this show?" → AI describes image content; `pnpm type-check` passes |

### 3.4 — OG link preview

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 11 | Create `apps/api/src/services/og/preview.service.ts`: `fetchPreview(url): Promise<OgPreview\|null>` — `assertSafeUrl(url)` (reuse from Plan 14), `axios.get(url, {maxContentLength:1048576, timeout:5000})`, parse `<meta og:*>` tags with `node-html-parser`; cache result in Redis (TTL 24h) / in-memory LRU (500 entries, `lru-cache` package) | `apps/api/src/services/og/preview.service.ts` | express-mongoose-scaffold | `fetchPreview("https://example.com")` → `{title, image, description}`; private IP URL → `null`; second call returns cached result |
| 12 | After final reply assembled in `generateAiReply()`: extract up to 2 HTTPS URLs from `reply` text using regex; call `fetchPreview()` in parallel; append `LinkPreviewBlock`s to `message.blocks` for non-null results | `apps/api/src/services/ai/agent.service.ts` | express-mongoose-scaffold | AI reply containing URL → `LinkPreviewBlock` in `message.blocks`; SSRF-blocked URL → no block |
| 13 | Implement `LinkPreviewBlockRenderer.tsx`: show `image`, `title`, `description` in a compact card; full card is a clickable link opening URL in new tab | `apps/widget/src/components/blocks/LinkPreviewBlockRenderer.tsx` | widget-embed-iframe | Preview card renders; click opens URL in new tab |

### Wrap-up

| # | Task | Files touched | Acceptance |
|---|------|---------------|------------|
| 14 | Rebuild all apps; smoke-test each block type end-to-end | — | All verification checks below green |
| 15 | Update spec 32 + this plan with deltas; write `CHANGELOG_N.md` | `__specs/32-rich-messages.md`, `__plans/16-rich-messages.md`, `CHANGELOG_N.md` | Docs match shipped behavior |

## Decisions baked in

- `blocks` is a parallel structure to `content` — not a replacement. Messages with only `content` remain unchanged; `blocks` is additive.
- `assertSafeUrl()` created in Plan 14 is reused here — not duplicated.
- `sharp` resize capped at `AI_VISION_MAX_IMAGE_BYTES` before URL passed to model — avoids vision API request size errors.
- OG preview cache: Redis when available, in-memory LRU fallback — no new infrastructure required.

## Verification

- [x] Plain-text and Markdown AI messages render identically to Plan 13 behavior (blocks rendered after content, not replacing it).
- [x] `list_calendar_slots` tool result → `CarouselBlock` of slot cards; "Book this slot" `send_message` button.
- [x] `get_subscription` → single `CardBlock` with plan name, status badge, and renewal date.
- [x] Inline form: renders all 5 field types; required validation fires client-side; submit → `dispatchToolCall`; AI acknowledges.
- [x] Image attachment → `getAttachmentBuffer` → optional `sharp` resize → base64 data URL in vision content block.
- [x] URL in AI reply → `fetchOgPreview` → `LinkPreviewBlock`; private IP URL → `null` (SSRF guard via `assertSafeUrl`).
- [x] `pnpm --filter api build`, `pnpm --filter widget build`, `pnpm --filter web build` all pass.

### Implementation notes (delta from original spec)

- `blocks` renders AFTER message content (prose + blocks), not instead of it — both are always available.
- `LRUCache<string, CachedOg>` wraps `{ data: OgData | null }` to satisfy the `{}` constraint on the lru-cache generic.
- `getAttachmentBuffer` added to `attachments.service.ts` to read stored attachments into memory without the HTTP layer.
- `sharp` resize capped at 1024×1024 (not arbitrary); graceful fallback if sharp unavailable or format unsupported.
- `BlockRenderer` passes `conversationId` and `sessionToken` to `FormBlockRenderer` for the direct-fetch submit path.
- `conversationId` threaded through WidgetRoot → ChatScreen → MessageList → BlockRenderer (null → undefined coercion at WidgetRoot).
- `ajv` (already installed) used for server-side `formPayload` validation against `ToolDefinition.jsonSchema`.

## Out of scope

- Video/audio attachment preview.
- Block authoring UI in Widget Studio (future).
- Custom block types beyond the four defined.
- Image OCR for non-attachment images embedded in KB sources.
