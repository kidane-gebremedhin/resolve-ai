// URLs for the admin portal — env-driven, no hardcoded host. The admin only
// needs the API base; a missing value fails fast.
function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var ${name}. Set it for this environment.`);
  }
  return value;
}

/** API base, including the `/api/v1` prefix. */
export const API_URL = requireEnv("NEXT_PUBLIC_API_URL", process.env.NEXT_PUBLIC_API_URL);

/**
 * Server-side (container→container) API base. Used by server components and
 * NextAuth — never shipped to the browser. Falls back to the public `API_URL`
 * when unset, so local `pnpm dev` and single-URL deploys are unchanged; set it
 * (e.g. `http://api:4000/api/v1`) only when the API is reachable at a different
 * internal host than the browser sees, as in `docker-compose.full.yml`.
 */
export const API_INTERNAL_URL = process.env.API_INTERNAL_URL || API_URL;
