# Phase 8 — Affiliate / Referral System (+ Mailer)

> Spec: [`__specs/25-affiliate-system.md`](../__specs/25-affiliate-system.md). Backlog #3. **Greenfield**, plus a new mailer service.

## Goal

Let any user share a referral link, attribute referred org signups (credentials + Google), and — when a referred org subscribes to a paid plan — record an earned commission, notify the referrer by email, and let an admin review/mark payouts. Ships a reusable `nodemailer` mailer wired to the stored SMTP settings.

## Prerequisites

- Signup + Paddle subscription lifecycle in place (Phase 7 recommended first, for the plan catalog used to compute commissions).
- `PlatformSetting.smtp` (exists); SMTP test creds (e.g., Mailtrap from `.env`).

## Skills to invoke

- [[__skills/express-mongoose-scaffold]] — models, attribution, referral + admin routes.
- [[__skills/nextjs16-template-migration]] — `/app/referrals` + `/admin/referrals` pages.
- [[__skills/paddle-billing]] — commission trigger inside `handlePaddleEvent`.
- [[__skills/webapp-testing]] — end-to-end referral funnel verification.

## Work breakdown (ordered)

### Mailer (dependency)

| # | Task | Files | Skill | Acceptance |
|---|------|-------|-------|------------|
| 1 | Add `nodemailer`; `mailer.service.ts` reads SMTP from `PlatformSetting.smtp`; graceful no-op + warn when unconfigured; simple template helper | `apps/api/package.json`, `apps/api/src/services/mailer.service.ts` (new) | express-mongoose-scaffold | Sends a test email via Mailtrap; no-ops when unconfigured |

### Data model + attribution

| # | Task | Files | Skill | Acceptance |
|---|------|-------|-------|------------|
| 2 | `User.referralCode` (unique, sparse) + lazy generator; `Organization.referredByUserId` (sparse) | `apps/api/src/models/User.ts`, `Organization.ts` | express-mongoose-scaffold | Code generated; fields persist |
| 3 | `Referral` model (status lifecycle, commission fields, indexes) | `apps/api/src/models/Referral.ts` (new) | express-mongoose-scaffold | CRUD + indexes; unique per referred org |
| 4 | Capture `?ref=` in signup (persist across Google round-trip via cookie/localStorage); pass to `/register` + `/auth/google` | `apps/web/src/components/ns/authentication/SignupHero.tsx`, `apps/web/src/lib/auth.ts` | nextjs16-template-migration | `ref` survives OAuth redirect; sent to API |
| 5 | Bind attribution in `registerUser` + `ensureMembershipForUser`: resolve code→referrer, reject self-referral, set `referredByUserId`, create `Referral{pending}` | `apps/api/src/services/auth.service.ts`, `apps/api/src/routes/auth.routes.ts` | express-mongoose-scaffold | Org bound; `Referral{pending}` created; self-referral rejected |

### Commission + payout

| # | Task | Files | Skill | Acceptance |
|---|------|-------|-------|------------|
| 6 | In `handlePaddleEvent`, on first `active` sub for a referred org: compute commission from plan catalog × `ratePercent`, set `Referral.earned`, snapshot plan/subscriptionId, email referrer | `apps/api/src/services/billing.service.ts` | paddle-billing | Referral flips `pending→earned` with correct cents; email sent |
| 7 | `PlatformSetting.affiliate.{enabled,ratePercent,cookieDays}` + defaults (20%, 60d); void stale pending past window (lazy or job) | `apps/api/src/models/PlatformSetting.ts`, `apps/api/src/routes/admin.routes.ts` | express-mongoose-scaffold | Config readable; stale pending → void |

### Routes + UI

| # | Task | Files | Skill | Acceptance |
|---|------|-------|-------|------------|
| 8 | Referral routes: `GET /referrals/me`, `POST /referrals/code`; admin `GET /admin/referrals`, `POST /admin/referrals/:id/mark-paid`, `GET /admin/referrals/export.csv` | `apps/api/src/routes/referral.routes.ts` (new), `admin.routes.ts` | express-mongoose-scaffold | Endpoints return correct funnel/earnings; admin-gated |
| 9 | `/app/referrals` page (link + copy, funnel stats, table, earnings) + nav item (Account group, `Share2`) | `apps/web/src/app/(dashboard)/app/referrals/page.tsx` (new), `app-shell.tsx` | nextjs16-template-migration | Page renders real data |
| 10 | `/admin/referrals` page (list, filters, mark-paid, CSV) + nav item; affiliate config in admin settings | `apps/web/src/app/(admin)/admin/referrals/page.tsx` (new), `admin-shell.tsx`, admin settings form | nextjs16-template-migration | Admin can review + mark paid + export |
| 11 | Update spec 25 + this plan with deltas; append `CHANGELOGS_*.md` | docs | — | Docs match shipped behavior |

## Decisions baked in (from spec)
- First-subscription commission, default 20%, 60-day window; manual CSV payout v1.
- One immutable referrer per org; no self-referral.
- `nodemailer` + stored SMTP (secret encryption is a separate TODO).

## Verification
- [ ] `/register?ref=<code>` → credentials signup **and** Google signup both set `referredByUserId` + `Referral{pending}` (`mongo-mcp`); self-referral rejected.
- [ ] Referred org activates a sandbox sub → `Referral.earned` with correct `commissionCents`; referrer emailed (Mailtrap).
- [ ] `/app/referrals` funnel/earnings correct; `/admin/referrals` filter + mark-paid + CSV work.
- [ ] `pnpm build` + `type-check` + `test` green.

## Out of scope (defer)
- Automated payouts, recurring/lifetime commissions, multi-tier networks, advanced fraud detection, SMTP-secret encryption.
