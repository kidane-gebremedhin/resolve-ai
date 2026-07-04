# Phase 17 — Proactive & Lifecycle (Tier 4)

> **Status: COMPLETE** — typing indicators (operator↔customer), proactive trigger model + public API + embed evaluation + server cooldown, launcher unread badge, and Triggers management UI all implemented. See `CHANGELOG_9.md`.
>
> Roadmap Tier 4. Spec: [`__specs/33-proactive-lifecycle.md`](../__specs/33-proactive-lifecycle.md). Builds on Phase 13 ([`13-tier1-widget-polish.md`](./13-tier1-widget-polish.md)).

## Goal

Transform the widget from reactive (only responds) to proactive (initiates at the right moment) and add the lifecycle signals that make both sides of the conversation feel human. This phase delivers: typing indicators (operator→customer and customer→operator), proactive trigger rules that automatically open the widget and send a greeting based on visitor behaviour (time on page, scroll depth, exit intent, URL match), a launcher unread badge that counts missed messages, and the operator-facing Triggers management UI. No new backend AI capability is required — the trigger fires a normal `generateAiReply()` call with a seeded greeting prompt.

## Prerequisites

- Phase 13 green (widget state machine + socket event handling).
- Phase 14 green (optional — `assertSafeUrl` exists; not directly needed here, but avoids duplicate file conflicts).
- `apps/embed/src/widget.ts` postMessage protocol understood (`csb:*` events).

## Skills to invoke

- [[__skills/socketio-realtime]] — typing indicator socket events.
- [[__skills/express-mongoose-scaffold]] — `ProactiveTrigger` model + public triggers endpoint.
- [[__skills/widget-embed-iframe]] — embed-side trigger evaluation + unread badge; widget-side proactive message flow.
- [[__skills/webapp-testing]] — end-to-end trigger fire verification.

## Work breakdown (ordered)

### 4.2 — Typing indicators (low-effort, ship first)

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 1 | In `socket/index.ts` add `operator:typing` handler: resolve `contactSessionId` from `conversationId` (query `Conversation`); re-emit `operator:typing {conversationId, isTyping}` on `contact:${contactSessionId}` room | `apps/api/src/socket/index.ts` | socketio-realtime | Operator emits `operator:typing` → customer's widget socket receives it |
| 2 | Operator inbox message composer: on `input` event emit `socket.emit("operator:typing", {conversationId, isTyping:true})`; debounced emit `isTyping:false` after 2s inactivity | `apps/web/src/app/(dashboard)/app/inbox` (composer component) | socketio-realtime | Operator types → `isTyping:true` event sent; stops → `isTyping:false` after 2s |
| 3 | Widget `WidgetRoot.tsx`: `socket.on("operator:typing")` → dispatch `OPERATOR_TYPING {isTyping}` to state machine; state machine sets `operatorIsTyping` flag; `MessageList.tsx` renders 3-dot animated bubble when flag true | `apps/widget/src/components/WidgetRoot.tsx`, `apps/widget/src/lib/state-machine.ts`, `apps/widget/src/components/MessageList.tsx` | widget-embed-iframe | Operator types in inbox → customer sees 3-dot bubble; stops → bubble disappears |
| 4 | Customer typing: widget `Composer.tsx` emits `customer:typing {conversationId, isTyping}` on input (debounced); `socket/index.ts` re-emits on `org:${orgId}` room; operator inbox conversation row shows typing indicator icon when flag is true | `apps/widget/src/components/Composer.tsx`, `apps/api/src/socket/index.ts`, `apps/web/src/app/(dashboard)/app/inbox` | socketio-realtime | Customer types → operator sees typing indicator on conversation row |

### 4.1 — Proactive triggers

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 5 | Create `ProactiveTrigger` model: `{organizationId, agentId: ObjectId, name: string, isActive: boolean, conditions: Array<{type: "time_on_page"\|"scroll_depth"\|"exit_intent"\|"url_match"\|"element_hover", params: object}>, conditionLogic: "AND"\|"OR", message: string, delayMs: number, cooldownMs: number, maxFires: number, timestamps}` | `apps/api/src/models/ProactiveTrigger.ts` | express-mongoose-scaffold | Model registers; `type-check` green |
| 6 | Add `GET /widget/triggers?agentId=` public endpoint (no session auth; same permissive CORS as `/widget/appearance`); return `isActive:true` triggers for agent; `Cache-Control: public, max-age=60` | `apps/api/src/routes/widget.routes.ts` | express-mongoose-scaffold | `curl .../widget/triggers?agentId=x` → active triggers JSON; no `ContactSession` created (`mongo-mcp`) |
| 7 | In `apps/embed/src/widget.ts`: after `fetchAppearance()`, fetch `/widget/triggers?agentId=`; for each trigger register the matching DOM listener/timer: `time_on_page` → `setTimeout`; `scroll_depth` → `window.scroll` listener; `exit_intent` → `mouseleave` on `document`; `url_match` → regex test on `window.location.href`; `element_hover` → `mouseover` on selector. Check `localStorage.getItem("csb:trigger:{triggerId}")` cooldown before firing. On fire (respecting `AND`/`OR` logic and `delayMs`): set cooldown in localStorage, emit `csb:proactive {triggerId, message}` to iframe via `postMessage`, increment badge | `apps/embed/src/widget.ts` | widget-embed-iframe | `time_on_page: 10s` trigger → 10 s on page → `csb:proactive` postMessage; second visit within cooldown → trigger does NOT fire |
| 8 | Widget `WidgetRoot.tsx`: listen for `window.message.type === "csb:proactive"`; if widget is closed, open it; POST `{role:"proactive_trigger", triggerId, seedMessage: message}` to `/widget/conversations` to start conversation and immediately run `generateAiReply()` with the trigger's `message` as the AI's first turn. Enforce server-side cooldown: check `ContactSession.metadata.proactiveFires[triggerId]` timestamp before starting | `apps/widget/src/components/WidgetRoot.tsx`, `apps/api/src/routes/widget.routes.ts` | widget-embed-iframe | Widget opens on trigger; AI sends greeting from `message` field; second trigger within server-side cooldown period is ignored |
| 9 | Add Triggers management UI: new tab in Widget Studio (`/app/widget`) or standalone `/app/triggers` page. List triggers with enable/disable toggle. "Add trigger" form: name, condition type(s), logic, message, delay, cooldown, maxFires. "Preview" button opens the widget Studio preview and simulates a trigger fire | `apps/web/src/app/(dashboard)/app/widget/` or `apps/web/src/app/(dashboard)/app/triggers/`, `apps/web/src/components/layouts/app-shell.tsx` (if standalone) | webapp-testing | Operator creates `time_on_page: 5s` trigger in UI → saves to Mongo → fires in Studio preview after 5 s |

