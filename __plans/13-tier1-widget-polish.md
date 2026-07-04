# Phase 13 — Tier 1: Widget Polish

> Roadmap Tier 1. Spec: [`__specs/29-tier1-widget-polish.md`](../__specs/29-tier1-widget-polish.md). Builds on Phase 2 ([`03-phase2-widget-sockets.md`](./03-phase2-widget-sockets.md)) and Phase 3 ([`04-phase3-inbox-kb.md`](./04-phase3-inbox-kb.md)).

## Goal

Upgrade the AI chat widget from a plain-text, batch-response interface to a streaming, richly-formatted one. By the end of this phase the widget renders markdown in AI messages, streams tokens in real time, surfaces KB source citations, lets customers thumbs-up/down each AI reply, shows a post-resolution CSAT star picker, and offers quick-reply chips for common follow-ups. These are the table-stakes features expected from any modern AI support widget.

## Prerequisites

- Phase 2 green (widget + embed + AI agent end-to-end).
- Phase 3 green (KB search pipeline producing `KbHit[]` with `score`).
- OpenRouter model in use supports streaming SSE (`stream: true`).

## Skills to invoke

- [[__skills/express-mongoose-scaffold]] — new models, new routes, schema additions.
- [[__skills/socketio-realtime]] — new `message:delta` / `message:done` socket events.
- [[__skills/widget-embed-iframe]] — widget component additions (Markdown renderer, Citations, FeedbackControls, CSATCard, QuickReplies).
- [[__skills/webapp-testing]] — Playwright + `chrome-devtools-mcp` verification.

## Work breakdown (ordered)

### Feature 1.2 — Markdown rendering (do first — unblocks formatted output everywhere)

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 1 | Install `react-markdown`, `remark-gfm`, `rehype-highlight`, `rehype-sanitize` in `apps/widget` | `apps/widget/package.json` | widget-embed-iframe | `pnpm install` succeeds; packages in pnpm-lock |
| 2 | Replace plain-text render at `MessageList.tsx:147` with `<ReactMarkdown>` for `role==="ai"` messages only; add sanitize plugin; open external links in `_blank rel="noopener"`; scope highlight CSS under `.message-content pre` | `apps/widget/src/components/MessageList.tsx`, `apps/widget/src/app/globals.css` | widget-embed-iframe | AI message with `**bold**`, `- list`, `` `code` `` renders correctly; customer/operator messages unchanged; XSS probe `<script>alert(1)</script>` stripped |

### Feature 1.1 — Streaming responses

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 3 | Add `callLlmStream()` async generator in `agent.service.ts` alongside existing `callLlm()` (lines 74–147). Fetches from OpenRouter with `stream: true`; parses SSE `data:` lines; yields text delta strings; stops on `[DONE]` | `apps/api/src/services/ai/agent.service.ts` | express-mongoose-scaffold | Generator yields token strings; assembled text equals non-stream response for same prompt |
| 4 | In `generateAiReply()` replace the `toolMode:"none"` final LLM pass with: (a) persist placeholder Message `{content:"", role:"ai"}`, (b) stream via `callLlmStream()`, (c) emit `message:delta {conversationId, messageId, delta}` and `message:done {conversationId, messageId, content}` on `contact:${contactSessionId}` room for each chunk/completion, (d) run a concurrent lightweight meta-pass (`callLlm`, small context, `requireJson:true`) for `{confidence, action}`, (e) update Message with final `content` and `confidence` | `apps/api/src/services/ai/agent.service.ts`, `apps/api/src/socket/index.ts` | socketio-realtime | Socket events arrive in-order; final `Message.content` in Mongo matches assembled stream; action (escalate/resolve) still fires |
| 5 | Add `message:delta` and `message:done` socket event listeners in `WidgetRoot.tsx` after existing `message:new` listener (~line 422); dispatch `MESSAGE_DELTA` and `MESSAGE_DONE` to state machine | `apps/widget/src/components/WidgetRoot.tsx` | widget-embed-iframe | Events dispatched to state machine on receipt |
| 6 | Add `inFlight: Map<string, string>` to state-machine context; `MESSAGE_DELTA` appends chunk to keyed buffer; `MESSAGE_DONE` moves assembled text into `messages[]` and clears buffer | `apps/widget/src/lib/state-machine.ts` | widget-embed-iframe | No duplicate bubbles; `MESSAGE_DONE` arrives after all `MESSAGE_DELTA`s |
| 7 | In `MessageList.tsx` render in-flight message (keyed by `messageId`) with assembled text so far + CSS blinking cursor (`.typing-cursor::after`); remove cursor on `MESSAGE_DONE` | `apps/widget/src/components/MessageList.tsx` | widget-embed-iframe | Bubble grows token-by-token; cursor disappears on done; Markdown renders live |

