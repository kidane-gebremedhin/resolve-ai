---
name: shadcn-ui-package
description: Extract the 40 shadcn/ui primitives from the template into a shared packages/ui workspace, with shared design tokens and the cn() utility. Use during Phase 0 as the first step of the template migration, before moving routes. Implements __specs/17-template-asset-inventory.md §4.5.
---

# Shared shadcn/ui Package

## When to use

Phase 0, the first move in [`nextjs16-template-migration`](../nextjs16-template-migration/). All apps (`@csb/web` and `@csb/widget`) import primitives from `@csb/ui`; nothing should import from `apps/web/src/components/ui/*`.

## Prerequisites

- `packages/ui/` exists with skeleton `package.json` (`@csb/ui`)
- The template's `src/components/ui/*` (40 files) is the source of truth

## Procedure

1. **Move primitives** — every file in `src/components/ui/` to `packages/ui/src/components/`. The list (sourced from spec §17 §4.5):

   ```
   accordion, alert-dialog, alert, aspect-ratio, avatar, badge, breadcrumb,
   button, calendar, card, carousel, chart, checkbox, collapsible, command,
   context-menu, dialog, drawer, dropdown-menu, form, hover-card, input-otp,
   input, label, menubar, navigation-menu, pagination, popover, progress,
   radio-group, resizable, scroll-area, select, separator, sheet, sidebar,
   skeleton, slider, sonner, switch, table, tabs, textarea, toggle-group,
   toggle, tooltip
   ```

2. **Move support files**:
   - `src/lib/utils.ts` → `packages/ui/src/lib/utils.ts` (exports `cn()`)
   - `src/hooks/use-mobile.tsx` → `packages/ui/src/hooks/use-mobile.tsx`
   - `components.json` (shadcn CLI config) → `packages/ui/components.json` so future `pnpm dlx shadcn add <component>` writes into the package, not into an app

3. **Barrel exports** — write `packages/ui/src/index.ts`:
   ```ts
   // Components
   export * from './components/accordion';
   export * from './components/alert';
   // ... one line per primitive
   // Hooks + utils
   export { cn } from './lib/utils';
   export { useIsMobile } from './hooks/use-mobile';
   ```

4. **Design tokens** — extract the `:root`, `.dark`, `--background`, `--foreground`, `--primary`, etc. variables from `src/app/globals.css` into `packages/ui/src/styles/tokens.css`. The two app-level `globals.css` files then `@import "@csb/ui/styles/tokens.css";` and only add app-specific overrides on top.

5. **Tailwind config** — `packages/ui/tailwind.config.ts` exports the `content`, `theme`, and `plugins` blocks shared between web + widget. Each app's own `tailwind.config.ts` extends it via:
   ```ts
   import shared from '@csb/ui/tailwind.config';
   export default { ...shared, content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'] };
   ```

6. **package.json deps** — `@csb/ui` declares Radix + cva + clsx + tailwind-merge + lucide-react as `dependencies`, and Tailwind 4 + `@tailwindcss/postcss` as `peerDependencies`. Apps that consume it install Tailwind themselves.

7. **Update imports in moved template files** — Phase 0's [`nextjs16-template-migration`](../nextjs16-template-migration/) edits `@/components/ui/*` → `@csb/ui` and `@/lib/utils` → `@csb/ui` across the moved files. Run a find-replace from the repo root after the file moves complete.

## Gotchas

- **Tailwind 4 content paths**: the consuming app's `tailwind.config.ts` must include `../../packages/ui/src/**/*.{ts,tsx}` in `content`, otherwise primitives' classes are tree-shaken out of the built CSS.
- **`use client` directive** — keep it on each primitive that originally had one (`dialog`, `dropdown-menu`, `tabs`, etc.). Don't strip them during the move.
- **`sonner` toaster** lives in `@csb/ui` but the `<Toaster />` provider must be mounted by the consuming app's root layout — don't try to mount it inside the package.
- **`useIsMobile` hook** uses `window.matchMedia` and must remain in a `'use client'` file.
- **`components.json`** updates: change `"aliases.components"` to the path used by consumers (e.g. `@csb/ui/components`) so future `shadcn add` reads/writes the right location.

## Acceptance

- [ ] `pnpm --filter @csb/ui build` succeeds (if a build step is configured; otherwise type-check passes)
- [ ] `import { Button } from '@csb/ui'` resolves from both `apps/web` and `apps/widget`
- [ ] Zero references to `@/components/ui/` remain in moved source files
- [ ] Tailwind classes from primitives appear in the built CSS for `apps/web` (verify by checking a `data-[state=open]:bg-*` class actually exists in `.next/static/css`)
- [ ] Cookie-driven dark theme tokens render correctly (both `:root` and `.dark` blocks from `tokens.css` are included)

## Specs referenced

- [`__specs/17-template-asset-inventory.md`](../../__specs/17-template-asset-inventory.md) §4.5 — full primitive list
- [`__specs/17-template-asset-inventory.md`](../../__specs/17-template-asset-inventory.md) §6 — design-token strategy
- [`__specs/02-monorepo-structure.md`](../../__specs/02-monorepo-structure.md) — `packages/ui` layout
