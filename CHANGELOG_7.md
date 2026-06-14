# Changelog 7

## Admin session separation

**Problem:** Admin and web apps both wrote `authjs.session-token` to `localhost`, causing cookies to collide — logging in/out of one app affected the other's session.

**Fix:**
- `apps/admin/src/lib/auth.ts` — Added `cookies` config with distinct names:
  - `admin-authjs.session-token`
  - `admin-authjs.callback-url`
  - `admin-authjs.csrf-token`
- `apps/admin/next.config.ts` — Added `env.NEXTAUTH_URL` mapping from `ADMIN_NEXTAUTH_URL` so NextAuth uses `localhost:3003` for the admin app instead of the shared `NEXTAUTH_URL=http://localhost:3000`.

---

## Horizontal scroll on admin tables

Changed `overflow-hidden` → `overflow-x-auto` on table container divs in:
- `apps/admin/src/components/admin/users-table.tsx`
- `apps/admin/src/components/admin/subscriptions-filter.tsx` (SubscriptionsTable)

---

## Enterprise plan default budget limits

`apps/api/src/config/plans.ts` — Changed `DEFAULT_BUDGET_LIMITS.enterprise` from unlimited (0/0) to:
- `orgMonthlyLimitUsd: 1000`
- `websiteMonthlyLimitUsd: 200`

---

## Admin organizations plan filter fix

`apps/admin/src/app/(admin)/organizations/page.tsx` — Removed non-existent `free` and `starter` options; fixed labels to match real plan names:
- `pro` → "Pro"
- `business` → "Business"
- `enterprise` → "Enterprise"

---

## Web AI usage report — days filter

`apps/web/src/app/(dashboard)/app/usage/page.tsx` — Added `searchParams` support for `?days=7|14|30|90`. The selected range is applied to the daily activity and daily cost charts. Default is 30 days.

New file: `apps/web/src/app/(dashboard)/app/usage/usage-days-filter.tsx` — Client component toggle bar for selecting the day range.

---

## Admin AI usage report page

New page: `apps/admin/src/app/(admin)/usage/page.tsx`
- Shows total platform spend (USD), total tokens, and a per-org+website breakdown table (top 50 rows by spend).
- Columns: rank, organization, website (name + domain), plan, tokens, AI calls, spend.
- Supports filters: billing month, custom date range (from/to), searchable organization dropdown, website dropdown.
- Resetting the org filter also resets the website filter.

API enhancements (`apps/api/src/routes/admin.routes.ts`):
- `GET /admin/usage/cost` — Enhanced to group by `(organizationId, websiteId)`, accept `from`/`to` date range and `organizationId`/`websiteId` filters, and return `rows` with org + website metadata.
- `GET /admin/usage/websites` — New lightweight endpoint returning a list of websites (name, domain) for the filter dropdown; accepts optional `organizationId` to scope the list.
- Imported `Website` model into admin routes.

New component: `apps/admin/src/components/admin/usage-filter.tsx` — `<UsageFilters>` client component with billing month picker, from/to date inputs, org dropdown, and website dropdown; all state lives in the URL.

Updated: `apps/admin/src/components/admin-app-shell.tsx` — Added "AI Usage" nav item (`DollarSign` icon) under the Revenue group.
