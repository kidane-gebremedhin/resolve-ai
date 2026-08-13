# 36 — Lifetime-deal (LTD) coupon redemption

Fulfilment for AppSumo / PitchGround / StackSocial campaigns. A buyer enters a
code and their workspace is upgraded **directly**. Coupons are **not** checkout
discounts and never touch Paddle.

---

## 1. Where entitlement lives (and why that shapes everything)

This is a multi-tenant app: the paid tier is **org-scoped**, not per-user.

- `Organization.plan` — `"pro" | "business" | "enterprise"`, **absent = unsubscribed**.
  This is the fast path read by `plan-limit.middleware`.
- `Subscription` — one per org. `GET /billing/subscription` derives `active` from
  *a Subscription existing with status `active` or `trialing`*, and
  `apps/web/src/app/(dashboard)/app/layout.tsx` hard-redirects to `/checkout`
  when `active` is false.

Three consequences the implementation is built around:

1. **A coupon upgrades an organization, not a user.** Redemption therefore
   requires `requireOrgRole("admin")` — the same bar as every other billing
   route. Agents and viewers get 403.
2. **A grant must write a `Subscription` row**, not just `Organization.plan`.
   Setting the mirror alone would leave redeemers bounced to `/checkout` with a
   plan they'd already paid for.
3. **There is no `lifetime` tier and no `free` tier.** `grantsTier` uses the real
   plan values. What makes a grant *lifetime* is the subscription period end
   (100 years out), not an invented enum value. Ranking is
   `none(0) < pro(1) < business(2) < enterprise(3)` via `planRank()` in
   `config/plans.ts`.

Coupon-granted subscriptions carry `source: "coupon"` and no Paddle identifiers,
so the billing UI's existing `hasPaddleCustomer` guard already hides the customer
portal and cancel actions for them — no Paddle call is ever attempted against a
subscription that has no Paddle object.

---

## 2. Data model

### `Coupon` (`apps/api/src/models/Coupon.ts`)

`code` (unique, forced uppercase), `grantsTier`, `maxRedemptions`,
`redemptionsCount`, `maxPerUser`, `validFrom`, `validUntil` (null = never
expires), `isActive`, `partner`, `campaign`, `description`, `internalNotes`,
`createdBy`, timestamps.

Indexes: unique `code`; `partner`; `grantsTier`; `isActive`; `(validFrom, validUntil)`.

`internalNotes` is **never** serialised to a non-admin — the only shape a
customer sees is `toPublicCoupon()`, an explicit whitelist.

### `CouponRedemption` (`apps/api/src/models/CouponRedemption.ts`)

Append-only audit log. `couponId`, `couponCode` (denormalised so history
survives coupon deletion), `userId`, `userEmail`, `organizationId`,
`tierGranted`, `redeemedAt`, `ipAddress`, `userAgent`.

Indexes: `(userId, couponId)`; `couponId`; `redeemedAt` desc; and
**unique `(couponId, organizationId)`**.

That last index replaces the more obvious unique `(userId, couponId)`. Because
the grant lands on the organization, org-uniqueness is both stricter and more
correct — it also stops two different admins of the same workspace burning two
slots on a plan the workspace can only hold once.

The only delete path is the compensating rollback in §4; such a row never
corresponded to an actual grant.

---

## 3. Business rules

Evaluated in order, each with its own message:

| # | Rule | Message |
|---|------|---------|
| 1 | code exists (uppercase compare) | `Invalid coupon code` |
| 2 | `isActive` | `This coupon is no longer active` |
| 3 | `validFrom <= now` | `This coupon is not yet valid` |
| 4 | `validUntil` null or `>= now` | `This coupon has expired` |
| 5 | `redemptionsCount < maxRedemptions` | `This coupon has reached its maximum number of uses` |
| 6 | user's redemptions `< maxPerUser`, and org has none | `You have already used this coupon` |
| 7 | `planRank(current) < planRank(grantsTier)` | `You already have a {tier} plan` |

Rule 7 is a ranked comparison, never a chain of `if`s, and never compares against
a plan value outside the `Plan` union. Redeeming can only ever upgrade.

---

## 4. Atomicity — the core requirement

A validate-then-increment implementation lets two requests both pass validation
on the final slot and both get upgraded. On a launch-day spike that over-issues
lifetime plans you are contractually stuck honouring.

The slot is claimed with **one conditional write** that re-asserts the kill
switch, the validity window and remaining capacity in the same filter as the
increment:

```js
Coupon.findOneAndUpdate(
  {
    code, isActive: true, validFrom: { $lte: now },
    $and: [
      { $or: [{ validUntil: null }, { validUntil: { $exists: false } }, { validUntil: { $gte: now } }] },
      { $expr: { $lt: ["$redemptionsCount", "$maxRedemptions"] } },
    ],
  },
  { $inc: { redemptionsCount: 1 } },
  { new: true },
)
```

