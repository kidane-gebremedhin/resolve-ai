---
name: widget-embed-iframe
description: Build the apps/widget Next.js iframe (state-machine UI for pre-chat → chat → contact → resolved) and the apps/embed Vite loader script (widget.js with data-* attributes that injects the iframe). Use during Phase 2 once Socket.io and the widget public API are live. Implements __specs/09-widget-state-machine.md.
---

# Widget Iframe + Embed Loader

## When to use

Phase 2, after [`socketio-realtime`](../socketio-realtime/) and the widget public-API endpoints in [`express-mongoose-scaffold`](../express-mongoose-scaffold/) are working. Delivers the end-to-end customer chat experience.

## Prerequisites

- `apps/widget` and `apps/embed` workspaces scaffolded
- `@csb/ui` available; widget can import primitives the same way `@csb/web` does
- Widget API endpoints live: `POST /widget/sessions`, `POST /widget/sessions/:id/contact`, `POST /widget/conversations`, `GET/POST /widget/conversations/:id/messages`, `POST /widget/conversations/:id/attachments`, `GET /widget/settings`
- Socket.io server accepting session-token auth

## Procedure

### A. `apps/widget` (Next.js iframe)

1. **State machine** — implement exactly the FSM in [`__specs/09-widget-state-machine.md`](../../__specs/09-widget-state-machine.md). States: `loading → preChat → chat → contact → sections → resolved`. Root component `WidgetShell.tsx` routes between screens based on state.

2. **Screens** (one component each, all `'use client'`):
   - `PreChatScreen.tsx` — greeting, suggested questions, **inline email (required) + phone (optional)**, send button disabled until valid email. Spec §10 Phase 2 acceptance: "Contact info collected inline in pre-chat screen before first message".
   - `ChatWindow.tsx` — message list, auto-scroll, infinite-scroll up for history
   - `Composer.tsx` — text input, emoji picker, file attachment
   - `ContactForm.tsx` — non-blocking overlay for late capture
   - `SectionsScreen.tsx` — quick nav links from widget settings
   - `ResolvedScreen.tsx` — "Start a new chat" button
   - `MessageBubble.tsx` — variants for customer / ai / operator / system
   - `TypingIndicator.tsx` — animated dots
   - `FileAttachment.tsx` — upload UI + display

3. **Session management** — `lib/session.ts`:
   - `localStorage['csb_session']` holds `{ token, expiresAt, organizationId, websiteId }`
   - On boot: if token expired or absent → `POST /widget/sessions` → store new token
   - On 401 from API → invalidate local token, restart

4. **API client** — `lib/api-client.ts` — typed fetch wrapper with `Authorization: Bearer <sessionToken>`. Re-uses widget API endpoints listed above.

5. **Socket client** — `lib/socket.ts` — Socket.io-client connecting to `NEXT_PUBLIC_SOCKET_URL` with `auth: { sessionToken }`. Subscribes to `message:new`, `conversation:status`, `typing:indicator`.

6. **AI confidence handling** — when `message:new` arrives with `confidence < threshold` and role=`ai`, show an "Connecting you to a human" pill (spec §05 acceptance). The escalation is decided server-side; widget just renders the UX.

7. **CSP** — widget app must allow iframe embedding from any origin: `Content-Security-Policy: frame-ancestors *`. Set in `apps/widget/next.config.ts` headers per Next 16 syntax (verify against `node_modules/next/dist/docs/`).

### B. `apps/embed` (Vite loader)

1. **Single file**: `apps/embed/src/widget.ts`. Vite config builds to `dist/widget.js` (single bundle, no code splitting).

2. **Behavior**:
   ```ts
   // Read data-* attrs from the <script> tag
   const script = document.currentScript as HTMLScriptElement;
   const orgId = script.dataset.organizationId;
   const widgetId = script.dataset.widgetId;
   const position = script.dataset.position ?? 'bottom-right';

   // Render a floating launcher button (Tailwind-free; inline styles)
   // On click → inject an <iframe src="<WIDGET_URL>?org=...&widget=..."> with sandbox attrs
   // Toggle open/close on subsequent clicks
   ```

3. **Iframe injection**:
   - `src={NEXT_PUBLIC_WIDGET_URL}?orgId=<>&widgetId=<>` so the widget knows which org/agent
   - `allow="microphone; clipboard-write"` for voice + share UX
   - `sandbox="allow-scripts allow-same-origin allow-forms"` (don't allow `allow-top-navigation` — embeds shouldn't redirect host page)

4. **CORS / CSP friendly** — the loader script itself must be served with `Access-Control-Allow-Origin: *` (configured in [`docker-multi-stage-apps`](../docker-multi-stage-apps/) §4 nginx.conf).

5. **PostMessage bridge** (optional but useful):
   - Host page → iframe: `widget:open`, `widget:close`, `widget:identify` (pass logged-in user data)
   - Iframe → host page: `widget:unread` (for host-side unread badge), `widget:opened`, `widget:resolved`

6. **Build output** — `apps/embed/dist/widget.js`, served by the embed nginx container from `/widget.js`. CDN caches it (spec §20 §scaling).

## Gotchas

- **`localStorage` is per-origin** — the widget iframe's storage is isolated from the host page. Customers can't "log out" of one widget by clearing host cookies.
- **Pre-chat email is required** before the first message can be sent — verify the send button is disabled until the inline email field is valid (RFC 5322 regex or `z.string().email()`).
- **Session expiry = fresh conversation** — when the 24 h session expires, the next message starts a new conversation, not a continuation of the old one. Spec §09.
- **Embed script size** — should be < 15 KB gzipped. Vite tree-shakes well but avoid pulling in React/large polyfills.
- **Iframe sandbox flags** — `allow-same-origin` is required so localStorage works; without it, sessions reset on every load.
- **Mobile keyboards** — virtual keyboards resize the viewport; use `100dvh` not `100vh` in widget styles.
- **Multiple widgets per page** — rare but possible (test environments). Each `<script>` tag injects its own iframe with a unique DOM id.
- **CSP on host page** — some customers will have strict CSP that blocks the embed. Document the required directives: `script-src https://embed.resolve-ai.app`, `frame-src https://widget.resolve-ai.app`.
- **Per AGENTS.md**: Next 16's response-header API may differ — verify CSP header setup against `node_modules/next/dist/docs/`.

## Acceptance

- [ ] Embed script creates a floating launcher button on any HTML page
- [ ] Button click opens the iframe; state begins at `preChat`
- [ ] Customer enters email + types question → conversation starts → AI replies within 5 s
- [ ] Session persists across page refreshes
- [ ] Session expiry after 24 h → fresh start
- [ ] File attachments upload + display
- [ ] Typing indicator shows during AI processing
- [ ] Resolved conversation shows resolved screen + "start new" button
- [ ] Low-confidence AI response triggers human-handoff UX
- [ ] Multiple iframes can coexist on one host page without state collision
- [ ] Embed script + widget pass spec §16 §2.5 audit checklist

## Specs referenced

- [`__specs/09-widget-state-machine.md`](../../__specs/09-widget-state-machine.md) — FSM + session lifecycle
- [`__specs/05-ai-agent-design.md`](../../__specs/05-ai-agent-design.md) — AI agent + confidence threshold
- [`__specs/07-api-specification.md`](../../__specs/07-api-specification.md) §"Widget" — public API
- [`__specs/08-socketio-design.md`](../../__specs/08-socketio-design.md) — widget socket events
- [`__specs/16-production-readiness-audit.md`](../../__specs/16-production-readiness-audit.md) §2.5 — widget audit checklist
