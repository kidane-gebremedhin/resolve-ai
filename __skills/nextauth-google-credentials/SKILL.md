---
name: nextauth-google-credentials
description: Configure NextAuth in apps/web with Google OAuth and email/password credentials providers, JWT session strategy, and protected dashboard/admin route groups. Use during Phase 0 after the template migration to wire the existing login/signup pages to real auth. Implements __specs/10-frontend-phases.md Phase 0 + __specs/12-security-compliance.md.
---

# NextAuth (Google + Credentials)

## When to use

Phase 0, after [`nextjs16-template-migration`](../nextjs16-template-migration/) has moved the auth pages. Replaces the template's mock `SocialAuth` buttons + form with a working sign-in/sign-up flow. Required before any `/app/*` or `/admin/*` route can render real data.

## Prerequisites

- `apps/web/src/app/(auth)/login/page.tsx` and `(auth)/register/page.tsx` migrated from the template
- Google OAuth client created (Google Cloud Console → Credentials → OAuth 2.0 Client ID); `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in `.env`
- `NEXTAUTH_SECRET` generated (`openssl rand -base64 32`) and in `.env`
- `apps/api` registration endpoint stubbed (or wired in [`express-mongoose-scaffold`](../express-mongoose-scaffold/) — coordinate)

## Procedure

1. **Install deps in `apps/web`**: `next-auth@beta` (Next.js 16 + React 19 require the v5 line — verify against `node_modules/next-auth/` and project AGENTS.md).

2. **Auth config** — `apps/web/src/lib/auth.ts`:
   - Providers: `Google` (with `clientId` + `clientSecret`) and `Credentials` (email + password → hits `POST /auth/login` on the Express API)
   - Session strategy: `jwt` (15 min access TTL, refresh handled by the API)
   - `callbacks.jwt`: include `userId`, `organizationId`, `role` in the JWT after sign-in (so server components can read them without a DB hit)
   - `callbacks.session`: project JWT fields onto `session.user`
   - `pages`: `{ signIn: '/login', error: '/login' }`

3. **API route**: `apps/web/src/app/api/auth/[...nextauth]/route.ts` exports `GET` and `POST` from `NextAuth(authConfig).handlers`.

4. **Session provider** — wrap `(dashboard)/layout.tsx` and `(admin)/layout.tsx` in `<SessionProvider session={await auth()}>`. The marketing `(marketing)` group does NOT need it.

5. **Server-side guard for dashboard**: in `apps/web/src/app/(dashboard)/layout.tsx`, `const session = await auth(); if (!session) redirect('/login');`.

6. **Server-side guard for admin** (`requirePlatformAdmin`): in `apps/web/src/app/(admin)/layout.tsx`, also check `session.user.role === 'platform_admin'` and `notFound()` (not 403 — per spec §11 "Non-platform-admins receive a 404, not 403, to avoid revealing the route").

7. **Wire the existing template forms**:
   - `apps/web/src/components/auth/SocialAuth.tsx` (moved from `src/components/ns/authentication/SocialAuth.tsx`): replace mock button handlers with `signIn('google')`.
   - Login form: `signIn('credentials', { email, password, redirectTo: '/app' })`.
   - Register form: `POST /api/v1/auth/register` (Express) → on success `signIn('credentials', ...)`.

8. **Replace template placeholders in `AppShell`**:
   - Mock `workspaces[]` → real memberships from `useSession()` + `GET /orgs/current/members` (or pass as server-component prop)
   - "Maya Okafor" `UserMenu` → `session.user.name` / `session.user.email`

9. **Sign-out**: the `Log out` link in `UserMenu` already points to `/login`; change to call `signOut({ redirectTo: '/login' })`.

## Gotchas

- **NextAuth v5 vs v4** — Next.js 16 / React 19 needs v5 (`next-auth@beta` as of writing). The API surface differs significantly: `auth()` helper, `handlers` export, no `getServerSession`. Confirm in installed `node_modules/next-auth/`.
- **`NEXTAUTH_URL`** must match the public origin exactly (including HTTPS in prod). Mismatch causes silent OAuth callback failures.
- **JWT secret rotation** — the API and `apps/web` both sign/verify JWTs; if you rotate `JWT_SECRET` you must rotate `NEXTAUTH_SECRET` too OR keep them distinct (preferred — see spec §13).
- **Google OAuth in dev** — the OAuth client must have `http://localhost:3000/api/auth/callback/google` in its authorized redirect URIs.
- **Credentials provider security** — never log the password; never store it client-side. The Express API hashes with bcrypt (cost ≥ 12) per spec §12 §7.1.
- **`session.user.organizationId`** is the primary key for RLS in every dashboard request — never accept `organizationId` from the request body.

## Acceptance

- [ ] `pnpm --filter @csb/web build` succeeds
- [ ] Google sign-in: button click → Google consent → redirect → land on `/app` with session cookie set
- [ ] Email/password sign-up: form submit → user created in Mongo (verify via `mongo-mcp`) → auto-login → land on `/app`
- [ ] Unauthenticated `/app/inbox` redirects to `/login`
- [ ] Non-admin user hitting `/admin` gets a 404
- [ ] `AppShell` displays the real session user name + email (no `Maya Okafor`)
- [ ] Sign-out clears the session cookie and lands on `/login`

## Specs referenced

- [`__specs/10-frontend-phases.md`](../../__specs/10-frontend-phases.md) Phase 0 — NextAuth task list
- [`__specs/12-security-compliance.md`](../../__specs/12-security-compliance.md) — JWT lifetimes, bcrypt cost, lockout
- [`__specs/13-env-variables.md`](../../__specs/13-env-variables.md) — `NEXTAUTH_*`, `GOOGLE_CLIENT_*`
- [`__specs/11-page-wiremap.md`](../../__specs/11-page-wiremap.md) — admin 404-not-403 rule
- [`__specs/03-data-model.md`](../../__specs/03-data-model.md) — `users.role` enum, membership creation on signup
