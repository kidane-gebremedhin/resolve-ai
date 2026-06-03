# Phase 9 — Conversation Resolution Consent & Human-Escalation Toggle

> Spec: [`__specs/26-conversation-controls.md`](../__specs/26-conversation-controls.md). Backlog #9, #10.

## Goal

Make two conversation behaviors org-configurable and enforced: (#9) allow/disallow AI/visitor-initiated human escalation, and (#10) require the AI to ask the visitor for confirmation before resolving. Both are typed `Organization.settings.conversation` flags that gate the system prompt, the tool list, and the widget UI — with defaults that preserve today's behavior.

## Prerequisites

- AI agent with `resolve_conversation` / `escalate_conversation` tools + prompt layering (exists).
- Widget state machine + chat UI (exists).

## Skills to invoke

- [[__skills/express-mongoose-scaffold]] — typed org settings + Zod validation.
- [[__skills/socketio-realtime]] / AI agent internals — prompt + tool gating in `agent.service`.
- [[__skills/widget-embed-iframe]] — optional quick-reply confirm buttons.
- [[__skills/webapp-testing]] — behavior verification.

## Work breakdown (ordered)

| # | Task | Files | Skill | Acceptance |
|---|------|-------|-------|------------|
| 1 | Define typed `settings.conversation = { allowHumanEscalation:true, requireResolveConfirmation:true }`; Zod-validate on `PATCH /orgs/current`; default-fill on read | `apps/api/src/models/Organization.ts`, `apps/api/src/routes/org.routes.ts` | express-mongoose-scaffold | Settings persist + validate; defaults applied when unset |
| 2 | Thread org settings into prompt/tool assembly | `apps/api/src/services/ai/agent.service.ts` | express-mongoose-scaffold | Agent has access to the two flags per conversation |
| 3 | **#9** Prompt: when escalation disabled, omit human-offer policy + instruct self-serve-only; when enabled, current policy | `apps/api/src/services/ai/prompts.ts` | — | Prompt text switches on flag |
| 4 | **#9** Tools: drop `escalate_conversation` from the tool list when disabled (hard gate) | `apps/api/src/services/ai/tools.ts`, `agent.service.ts` | express-mongoose-scaffold | Model cannot escalate when disabled; operator manual escalate unaffected |
| 5 | **#10** Prompt: hard rule — confirm before resolving when `requireResolveConfirmation` | `apps/api/src/services/ai/prompts.ts` | — | AI asks before resolving |
| 6 | **#10** `resolve_conversation` gains `confirmed:boolean`; executor rejects resolution unless confirmed (+ preceding affirmative) | `apps/api/src/services/ai/tools.ts`, `agent.service.ts` | express-mongoose-scaffold | Resolve rejected pre-confirm; succeeds after yes |
| 7 | **#10** (optional) Inline quick-reply buttons (Yes, close / Not yet) on the AI confirm message; clicking sends the reply | `apps/widget/src/components/*` (chat area) | widget-embed-iframe | Buttons send messages; no new terminal state |
| 8 | Settings UI: "Conversation" tab with two switches; save via `PATCH /orgs/current` | `apps/web` settings components | nextjs16-template-migration | Toggles persist + reflect saved state |
| 9 | Update spec 26 + this plan with deltas; append `CHANGELOGS_*.md` | docs | — | Docs match shipped behavior |

## Decisions baked in (from spec)
- Defaults preserve current behavior (escalation on, ask-before-resolve on).
- Escalation gated at prompt **and** tool level; toggle governs AI/visitor-initiated handoff only — operator manual escalate/resolve stays one-click.
- Conversational confirm (AI asks → visitor yes) + tool guard, over a hard modal; quick-reply buttons are a nicety.

## Open questions (default if unanswered)
- **O1** Operator-side resolve confirmation → **no** (operators trusted).

## Verification
- [ ] `allowHumanEscalation:false` → no AI escalation/offer (tool absent), no widget human affordance, operator manual escalate still works.
- [ ] `requireResolveConfirmation:true` → resolve only after visitor confirms; tool rejects premature resolve (`mongo-mcp`).
- [ ] Conversation settings tab persists both toggles and changes next-message behavior.
- [ ] `pnpm build` + `type-check` + `test` green.

## Out of scope (defer)
- Per-agent overrides, operator-side resolve confirmation, post-resolution CSAT survey.