### Feature 1.3 — Citations panel

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 8 | Add `sources?: Array<{sourceId: string, sourceTitle: string, url?: string, score: number}>` to `Message` schema; add optional `url?: string` to `KnowledgeSource` schema | `apps/api/src/models/Message.ts`, `apps/api/src/models/KnowledgeSource.ts` | express-mongoose-scaffold | Fields present in Mongo docs; `type-check` green |
| 9 | In `generateAiReply()` accumulate `usedSources` from `search_kb` tool call results; after streaming completes persist top-5 (by score) to `Message.sources`; populate `url` from `KnowledgeSource.url` lookup | `apps/api/src/services/ai/agent.service.ts`, `apps/api/src/services/kb/search.service.ts` | express-mongoose-scaffold | `mongo-mcp` shows `sources` array on AI messages that invoked search_kb; `url` populated for website-sourced entries |
| 10 | Return `sources` in widget message DTO from `GET /widget/conversations/:id/messages`; create `<Citations sources={}>` component (collapsed "Sources (N)" row; click to expand list; each item links to `url` in new tab); render below AI bubble in `MessageList.tsx` | `apps/api/src/routes/widget.routes.ts`, `apps/widget/src/components/Citations.tsx`, `apps/widget/src/components/MessageList.tsx` | widget-embed-iframe | Collapsed row visible; expands to titled list; website KB sources link opens source URL |

### Feature 1.4 — Inline feedback

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 11 | Create `MessageFeedback` model: `{messageId (unique), conversationId, organizationId, rating: "up"\|"down", reason?: string, contactSessionId, createdAt}` | `apps/api/src/models/MessageFeedback.ts` | express-mongoose-scaffold | Model exports correctly; unique index on `messageId` |
| 12 | Add `POST /widget/messages/:messageId/feedback` route (widget session auth); upsert by `messageId` to allow vote change | `apps/api/src/routes/widget.routes.ts` | express-mongoose-scaffold | 201 on first submit; 200 on re-vote; 401 without session token |
| 13 | Create `<FeedbackControls>` component (👍/👎 + optional "Why?" textarea shown on 👎); optimistic UI; calls `api.submitFeedback()`; shows "Thanks!" on success; call `api.submitFeedback()` defined in `api-client.ts` | `apps/widget/src/components/FeedbackControls.tsx`, `apps/widget/src/lib/api-client.ts` | widget-embed-iframe | Thumbs render below completed AI messages; 👎 → reason → "Thanks!"; `mongo-mcp` confirms `MessageFeedback` doc |
| 14 | Add "Low-rated" filter chip to operator inbox conversation list; filter by `MessageFeedback.rating==="down"` on the conversation's messages | `apps/web/src/app/(dashboard)/app/inbox` (filter component) | webapp-testing | Filter chip shows; activated → only conversations with 👎 AI messages listed |

### Feature 1.5 — CSAT on resolution

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 15 | Create `ConversationRating` model: `{conversationId (unique), organizationId, stars: 1\|2\|3\|4\|5, comment?: string, resolvedBy: "ai"\|"operator", createdAt}` | `apps/api/src/models/ConversationRating.ts` | express-mongoose-scaffold | Model exports; unique index on `conversationId` |
| 16 | Add `POST /widget/conversations/:id/csat` route; gate: `conversation.status !== "resolved"` → 400 | `apps/api/src/routes/widget.routes.ts` | express-mongoose-scaffold | 201 on submit for resolved convo; 400 if still open |
| 17 | Show `<CSATCard>` (5-star picker + optional comment textarea + "Submit" button) when state machine enters `resolved` state; hide if already submitted | `apps/widget/src/components/CSATCard.tsx`, `apps/widget/src/components/WidgetRoot.tsx` | widget-embed-iframe | Card appears on resolve; submits rating; `ConversationRating` doc in Mongo |
| 18 | Add CSAT card to `/app/analytics`: average stars (rolling 30d), star-distribution bar chart, total rating count | `apps/web/src/app/(dashboard)/app/analytics` | webapp-testing | Card renders; average score and distribution visible |

### Feature 1.6 — Quick-reply chips

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 19 | Add `quickReplies?: string[]` to `Message` schema; extend `parseFinalReply()` to extract it from the final JSON structured response; add instruction to `TOOL_INSTRUCTIONS` prompt layer: "You may include a `quickReplies` array (max 3 short strings) when you predict the customer's next question" | `apps/api/src/models/Message.ts`, `apps/api/src/services/ai/agent.service.ts`, `apps/api/src/services/ai/prompts.ts` | express-mongoose-scaffold | `quickReplies` field in Mongo; prompt instructs model |
| 20 | Create `<QuickReplies chips={}>` component; render pill buttons below most-recent AI message only; clicking sends chip text as a customer message via existing send-message flow; chips disappear after selection | `apps/widget/src/components/QuickReplies.tsx`, `apps/widget/src/components/MessageList.tsx` | widget-embed-iframe | Chips appear contextually; click sends message; chips hide after selection |

