# 12 — List infrastructure (pagination, search, date range, filters)

Backlog #9–12: org-configurable pagination (default 10/page), live DB search, UTC
date-range filter on **every** list of records, and per-page filters (org pages:
website/agent/status; admin pages: organization/website/agent/plan/status).

**Approach (per direction):** a reusable core + per-page filter adaptation —
shared query helpers and shared UI controls, but each list declares its own
searchable fields, date field, and filter dimensions.

## Reusable core (built)

- **Backend** — [`apps/api/src/utils/list-query.ts`](../apps/api/src/utils/list-query.ts):
  `parseListParams` (page/pageSize/q/from/to), `searchFilter(q, fields)`,
  `dateRangeFilter(field, from, to)` (UTC, end-of-day inclusive),
  `mergeFilters(...)`, `paginate(model, filter, {params, sort, select})` →
  `{ items, total, page, pageSize, totalPages }`, and `getOrgPageSize(org)`
  (`settings.pagination.pageSize` ?? 10).
- **Frontend (admin)** — [`use-list-params.ts`](../apps/admin/src/components/admin/use-list-params.ts)
  (URL-query state; any change resets to page 1) +
  [`list-toolbar.tsx`](../apps/admin/src/components/admin/list-toolbar.tsx)
  (`ListToolbar`: debounced search, UTC date range, pagination footer, filter
  slot; `FilterSelect`: a URL-bound dropdown). Server page reads `searchParams`,
  calls the endpoint, renders a presentational table.

## Phases

- **Phase 1 (done):** core + **admin Users** reference (search email/name, `role`
  filter, `createdAt` UTC range, pagination). Verified live.
- **Phase 2 (done):** org-configurable page size — `settings.pagination.pageSize`
  (validated 1–200 in `PATCH /orgs/current`), a "List display → Results per page"
  control ([`list-preferences.tsx`](../apps/web/src/components/settings/list-preferences.tsx)
  on the AI/agent settings surface), and `getOrgPageSize` as the org-list default.
- **Phase 3 (done):** all **admin** lists converted to the envelope + URL-driven
  `ListToolbar`/`FilterSelect`: organizations (search name/slug, plan, date),
  agents (search name, active filter, org/website honored via URL, date),
  subscriptions (search Paddle IDs, plan + status, date; MRR computed over all
  active/trialing so pagination doesn't skew the header; org name self-joined).
  Aggregation lists use `paginateAggregate` (`$match` → `$facet`).
- **Phase 4 (in progress):** **org dashboard** lists. A web copy of the
  toolbar/hook lives in [`apps/web/src/components/lists/`](../apps/web/src/components/lists/).
  - **Leads/Contacts (done):** `GET /contacts` → envelope + search (email/phone/
    name), `createdAt` UTC range, website + `has` (email/phone/none) filters,
    `getOrgPageSize` pagination, and `stats` over the website scope. UI is
    server-driven; CSV export pulls the full filtered set in one call.
  - **Remaining (follow-up):** knowledge sources, conversations (inbox), websites,
    org agents. Inbox + knowledge are **socket-synced** (cursor pagination + live
    `*:updated` events) — convert carefully so live updates keep working
    (re-fetch the current page on the event rather than appending). Websites/
    org-agents are short CRUD lists; lower priority. Apply the same pattern:
    endpoint → envelope (+`getOrgPageSize`), page reads `searchParams`, render
    `ListToolbar` + presentational table.

## Notes / decisions

- Date inputs are date-only and treated as **UTC**; `to` extends to end-of-day.
- `pageSize` is clamped to 1–200; org default 10, admin/platform default 10.
- Conversations & knowledge are socket-synced — keep live updates working when
  adding server pagination (re-fetch the current page on the relevant event).
- The toolbar/hook currently live in `apps/admin`; Phase 4 should share them
  with `apps/web` (promote to `packages/ui` or duplicate) rather than diverge.
