# Changelog 1

## Legal Policy Pages

Added three static legal policy pages to the marketing site, consistent with Paddle's Merchant of Record requirements for website verification.

### New Files
- `apps/web/src/app/(marketing)/privacy/page.tsx` — Privacy Policy page at `/privacy`
- `apps/web/src/app/(marketing)/refund/page.tsx` — Refund Policy page at `/refund`
- `apps/web/src/app/(marketing)/terms/page.tsx` — Terms of Service page at `/terms`

### Details
- All three pages use `LandingPageShell` (navbar + footer) for consistent branding
- Content mirrors shipfaster.app policy pages, adapted to use `APP_NAME` / `APP_LEGAL_NAME` env-driven variables so they rebrand automatically
- Footer already contained links to `/privacy`, `/refund`, and `/terms` in the "Legal Policies" section — no footer changes needed
- Pages are server components with proper `metadata` exports for SEO
