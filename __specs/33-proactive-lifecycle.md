# 33 — Proactive & Lifecycle: Tier 4

> **Status**: COMPLETE — all three features shipped. See `CHANGELOG_9.md` and `__plans/17-proactive-lifecycle.md`.
> **Depends on**: spec 29 (socket events pattern); Socket.io already wired
> **Blocks**: nothing (purely additive)
> **Implementation plan**: `__plans/17-proactive-lifecycle.md`

### Implementation notes

- **4.2 Typing indicators**: `operator:typing` and `customer:typing` socket events added to `typing.handler.ts`. Legacy `typing:start`/`typing:stop` handlers preserved. Widget renders a single `TypingIndicator` bubble for both AI and operator (`showTypingBubble = typing || operatorTyping`). Composer's `onChange` emits `customer:typing` (debounced 2s stop).
- **4.1 Proactive triggers**: `ProactiveTrigger` Mongoose model stores condition rules. `GET /widget/triggers` public endpoint (`Cache-Control: public, max-age=60`) serves active triggers. Embed evaluates conditions with `setupTriggers()` — 5 condition types, `AND`/`OR` logic, `delayMs` offset, localStorage cooldown. Widget handles `csb:proactive` postMessage by calling `POST /widget/conversations/:id/proactive`, which enforces server-side cooldown and saves the greeting as an AI message.
- **4.3 Unread badge**: Badge injected into launcher DOM. Embed hides badge on `openWidget()`. Widget tracks visibility via `csb:widget-opened` / `csb:widget-closed` signals and posts `csb:unread {count}` to parent on each new message while hidden.
- **Triggers UI**: `/app/triggers` page with full CRUD; `/app/triggers` added to sidebar navigation under "Configure" group.

---

## Overview

Three features that move the widget from reactive (customer starts) to proactive
(widget nudges at the right moment), plus low-effort real-time polish.

| # | Feature | Effort | Depends on |
|---|---|---|---|
| 4.1 | Proactive triggers | High | New rules model + embed event tracking |
| 4.2 | Typing + read receipts | Low | Socket.io (already wired) |
| 4.3 | Launcher unread badge | Medium | Depends on 4.1 |

---

## 4.1 — Proactive triggers

### Problem
Visitors land on pricing, scroll to the FAQ, or hover over the close button and
leave without engaging. The AI never fires unless the visitor opens the widget.

### Design

#### Trigger rules model — `apps/api/src/models/ProactiveTrigger.ts`
```typescript
{
  organizationId: { type: ObjectId, ref: "Organization", required: true },
  agentId:        { type: ObjectId, ref: "Agent", required: true },
  name:           { type: String, required: true },             // operator label
  isActive:       { type: Boolean, default: true },
  conditions:     [{
    type:         { type: String, enum: ["time_on_page", "scroll_depth", "exit_intent", "url_match", "element_hover"] },
    // time_on_page: { seconds: number }
    // scroll_depth: { percent: number }
    // exit_intent:  {} (no params — mouse-leave-top-of-viewport)
    // url_match:    { pattern: string }  // glob or regex string
    // element_hover:{ selector: string }
    params:       { type: Object, default: {} },
  }],
  conditionLogic: { type: String, enum: ["AND", "OR"], default: "AND" },
  message:        { type: String, required: true, maxlength: 500 }, // proactive AI greeting
  delayMs:        { type: Number, default: 0 },                // wait after all conditions met
  cooldownMs:     { type: Number, default: 86_400_000 },       // 24h: don't re-fire per visitor
  maxFires:       { type: Number, default: 1 },                // per visitor session
  createdAt:      { type: Date, default: Date.now },
  updatedAt:      { type: Date, default: Date.now },
}
// Indexes: { organizationId:1, agentId:1, isActive:1 }
```

#### New API endpoint

```
GET /widget/triggers?agentId=<id>
Auth: none (public — same permissive CORS as appearance endpoint)
Response: [{
  id, conditions, conditionLogic, delayMs, message
}]
// Only active triggers. Returns no internal IDs except the trigger ID.
// Cache: max-age=60
```

#### Embed-side tracking — `apps/embed/src/widget.ts`

After the appearance fetch (spec 22 § Feature 2), load proactive triggers:
```typescript
const triggers = await fetch(`${apiUrl}/widget/triggers?agentId=${agentId}`).then(r => r.json());
```

For each trigger, register the relevant DOM/window listeners:

```typescript
function registerTrigger(trigger: ProactiveTrigger) {
  // Evaluate AND/OR of conditions; fire once all are met
  const state = new Map<string, boolean>();

  for (const cond of trigger.conditions) {
    switch (cond.type) {
      case "time_on_page":
        setTimeout(() => markMet(cond), cond.params.seconds * 1000);
        break;
      case "scroll_depth":
        window.addEventListener("scroll", () => {
          const pct = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100;
          if (pct >= cond.params.percent) markMet(cond);
        }, { passive: true });
        break;
      case "exit_intent":
        document.addEventListener("mouseleave", e => {
          if (e.clientY <= 0) markMet(cond);
        });
        break;
      case "url_match":
        // Match on initial load; re-check on popstate
        const re = new RegExp(cond.params.pattern);
        if (re.test(location.href)) markMet(cond);
        break;
      case "element_hover":
        document.querySelector(cond.params.selector)
          ?.addEventListener("mouseenter", () => markMet(cond));
        break;
    }
  }

  function markMet(cond) {
    state.set(cond.type, true);
    const allMet = trigger.conditionLogic === "AND"
      ? trigger.conditions.every(c => state.get(c.type))
      : trigger.conditions.some(c => state.get(c.type));

    if (allMet && !hasFired) {
      hasFired = true;
      setTimeout(() => fire(trigger), trigger.delayMs);
    }
  }
}
```

**Cooldown**: before firing, check `localStorage.getItem(`csb:trigger:${triggerId}`)`.
If present (timestamp within `cooldownMs`), skip. On fire: set the key with `Date.now()`.

**Firing**: `fire(trigger)` opens the widget (if closed) and sends the trigger's
`message` as an AI greeting:
```typescript
function fire(trigger) {
  openWidget();                              // same as clicking the launcher
  postMessageToWidget("csb:proactive", { message: trigger.message, triggerId: trigger.id });
}
```

Inside the widget (`WidgetRoot.tsx`), listen for `csb:proactive`:
```typescript
window.addEventListener("message", e => {
  if (e.data?.type === "csb:proactive") {
    // Seed a pre-composed AI message as the opening line
    // This does NOT send a customer message — the AI speaks first
    dispatch({ type: "PROACTIVE_GREETING", message: e.data.message });
  }
});
```

**Server side**: The widget sends a special `POST /widget/conversations/:id/messages`
with `{ role: "proactive_trigger", triggerId }`. The API:
1. Creates the conversation if none exists (or reopens the last resolved one).
2. Generates an AI reply seeded with the trigger message as the opening context.
3. Returns the AI's reply via the normal socket path.

#### Dashboard: trigger management

Dedicated `/app/triggers` page:
- List of existing triggers (name, combined-conditions summary, active toggle) with
  **edit** (pencil → PATCH, opens the form pre-filled) and delete.
- "Add trigger" form: name, a **repeatable condition builder** (add/remove multiple
  conditions, each a type + its params) with a **Fire when ALL match / ANY matches**
  (AND/OR) control shown once there is more than one condition, message, delay,
  cooldown, max fires.
- **No agent picker.** There is one agent per website, so the page resolves the
  active website's agent automatically (from the `csb_website` scope cookie →
  `GET /agents?websiteId=`) and scopes the trigger list to it; the resolved `agentId`
  is sent on create (POST). PATCH omits `agentId` (immutable).
- Combination example authored here: `url_match ~ /pricing` **AND** `time_on_page 30s`
  **AND** `exit_intent` → the widget runtime already AND/OR-evaluates heterogeneous
  conditions (see `checkAndFire`), so no runtime change was needed.

#### Rate-limit / spam protection

> **Blocker — rule engine scope: user decision required.**
> Proactive triggers can be spammy if misconfigured. Decide before shipping:
>
> - Per-visitor: `maxFires` (in model) + `cooldownMs` (in model). Both
>   enforced client-side in the embed (localStorage). **NOT enforced server-side**
>   (a determined visitor could clear localStorage).
>
> - Server-side enforcement option: log fires in `ContactSession.metadata.proactiveFires`
>   (a map of `triggerId → lastFiredAt`). Check on every proactive message creation.
>   Cost: 1 extra DB write per fire. Recommended for launch.
>
> **Recommendation**: enforce both client-side (UX) and server-side (correctness).

---

## 4.2 — Typing indicators + read receipts

### Problem
When an operator is typing a reply in the inbox, the customer sees nothing. The
widget shows a typing bubble only for AI (existing). Read receipts are also absent.

### Design

#### Typing indicators

**Operator → Customer (existing partial)**

The AI typing indicator already exists (the bubble animation in `MessageList.tsx`).
Operator typing requires a new socket path.

In `apps/web` operator inbox, when the operator types:
```typescript
// apps/web/src/components/inbox/MessageComposer.tsx
// Add to onChange handler:
socket.emit("operator:typing", { conversationId, isTyping: true });
// Add debounce to emit typing:false after 2s of inactivity
```

In `apps/api/src/socket/index.ts`:
```typescript
socket.on("operator:typing", ({ conversationId, isTyping }) => {
  io.to(`contact:${contactSessionId}`).emit("operator:typing", {
    conversationId, isTyping,
  });
});
// ContactSessionId is resolved from the conversation record on the API side
// before re-emitting to the customer room
```

In the widget `WidgetRoot.tsx`:
```typescript
socket.on("operator:typing", ({ isTyping }) => {
  dispatch({ type: "OPERATOR_TYPING", isTyping });
});
```