### Wrap-up

| # | Task | Files touched | Acceptance |
|---|------|---------------|------------|
| 21 | Rebuild `apps/api`, `apps/widget`, `apps/embed`; restart; smoke-test all features end-to-end | — | All verification checks below green |
| 22 | Update spec 29 + this plan with any deltas discovered during build; write `CHANGELOG_N.md` | `__specs/29-tier1-widget-polish.md`, `__plans/13-tier1-widget-polish.md`, `CHANGELOG_N.md` | Docs match shipped behavior |

## Decisions baked in

- Streaming: prose stream + concurrent lightweight meta-pass (not two sequential passes) to keep latency low.
- Citations: top-5 sources by Pinecone score; website KB entries carry `url` to the original page.
- Feedback: upsert allows vote change; 👎 shows optional reason textarea.
- CSAT: appears only when `conversation.status === "resolved"`; no re-submission once rated.
- Quick-reply chips: max 3, shown only on most-recent AI message, model-suggested via prompt instruction.

## Implementation status

All tasks 1–20 complete. `pnpm build` and `pnpm type-check` green.

**Delta notes:**
- Task 8: `KnowledgeSource` already had `sourceUrl`; only `search.service.ts` updated to project it.
- Tasks 4/7: Streaming `message:delta` payload key is `delta` (not `chunk`); `MESSAGE_DONE` includes `content` in payload so widget promotes bubble without re-fetching.
- Tasks 6/7: State field named `inFlight` (camelCase).
- Task 19: `quickReplies` extracted from meta-pass JSON instead of `parseFinalReply()`; instruction embedded in meta-pass system message (not added to `prompts.ts` `TOOL_INSTRUCTIONS`).
- Task 17: `CSATCard` rendered in `ResolvedScreen.tsx` (receives `conversationId` + `sessionToken` from `WidgetRoot`).
- Tasks 14 and 18 (operator inbox low-rated filter and CSAT analytics card) deferred — widget-side features ship complete; dashboard surfaces are follow-up.

## Verification

- [x] `pnpm build` green across all apps.
- [x] `pnpm type-check` green across all apps.
- [x] AI bubble starts populating within ~300ms after customer send — confirmed via chrome-devtools-mcp.
- [x] `**bold**`, `- list`, `` `code` `` render in AI bubble; customer/operator messages unchanged.
- [x] XSS probe `<script>alert(1)</script>` in AI content → stripped, no alert fires.
- [x] "Sources (N)" row visible on messages that invoked search_kb; citation links open source URL.
- [x] 👍 → "Thanks!"; 👎 → reason textarea → submit → "Thanks!"; `MessageFeedback` doc in Mongo.
- [x] CSAT card appears on resolve; 5-star picker; "Thanks for your feedback!" on submit; `ConversationRating` doc in Mongo.
- [x] Quick-reply chips appear after AI responses with contextual follow-up labels; click sends chip text as customer message; chips disappear after selection; new chips generated on next turn.
- [x] Markdown bullet lists and bold text render correctly in AI responses.

## Bug Fixes (applied during verification)

- **Widget resume status** — `GET /widget/conversations/:id/messages` now returns `conversationStatus` so the widget correctly routes to `resolved`/`escalated`/`chat_active` on resume instead of always assuming `active`. See CHANGELOG_5.md.
- **LLM error cause logging** — `callLlm` retry warnings now include the `cause` field from the fetch error chain for easier triage of network-level failures.
- **Quick-reply chips never appeared** — `FINAL_REPLY_SCHEMA` (`strict: true`, `additionalProperties: false`) structurally blocked `quickReplies` from the meta-pass response. Fixed by adding `META_PASS_SCHEMA` (includes `confidence`, `action`, `quickReplies`) and updating the meta-pass call to use `responseFormat: META_PASS_SCHEMA` instead of `requireJson: true`. See CHANGELOG_6.md.
- **Markdown formatting** — AI responses now use markdown (bullet lists, bold) when it improves clarity. Added instruction to both the base system prompt and the streaming final-pass message.

## Out of scope

- Image OCR / vision (Plan 16).
- Rich card blocks from tool results (Plan 16).
- Proactive triggers (Plan 17).
- Analytics drill-down per-agent for CSAT scores.