`$expr` compares the two fields server-side, so no read-modify-write window
exists. A `null` return means the coupon sold out (or was switched off) between
validation and the write → `sold_out`, and **no upgrade happens**.

Order of operations:

1. **Claim the slot** (above).
2. **Write the audit row** — before the grant, so the unique
   `(couponId, organizationId)` index rejects a racing duplicate *before* any
   entitlement is applied. Duplicate key → `already_used`, slot released.
3. **Apply the entitlement** — `Subscription` upsert + `Organization.plan` mirror.

Every failure after step 1 releases the slot (`$inc: -1`); a failure in step 3
also deletes the audit row it just wrote. A failed redemption never consumes
capacity. If the compensating write itself fails it is logged at error level —
that leaks one slot, which under-issues rather than over-issues.

Transactions are deliberately not used: `mongodb-memory-server` runs a
single-node deployment without transaction support, and the guarded-update plus
unique-index approach is correct without them.

---

## 5. API

| Route | Guard | Notes |
|---|---|---|
| `POST /coupons/validate` | auth + org admin | Dry run. Returns `{ valid, coupon }` or `{ valid, error }`. Whitelisted fields only. |
| `POST /coupons/redeem` | auth + org admin | Atomic claim. 400 on any rule failure. Captures IP + UA. |
| `GET /admin/coupons` | platform admin | Filters `isActive`, `partner`, `grantsTier`; paginated; counts via one aggregate. |
| `POST /admin/coupons` | platform admin | Single, or `{ bulk: true, count }` (max 1000). |
| `PATCH /admin/coupons/:id` | platform admin | Only `isActive`, `validUntil`, `maxRedemptions`, `description`, `internalNotes`. |
| `DELETE /admin/coupons/:id` | platform admin | 409 if any redemption exists. |
| `GET /admin/coupons/:id/redemptions` | platform admin | Paginated history. |

`code` and `grantsTier` are immutable after creation — codes are already in
customers' hands, and re-pointing the tier would silently re-price everyone who
redeems next. The PATCH schema is `.strict()`, so attempting either is a 400.

`maxRedemptions` cannot be lowered below `redemptionsCount`; that would make
remaining capacity read as negative everywhere.

### Rate limiting (required, not optional)

A coupon code is a shared secret over a small alphabet, so both user endpoints
are throttled — keyed on the authenticated user id, falling back to IP:
validate 20 / 15 min, redeem 10 / hour. Without this the endpoint is a
brute-force oracle against the entire code space.

`COUPON_MASK_UNKNOWN_CODES=true` additionally collapses "unknown" and "inactive"
into one message so the endpoint can't confirm which codes are real.

---

## 6. Code generation

Alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — no `I`, `O`, `0` or `1`, so codes
survive being read aloud or retyped from a fulfilment email. Format
`PARTNER-XXXX-XXXX` with a partner, else `XXXX-XXXX-XXXX`.

Randomness is `crypto.randomBytes` with rejection sampling, never `Math.random()`.

Bulk generation inserts with `insertMany({ ordered: false })` and lets the unique
index reject collisions, retrying only the failures — not a `SELECT`-then-`INSERT`
existence check per code, which is racy and O(n) round trips at 1000 codes.

---

## 7. UI

- **Redemption widget** — `apps/web/src/components/billing/coupon-redemption.tsx`,
  on `/app/billing`. Uppercases as you type, validates on blur and on an explicit
  button, and only reveals **Redeem** once a code validates. Self-hides entirely
  at the top tier (nothing left to grant) and for members without `manageBilling`.
- **Admin page** — `apps/admin/src/app/(admin)/coupons/page.tsx`, nav entry
  "LTD Coupons" under **Revenue**. Table, single + bulk create, active toggle,
  redemption drill-down. Bulk results are copyable and exportable as CSV (with a
  UTF-8 BOM for Excel) — that is the hand-off artefact to the LTD platform.

The tier is **not** cached in a token — the dashboard reads it from the database
on every request — so a `router.refresh()` after redemption is enough to reflect
the new plan. There is no stale-JWT problem to work around.

---

## 8. Deployment

The new indexes (including the unique `(couponId, organizationId)`) are created
by `pnpm db:migrate`, which runs `syncIndexes()` on every model. **That step also
rebuilds `Subscription.paddleSubscriptionId` from `unique` to `unique + sparse`**,
which is what allows many coupon subscriptions to coexist without colliding on a
null value. Run it before deploying the API.

`pnpm db:seed:coupons` seeds eight coupons covering every rule state for manual
testing — see RUNBOOK §5.2.