Render a typing bubble in `MessageList.tsx` on the left (operator/AI side) when
`operatorTyping === true`.

**Customer → Operator**

Similarly, when the customer types in the widget Composer:
```typescript
// apps/widget/src/components/Composer.tsx (onInput handler)
socket.emit("customer:typing", { conversationId, isTyping: true });
```

```typescript
// socket/index.ts re-emits to org room:
socket.on("customer:typing", ({ conversationId, isTyping }) => {
  io.to(`org:${organizationId}`).emit("customer:typing", { conversationId, isTyping });
});
```

Dashboard inbox shows a typing indicator badge on the conversation row.

#### Read receipts

**Operator reads customer messages**

When an operator opens a conversation in the inbox:
```typescript
socket.emit("operator:read", { conversationId });
```

API marks all customer messages in that conversation as `readByOperator: true`
(field already exists on `Message`). Emit `messages:read` to the widget:
```typescript
io.to(`contact:${contactSessionId}`).emit("messages:read", { conversationId });
```

Widget renders read ticks (✓✓) under sent customer messages.

**Minimal scope for launch**: implement operator→customer typing only; customer→
operator and read receipts can be a follow-up. Mark in the dashboard as "Phase B".

#### New socket events

| Event | Direction | Payload |
|---|---|---|
| `operator:typing` | Operator → API → Widget | `{ conversationId, isTyping: bool }` |
| `customer:typing` | Widget → API → Dashboard | `{ conversationId, isTyping: bool }` |
| `operator:read` | Dashboard → API | `{ conversationId }` |
| `messages:read` | API → Widget | `{ conversationId }` |

No new env vars. No new models.

---

## 4.3 — Launcher unread badge

### Problem
If a proactive message fires before the visitor opens the widget, there is no
visual cue that something arrived.

### Design

**Embed launcher** (`apps/embed/src/widget.ts`):

Maintain an `unreadCount: number` in the embed. Increment when a proactive
message fires (4.1) or when `message:new` is received via `postMessage` while the
widget is closed. Decrement to 0 when the widget opens.

```typescript
let unreadCount = 0;

function incrementUnread() {
  unreadCount++;
  renderBadge(unreadCount);
}

function clearUnread() {
  unreadCount = 0;
  renderBadge(0);
}

function renderBadge(count: number) {
  const badge = document.getElementById("csb-unread-badge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? "9+" : String(count);
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }
}
```

**Badge HTML** (injected by `injectStyles()` alongside the launcher):
```html
<div id="csb-unread-badge" style="
  display: none;
  position: absolute;
  top: -4px; right: -4px;
  width: 20px; height: 20px;
  background: #ef4444;
  color: white;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  align-items: center;
  justify-content: center;
  z-index: 2147483647;
  border: 2px solid white;
  pointer-events: none;
"></div>
```

**Widget → embed message**: when a new AI/proactive message arrives while the
widget is in a closed state, the widget `postMessage`s `csb:unread` to the embed:
```typescript
// WidgetRoot.tsx: on message:new if widget is not focused/visible
window.parent.postMessage({ type: "csb:unread", count: newCount }, "*");
```

**Clearing**: when the visitor opens the widget (`csb:open` message), clear the
badge.

### Dependency
Unread badge without proactive triggers (4.1) only shows for incoming AI replies
to messages the customer already sent (less valuable). Still useful as a
standalone improvement; ship it with 4.1 for maximum impact.

---

## Files summary

| File | Change |
|---|---|
| `apps/api/src/models/ProactiveTrigger.ts` | New model |
| `apps/api/src/routes/widget.routes.ts` | `GET /triggers` endpoint; accept proactive message |
| `apps/api/src/socket/index.ts` | `operator:typing`, `customer:typing`, `operator:read` handlers |
| `apps/api/src/services/ai/agent.service.ts` | Seed proactive context when `role: "proactive_trigger"` |
| `apps/embed/src/widget.ts` | Trigger loading, condition evaluation, cooldown, badge |
| `apps/widget/src/components/WidgetRoot.tsx` | `csb:proactive` + `csb:unread` message handlers; socket typing events |
| `apps/widget/src/components/MessageList.tsx` | Operator typing bubble; read ticks |
| `apps/widget/src/components/Composer.tsx` | Emit `customer:typing` on input |
| `apps/web/src/components/inbox/MessageComposer.tsx` | Emit `operator:typing` on input |
| `apps/web/src/app/(dashboard)/app/widget/page.tsx` | Triggers tab in Widget Studio |

## New env vars
None for Tier 4.

## Acceptance

- [ ] Visitor lands on `/pricing`, stays 30s → widget opens with a proactive greeting from the AI.
- [ ] Trigger respects `cooldownMs` — second visit within 24h does not re-fire.
- [ ] Operator starts typing in inbox → customer sees a typing indicator in the widget.
- [ ] Proactive message fires while widget is closed → red badge with count appears on launcher.
- [ ] Opening the widget clears the badge.
- [ ] Trigger management UI in Widget Studio works: add, edit, toggle, preview.
