---
name: socketio-realtime
description: Attach Socket.io to the Express HTTP server with JWT auth (dashboard) and session-token auth (widget), per-conversation and per-org rooms, and a Redis adapter for multi-instance HA. Use during Phase 2 once the API CRUD exists. Implements __specs/08-socketio-design.md.
---

# Socket.io Realtime

## When to use

Phase 2, after [`express-mongoose-scaffold`](../express-mongoose-scaffold/) provides conversation/message CRUD. Required by [`widget-embed-iframe`](../widget-embed-iframe/) and the operator inbox in Phase 3.

## Prerequisites

- `apps/api` Express server boots and exposes REST routes
- Redis available (via `pnpm dev:infra`) — required for HA in staging/prod, optional in local dev
- JWT signing key (`JWT_SECRET`) and contact-session token model (`ContactSession.token`) wired

## Procedure

The event catalog, room naming, and auth flow are fully specified in [`__specs/08-socketio-design.md`](../../__specs/08-socketio-design.md). This skill implements that spec — don't invent new events.

1. **Attach Socket.io to the HTTP server** in `apps/api/src/index.ts`:
   ```ts
   const httpServer = http.createServer(app);
   const io = new Server(httpServer, {
     cors: { origin: env.CORS_ORIGINS.split(','), credentials: true },
     transports: ['websocket', 'polling'],
   });
   attachSocketHandlers(io);
   httpServer.listen(env.PORT);
   ```

2. **Auth middleware** — `apps/api/src/socket/auth.ts`:
   - Dashboard clients send `auth: { token: <jwt> }` → verify JWT, attach `socket.data = { userId, organizationId, role }`
   - Widget clients send `auth: { sessionToken: <uuid> }` → look up `ContactSession`, verify not expired, attach `socket.data = { contactSessionId, organizationId, websiteId }`
   - Unauthenticated connections refused with `next(new Error('UNAUTHORIZED'))`

3. **Room joining** (spec §08):
   - Dashboard sockets auto-join `org:<organizationId>` and any `conversation:<id>` they open
   - Widget sockets auto-join `conversation:<id>` for their session's conversation(s) only
   - **Authorization on every join** — verify the conversation belongs to the socket's org/session before `socket.join()`. Spec §16 §4.3 acceptance: "Room authorization: cannot join other org's rooms".

4. **Event handlers** — wire the events from spec §08:
   - `message:new` — emitted from REST handler when a message is created; broadcast to `conversation:<id>` + `org:<orgId>`
   - `conversation:status` — on resolve/escalate/reopen
   - `conversation:updated` — for inbox list updates (debounced)
   - `conversation:new` — when a new conversation starts
   - `conversation:assigned` — on operator assignment
   - `typing:indicator` — bi-directional; widget + operator both emit + listen
   - `contact:updated` — when widget submits the contact form

5. **REST → Socket bridge** — REST handlers don't emit directly; they call `messageService.create(...)` which calls `io.to(...).emit(...)`. Inject the `io` instance via a service-locator (`getIO()`) or DI container. This keeps controllers thin.

6. **Reconnection** — Socket.io handles reconnect transparently; ensure the auth middleware re-runs on reconnect (it does by default). Document the behavior so widget UI doesn't double-render history.

7. **Redis adapter (HA)** — `@socket.io/redis-adapter`. Wire in `apps/api/src/socket/index.ts`:
   ```ts
   if (env.REDIS_URL) {
     const pubClient = createClient({ url: env.REDIS_URL });
     const subClient = pubClient.duplicate();
     await Promise.all([pubClient.connect(), subClient.connect()]);
     io.adapter(createAdapter(pubClient, subClient));
   }
   ```
   Required when Coolify scales `api` replicas > 1 ([`coolify-three-env-deploy`](../coolify-three-env-deploy/) §production diff).

8. **Rate limit** — separate from REST: cap per-socket emits (e.g. 60 messages/min per widget session) to prevent abuse. Spec §16 §4.2.

## Gotchas

- **CORS** is configured both on Express + on Socket.io. Mismatch → silent connection refused. Use the same `CORS_ORIGINS` env value.
- **`transports: ['websocket', 'polling']`** order matters — websocket first, polling fallback. Some corporate proxies block websockets; polling is the safety net.
- **Don't trust `socket.data` after server restart** — it's in-memory only. On reconnect the middleware re-runs and re-populates.
- **Widget session-token rotation** — when a session is renewed (24 h expiry per spec §09), the *old* socket connection is invalidated. Widget must reconnect with the new token; current open conversations re-join automatically via `socket.io-client`'s reconnection.
- **Don't emit PII to `org:*` rooms** — operators in the same org should only see metadata + redacted content unless they explicitly open the conversation.
- **Memory leaks** — every `socket.on()` must have a matching cleanup on `disconnect`. Use `io.of('/').adapter.close()` in tests to avoid hanging Jest.
- **Socket.io v4 syntax** — `socket.join(room)` (synchronous, no callback). Don't use v2-era `socket.join(room, cb)`.

## Acceptance

- [ ] Customer sends widget message → AI response arrives in widget within 5 s
- [ ] Operator reply in dashboard inbox arrives in customer widget instantly
- [ ] Status change (resolve/escalate) fires `conversation:status` to both widget + dashboard
- [ ] Typing indicator appears bi-directionally
- [ ] Dashboard cannot join another org's `conversation:<id>` room (returns 403 from middleware)
- [ ] Widget cannot read messages from a conversation not in its session
- [ ] When Redis is configured, two `api` replicas broadcast events to each other's clients
- [ ] Spec §16 §4.3 audit checklist all green

## Specs referenced

- [`__specs/08-socketio-design.md`](../../__specs/08-socketio-design.md) — event catalog, rooms, auth, Redis adapter
- [`__specs/09-widget-state-machine.md`](../../__specs/09-widget-state-machine.md) — widget reconnect behavior
- [`__specs/16-production-readiness-audit.md`](../../__specs/16-production-readiness-audit.md) §4.3 — realtime acceptance
- [`__specs/12-security-compliance.md`](../../__specs/12-security-compliance.md) — socket auth requirements