### 4.3 — Launcher unread badge

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 10 | In `apps/embed/src/widget.ts`: after launcher injection, inject `<div id="csb-unread-badge">` absolutely positioned at top-right of launcher; CSS: `display:none` initially, red circle, white text. On `csb:proactive` postMessage: show badge, set count to 1. On `csb:unread {count}` postMessage from iframe: set badge text to count. On widget open (`openWidget()`): hide badge | `apps/embed/src/widget.ts` | widget-embed-iframe | Badge appears with count after proactive; number increments on each new AI message while closed; clears when widget opens |
| 11 | Widget `WidgetRoot.tsx`: when widget is not visible (iframe hidden) and `message:new` (AI or proactive) arrives, `window.parent.postMessage({type:"csb:unread", count: unreadCount}, "*")`; reset `unreadCount` to 0 on `csb:open` | `apps/widget/src/components/WidgetRoot.tsx` | widget-embed-iframe | Each AI reply while widget is hidden increments badge count |

### Wrap-up

| # | Task | Files touched | Acceptance |
|---|------|---------------|------------|
| 12 | Rebuild all apps; smoke-test typing indicators + proactive + badge end-to-end | — | All verification checks below green |
| 13 | Update spec 33 + this plan with deltas; write `CHANGELOG_N.md` | `__specs/33-proactive-lifecycle.md`, `__plans/17-proactive-lifecycle.md`, `CHANGELOG_N.md` | Docs match shipped behavior |

## Decisions baked in

- Cooldown enforced in **both** embed localStorage AND server (`ContactSession.metadata`) — embed prevents unnecessary requests; server prevents abuse from multiple browsers/devices.
- Trigger evaluation is fully client-side (embed) — no server round-trip for condition checking; public endpoint returns all active triggers for the agent.
- `conditionLogic: "AND"|"OR"` — all conditions must match (AND) or any one (OR).
- Typing indicator debounced at 2s — no sub-second socket chatter.

## Verification

- [x] Operator types in inbox → customer sees 3-dot bubble within ~500ms; stops typing → bubble disappears after ~2s.
- [x] Customer types → operator conversation row shows typing indicator.
- [x] Create `time_on_page: 10s, url: /pricing` trigger in UI → navigate to `/pricing`, wait 10s → widget opens, AI sends configured greeting.
- [x] Second visit to `/pricing` within cooldown window → trigger does NOT fire (localStorage cooldown).
- [x] Different device/browser → trigger does NOT fire (server-side cooldown from `ContactSession.metadata`).
- [x] Red badge appears on launcher after proactive; count increments on each AI message while widget is closed; clears when widget opens.
- [x] Trigger CRUD in dashboard: add/edit/delete/toggle all work; list reflects Mongo state.
- [x] `pnpm --filter api build`, `pnpm --filter widget build`, `pnpm --filter web build`, `pnpm --filter embed build` all pass.

### Implementation notes (delta from original spec)

- `operator:typing` handler queries `Conversation.contactSessionId` to relay only to that contact's personal socket room, not the entire conversation room. The existing `typing:start`/`typing:stop` handlers are preserved as a fallback for operator dashboards that already emit them.
- `customer:typing` relayed to `org:{orgId}` room — all operator sockets in the org receive it; the dashboard filters by `conversationId`.
- Proactive greeting is saved directly as an `ai` role `Message` (no extra AI call). The trigger's `message` field is exactly what the customer sees. This is simpler, faster, and ensures the operator controls the exact wording.
- Server-side cooldown stored at `ContactSession.metadata.proactiveFires[triggerId]` (epoch timestamp).
- Badge injected as `position:absolute` child of the launcher button (works because the launcher is `position:fixed`, establishing a containing block for absolute children). `launcher.style.overflow = "visible"` prevents clipping.
- `csb:widget-opened` / `csb:widget-closed` signals added to the embed→iframe protocol so the widget can track visibility without additional infrastructure.
- Triggers page is a client component (uses `useState`/`useEffect`) fetching from the API with `getAccessToken()` → `Bearer` header pattern matching the integrations page.
- **Widget-open guard (session 7):** `setupTriggers()` gained an `isOpenFn: () => boolean` parameter. `fireTrigger()` returns early before marking the trigger as fired or sending the proactive postMessage when `isOpenFn()` is true. This prevents proactive messages from interrupting an already-open widget session.

## Out of scope

- Push notifications (browser Notification API) when widget is closed in a different tab.
- Server-sent proactive messages not triggered by visitor behaviour (broadcast/campaign).
- A/B testing of trigger messages.
- Segment/analytics integration for trigger fire events.
