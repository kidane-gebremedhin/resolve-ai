# Changelog 6 — Landing Page Color Visibility Fixes

## Root Cause

Tailwind v4 with `@theme inline` compiles color utilities to reference the Shadcn CSS tokens directly (`var(--secondary)`, `var(--accent)`), **not** the ns-theme `--color-secondary`/`--color-accent` overrides. So `bg-secondary`, `text-secondary`, `bg-accent`, `text-accent` etc. always resolve to the dashboard's light-gray values from `:root` — the `.ns-theme` class overrides are completely bypassed by Tailwind utilities.

In light mode, `var(--secondary)` and `var(--accent)` are both near-white (`oklch(0.955...)`), making any text using these tokens invisible on a light background.

---

## Changes

### `apps/web/src/components/ns/homepage-34/Pricing.tsx`

- **Monthly/Yearly toggle**: replaced `bg-secondary dark:bg-accent text-accent dark:text-[#1a1a1c]` / `text-secondary/80 dark:text-accent/80` with explicit hex classes:
  - Active: `bg-[#1a1a1c] dark:bg-[#fcfcfc] text-[#fcfcfc] dark:text-[#1a1a1c]`
  - Inactive: `text-[#1a1a1c]/60 dark:text-[#fcfcfc]/60 hover:text-[#1a1a1c] dark:hover:text-[#fcfcfc]`
- **"What's included" feature labels**: replaced `text-secondary/60 dark:text-accent/60` → `text-[#1a1a1c]/60 dark:text-[#fcfcfc]/60`
- **Plan card feature value text**: same replacement in the per-plan feature row cells
- **Check icon circle**: replaced `bg-secondary dark:bg-accent` → `bg-[#1a1a1c] dark:bg-[#fcfcfc]` and `fill-white dark:fill-secondary` → `fill-[#fcfcfc] dark:fill-[#1a1a1c]`

### `apps/web/src/components/ns/shared/FooterOne.tsx`

- **Footer background**: changed `bg-secondary dark:bg-background-8` → `bg-[#1a1a1c] dark:bg-background-8`
  - `bg-secondary` was resolving to near-white in light mode (Tailwind token issue above), making all footer text (`.footer-link` = `#f4f2fe`, `text-primary-50`, `text-accent`) invisible on the light background
  - Explicit `bg-[#1a1a1c]` ensures the footer always has a dark background in light mode, matching the intended design and making all existing light-colored text readable
