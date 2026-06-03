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
