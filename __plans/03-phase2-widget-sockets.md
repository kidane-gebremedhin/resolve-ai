# Phase 2 — Widget, Embed, Sockets

## Goal

A visitor on any HTML page that includes the embed `<script>` sees a floating launcher; clicking opens the chat iframe; entering email + a question produces an AI response within 5 s; the conversation persists across page refreshes. Behind the scenes, Socket.io broadcasts messages bi-directionally between widget and dashboard inbox.

## Prerequisites

- Phase 1 green (full backend CRUD + auth)
- OpenRouter / OpenAI-compatible API key working — test with a curl to `chat/completions`
- File-storage destination working (local disk via MinIO in dev)
- `CORS_ORIGINS` includes the widget origin

## Skills to invoke

- [[__skills/socketio-realtime]] — Socket.io server + auth + rooms (steps 1–2)
- [[__skills/widget-embed-iframe]] — widget app + embed loader (steps 3–5)
- [[__skills/express-mongoose-scaffold]] (Phase 1) — extends with AI agent + attachments (step 6)
- [[__skills/webapp-testing]] (downloaded) — Playwright verification across web + widget

## Work breakdown (ordered)

| # | Task | Files touched | Skill | Acceptance |
|---|------|---------------|-------|------------|
| 1 | Attach Socket.io to HTTP server with CORS | `apps/api/src/index.ts`, `apps/api/src/socket/index.ts` | `socketio-realtime` | Socket handshake succeeds from a Node REPL using the documented `auth` payload |
| 2 | Socket auth (JWT for dashboard, session-token for widget); room join authorization; event handlers per spec §08 | `apps/api/src/socket/auth.ts`, `apps/api/src/socket/handlers/{message,conversation,typing}.handler.ts` | `socketio-realtime` | Cannot join other org's rooms; spec §16 §4.3 |
| 3 | Widget iframe app — state machine + 9 screens + session/api/socket clients | `apps/widget/src/app/{layout,page,globals.css}.tsx`, `apps/widget/src/components/{WidgetShell,chat/*,screens/*}.tsx`, `apps/widget/src/lib/{session,api-client,socket}.ts`, `apps/widget/src/hooks/{use-session,use-chat,use-widget-config}.ts` | `widget-embed-iframe` | Visit `http://localhost:3001/?orgId=<>&widgetId=<>` — full state machine flow renders |
| 4 | Embed loader (Vite vanilla TS) → `widget.js` with floating button + iframe injection + postMessage bridge | `apps/embed/src/widget.ts`, `apps/embed/index.html`, `apps/embed/vite.config.ts` | `widget-embed-iframe` | Drop `<script src="http://localhost:3002/widget.js" data-organization-id="..." data-widget-id="...">` into a blank HTML page → launcher appears; click opens iframe |
| 5 | File-upload composer in widget + `POST /widget/conversations/:id/attachments` endpoint | `apps/widget/src/components/chat/FileAttachment.tsx`, `apps/api/src/routes/widget.routes.ts` (attachments handler), `apps/api/src/services/storage.service.ts` (MinIO/local) | `widget-embed-iframe` + `express-mongoose-scaffold` | PDF + image attach upload + display in thread |
| 6 | AI agent service: customer message → embedding → KB search (stub for Phase 3) → chat completion → confidence score → emit via Socket.io. Low confidence → auto-escalate. | `apps/api/src/services/ai/{agent,embedding,prompts}.service.ts`, integration in `widget.routes.ts` POST messages | `socketio-realtime` + (`pinecone-kb-pipeline` stubbed) | Widget message → AI reply within 5 s; conversations with confidence < threshold auto-`status: 'escalated'` |
| 7 | Dashboard inbox real-time subscription — when a Phase 1 inbox page is open, new messages appear without reload | `apps/web/src/hooks/use-inbox.ts`, `apps/web/src/providers/socket-provider.tsx`, `apps/web/src/app/(dashboard)/app/inbox/page.tsx` (subscribe to `conversation:updated`) | `socketio-realtime` | Send a widget message in one tab → see it appear in dashboard inbox in another tab |
| 8 | Wire `apps/web/src/components/dashboard/AppShell.tsx` unread-badge to Socket.io counter | `apps/web/src/hooks/use-unread-count.ts`, `AppShell.tsx` (replace hardcoded `badge: 12`) | `socketio-realtime` | Badge increments on new widget message; clears when inbox opened |

## Verification

- [ ] Drop the embed script into `apps/embed/public/demo.html` (a simple test page); open `http://localhost:3002/demo.html`; launcher appears bottom-right; click opens widget
- [ ] Pre-chat: send button disabled until valid email is entered (spec §10 Phase 2 acceptance)
- [ ] Send first message → AI reply appears within 5 s; both messages persisted (`mongo-mcp` confirms)
- [ ] Refresh the page → previous conversation history loads from localStorage session
- [ ] In a second browser tab, sign in to `/app/inbox` — the same conversation appears in the list and updates live
- [ ] Kill Socket.io connection (network panel) → widget reconnects automatically; no message loss
- [ ] Attach a 2 MB PDF → upload succeeds; appears as attachment in dashboard thread
- [ ] Force a low-confidence AI response (use a query unrelated to any KB) → conversation auto-escalates; dashboard receives `conversation:status` event
- [ ] `chrome-devtools-mcp` reports zero console errors on widget + dashboard during the flow
- [ ] `mongo-mcp`: every message has correct `role`, `senderType`, `confidence` (when AI), `conversationId`
- [ ] [`__specs/16-production-readiness-audit.md`](../__specs/16-production-readiness-audit.md) §2.5 (widget) + §4.3 (sockets) — checklists green
- [ ] [`webapp-testing`](../__skills/webapp-testing/) Playwright script: full happy-path including launcher → preChat → chat → AI reply → resolved

## Out of scope (defer to later phase)

- Real KB search results — `search_kb` tool returns empty list in Phase 2; wired to Pinecone in Phase 3
- Operator reply UX (composer, enhance, resolve buttons) — Phase 3
- Audio notifications — Phase 4
- Multi-server Socket.io with Redis adapter — staging/prod scaling concern, configured in Coolify in Phase 4
- TTS for AI replies — Phase 4 polish
