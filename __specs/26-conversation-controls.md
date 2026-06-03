# 26 — Conversation Resolution Consent & Human-Escalation Toggle

## Overview

Backlog items #9 (org-level toggle to allow/disallow human escalation) and #10 (always ask the visitor before resolving a conversation). Both are **org-configurable conversation-behavior controls** that gate the AI agent and surface in the widget. Plan: [`__plans/10-conversation-controls.md`](../__plans/10-conversation-controls.md). Builds on the AI agent ([`05-ai-agent-design.md`](./05-ai-agent-design.md)) and widget state machine ([`09-widget-state-machine.md`](./09-widget-state-machine.md)).

## Current state

| Piece | Status | Evidence |
|---|---|---|
| Conversation status | ✅ | `Conversation.ts` — `active/escalated/resolved/expired`, `resolvedBy`, `resolvedAt`, `escalatedAt` |
| AI resolve tool | ✅ | `tools.ts:resolve_conversation` ("Use ONLY when customer has confirmed their issue is fixed") |
| AI escalate tool | ✅ | `tools.ts:escalate_conversation` (`reason`) |
| Resolve/escalate execution | ✅ | `agent.service.ts` sets status + emits `conversation:updated` |
| Escalation policy in prompt | ✅ (prompt-only) | `prompts.ts` — already "don't auto-escalate; ask, escalate only on explicit yes" |
| Resolve policy in prompt | ⚠️ weak | `prompts.ts` — "call only when the customer confirms" (instruction, not enforced) |
| Org settings | ✅ but untyped | `Organization.settings` = Mixed; `PATCH /orgs/current` pass-through; UI exposes only org name |
| Widget resolved UI | ✅ | `ResolvedScreen.tsx`; state machine `CONVERSATION_STATUS_CHANGED → resolved/escalated` |

**Key insight:** the *intent* of both features already lives in the prompt, but neither is (a) configurable per org nor (b) enforced beyond a soft instruction. This spec makes them **typed org settings** that gate prompt + tools + UI.

## Typed org settings (new)

Introduce a typed `conversation` block under `Organization.settings` (still stored in the Mixed field, but read/written through a typed shape + Zod validation in `org.routes.ts`):
```
settings.conversation = {
  allowHumanEscalation: boolean,   // #9 — default true
  requireResolveConfirmation: boolean, // #10 — default true
}
```
Defaults preserve current behavior (escalation allowed; ask-before-resolve already the prompt's intent).

---

## Feature 1 — Human-escalation toggle (#9)

### Design
When `allowHumanEscalation === false` for the org:
- **Prompt**: `buildSystemPrompt` omits the "offer a human / escalate on yes" policy and instead instructs the AI to **not** offer human handoff (politely explain self-serve only).
- **Tools**: `escalate_conversation` is **removed from the tool list** passed to the model for that conversation (hard gate — the model can't escalate even if it tries).
- **Operator path**: operators can still manually set `escalated` via the inbox (org-internal decision, not visitor-driven) — unaffected.
- **Widget**: no "talk to a human" affordance is shown.

When `true` (default): current behavior unchanged.

### Decisions
- Gate at **both** prompt and tool-list level (defense in depth) — tool removal is the hard guarantee.
- Operator-initiated escalation remains available regardless (the toggle governs **AI/visitor-initiated** handoff).

---

## Feature 2 — Ask before resolving (#10)

### Problem
Today the AI may call `resolve_conversation` based on its own judgment. The requirement: **always** confirm with the visitor first.

### Design (prompt + explicit confirm step)
When `requireResolveConfirmation === true` (default):
- **Prompt**: strengthen the resolve policy to a hard rule — the AI must first send a confirmation question ("Did that solve your issue? Shall I close this conversation?") and may only call `resolve_conversation` **after** an affirmative reply.
- **Two-step tool guard**: the `resolve_conversation` tool gains a `confirmed: boolean` arg. The executor **rejects** resolution (returns a tool error telling the model to ask first) unless `confirmed === true` AND the immediately preceding turn was the visitor answering yes. This makes the rule enforceable, not just advisory.
- **Widget UX (optional but recommended)**: render the AI's confirmation as a lightweight inline prompt with **Yes, close** / **Not yet** quick-reply buttons in the chat (no new terminal state needed; reuse `chat_active`). Clicking sends the corresponding message, which the AI interprets. The existing `ResolvedScreen` still shows only after status actually becomes `resolved`.

### Decisions
- Prefer the **conversational** confirm (AI asks → visitor answers) reinforced by the tool guard, over a hard modal — keeps the flow natural and works even without widget changes. Quick-reply buttons are a UX nicety layered on top.
- When `requireResolveConfirmation === false`, the AI may resolve as today.
- Operator manual resolve from the inbox is **not** gated by this (operators are trusted); only AI-driven resolution requires visitor consent.

### Open questions
- O1: Should operator-side resolve also prompt ("are you sure")? → Default: **no** — operators are trusted; keep it one-click. (Toggle governs AI only.)

---

## UI surfacing
- New **"Conversation"** settings tab (or a section in the existing settings/AI page) in `apps/web` exposing two switches: *Allow human escalation* and *Ask visitors before resolving*. Saved via `PATCH /orgs/current` (typed validation added).
- Reads current values; defaults shown when unset.

## Files
- [`apps/api/src/models/Organization.ts`](../apps/api/src/models/Organization.ts) — document the typed `settings.conversation` shape (still Mixed) .
- [`apps/api/src/routes/org.routes.ts`](../apps/api/src/routes/org.routes.ts) — Zod-validate `settings.conversation` on PATCH.
- [`apps/api/src/services/ai/prompts.ts`](../apps/api/src/services/ai/prompts.ts) — conditional escalation/resolve policy.
- [`apps/api/src/services/ai/tools.ts`](../apps/api/src/services/ai/tools.ts) — conditional tool list; `resolve_conversation.confirmed` arg + guard.
- [`apps/api/src/services/ai/agent.service.ts`](../apps/api/src/services/ai/agent.service.ts) — pass org settings into prompt/tool assembly; enforce confirm guard.
- Widget: optional quick-reply buttons in `apps/widget/src/components` (chat composer/message area).
- `apps/web` settings UI — Conversation tab.

## Out of scope
- Per-agent (vs per-org) overrides of these toggles.
- Operator-side resolve confirmation.
- Post-resolution CSAT/survey prompts.

## Acceptance
- [ ] Org with `allowHumanEscalation:false` → AI never offers/!escalates (tool absent); widget shows no human affordance; operator manual escalate still works.
- [ ] Org with `requireResolveConfirmation:true` (default) → AI asks before resolving; `resolve_conversation` rejected unless confirmed; conversation only resolves after visitor says yes (`mongo-mcp`: `resolvedBy:"ai"` only post-confirm).
- [ ] Toggling both in the Conversation settings tab persists (`PATCH /orgs/current`) and changes behavior on the next message.
- [ ] `pnpm build` + `type-check` + `test` green.
