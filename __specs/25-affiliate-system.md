# 25 — Affiliate / Referral System (+ Mailer)

## Overview

Backlog item #3: "build a user affiliate system for marketing." This is **greenfield** — no referral/affiliate/commission code exists. It also requires a **mailer service**, which doesn't exist yet (SMTP config is stored in `PlatformSetting` but never used). Plan: [`__plans/09-affiliate-system.md`](../__plans/09-affiliate-system.md).

The system lets any user share a referral link; when a referred org subscribes to a paid plan, the referrer earns a commission tracked through to payout. Attribution hangs at the **organization** level (one signup = one commission subject) keyed to the referrer's user.

## Current state (hooks to build on)

| Piece | Status | Evidence |
|---|---|---|
| Referral/affiliate code | ❌ none | repo-wide search: no matches |
| `User` model | ✅ | `apps/api/src/models/User.ts` — add `referralCode` |
| `Organization` model | ✅ | `Organization.ts` — add `referredByUserId` |
| Signup (credentials) | ✅ | `auth.routes.ts:POST /register` → `auth.service.ts:registerUser` (creates user+org+owner membership) |
| Signup (Google) | ✅ | `auth.routes.ts:POST /auth/google` → `ensureMembershipForUser` (auto-creates org) |
| Web signup form | ✅ | `apps/web/src/components/ns/authentication/SignupHero.tsx` (no `?ref=` capture) |
| Subscription lifecycle | ✅ | `billing.service.ts:handlePaddleEvent` — the commission trigger point |
| Dashboard nav | ✅ | `apps/web/src/components/layouts/app-shell.tsx` (groups: Workspace/Configure/Account) |
| SMTP settings | ✅ stored, ❌ unused | `PlatformSetting.smtp`; **no mailer service**, `nodemailer` not installed |

---

## Data model

### New: `ReferralCode` (or field on User)
- Add `referralCode: string` (unique, sparse) to `User`, generated lazily (first dashboard visit or on registration). This is the `?ref=` key.

### New: `Referral` model
Tracks attribution + commission lifecycle:
```
{
  referrerUserId: ObjectId<User>,      // who referred
  referredOrganizationId: ObjectId<Organization> (unique),
  referredUserId: ObjectId<User>,      // the org owner who signed up
  status: "pending" | "qualified" | "earned" | "paid" | "void",
  plan: Plan,                          // snapshot when earned
  subscriptionId: ObjectId<Subscription> | null,
  commissionCents: number,             // computed at "earned"
  commissionRate: number,              // % applied (from config)
  qualifiedAt, earnedAt, paidAt: Date | null,
  payoutRef: string | null,            // external payout id/batch
  createdAt, updatedAt,
}
```
Indexes: `referrerUserId + status`, unique `referredOrganizationId`.

### `Organization`
- `referredByUserId: ObjectId<User>` (sparse) — set at signup if a valid `?ref=` was present (self-referral rejected).

## Attribution flow

1. **Capture** — `SignupHero.tsx` reads `?ref=<code>` from the URL (and persists to a short-lived cookie/localStorage so it survives the Google round-trip), forwards it to `POST /register` and the `/auth/google` exchange.
2. **Bind** — `registerUser` / `ensureMembershipForUser` resolve `code → referrer user`; reject self-referral; set `Organization.referredByUserId`; create a `Referral{status:"pending"}`.
3. **Qualify/Earn** — in `handlePaddleEvent`, when a referred org's subscription becomes `active` (first paid), find its `Referral`, compute `commissionCents` from the plan catalog ([`24-paddle-subscriptions.md`](./24-paddle-subscriptions.md) `config/plans.ts`) × `commissionRate`, set `status:"earned"`, snapshot plan + subscriptionId; email the referrer.
4. **Pay** — admin marks payouts paid (manual/CSV export v1); `status:"paid"`, `payoutRef` recorded.

## Commission policy
- Decisions:
  - **Model**: first-subscription commission (one-time), `commissionRate` default **20%** of the first paid period, configurable via `PlatformSetting.affiliate.{enabled, ratePercent, cookieDays}`.
  - **Attribution window**: `cookieDays` default **60**; a `Referral` left `pending` past the window without a paid sub is `void`.
  - **No self-referral**; one referrer per org (first valid wins, immutable).
  - **Payout** v1 is **manual** (admin reviews `earned`, exports CSV, marks `paid`). Automated payouts (Paddle/Stripe Connect/PayPal) are out of scope.

## API
- `GET /referrals/me` — caller's code, share URL, funnel counts (pending/earned/paid), earnings total, list.
- `POST /referrals/code` — (re)generate the caller's code if absent.
- Admin: `GET /admin/referrals` (all, filter by status), `POST /admin/referrals/:id/mark-paid`, `GET /admin/referrals/export.csv`.
- Attribution additions to `POST /register` + `POST /auth/google` (optional `referralCode`).

## UI
- **Dashboard**: new `/app/referrals` page (nav item in **Account** group, icon `Share2`): share link + copy button, funnel stats, referral table, earnings + payout status. (Mirrors existing dashboard page patterns.)
- **Admin**: new `/admin/referrals` page: all referrals, status filters, mark-paid, CSV export. Add `affiliate.{enabled,ratePercent,cookieDays}` to the admin settings (Theming/General) form.
- **Signup**: `SignupHero.tsx` shows a subtle "Referred by …" hint when `?ref=` is valid.

## Mailer (prerequisite dependency)
- New `apps/api/src/services/mailer.service.ts` using `nodemailer`, reading SMTP from `PlatformSetting.smtp` (host/port/user/secret/from). Graceful no-op + warn when unconfigured.
- Used here for: referrer "you earned a commission" + "new pending referral". Also unlocks verification/reset/dunning emails elsewhere (cross-cutting benefit, but only the affiliate emails are in this phase's scope).
- Decision: `nodemailer` (SMTP already modeled) over a SaaS provider; secret stays in `PlatformSetting` (flag: encrypt-at-rest is a known TODO on that field).

---

## Out of scope
- Automated payouts / payment-provider payout integration.
- Recurring (lifetime) commissions — v1 is first-subscription only.
- Multi-tier / sub-affiliate networks.
- Fraud/abuse detection beyond self-referral + one-referrer-per-org.
- Encrypting the stored SMTP secret (tracked separately).

## Acceptance
- [ ] A user gets a referral link; visiting `/register?ref=<code>` and completing signup (credentials **and** Google) sets `Organization.referredByUserId` and creates `Referral{pending}` (`mongo-mcp`); self-referral rejected.
- [ ] When the referred org's sandbox subscription activates, the `Referral` flips to `earned` with correct `commissionCents`, and the referrer receives an email.
- [ ] `/app/referrals` shows link + funnel + earnings; `/admin/referrals` lists all, filters, marks paid, exports CSV.
- [ ] Mailer sends via `PlatformSetting.smtp`; no-ops cleanly when unconfigured.
- [ ] `pnpm build` + `type-check` + `test` green.
