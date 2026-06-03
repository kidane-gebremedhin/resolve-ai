// Single source for every external URL the web app needs. All values come from
// environment variables, set per environment (.env.local for dev, the platform's
// env for staging/prod). No localhost — or any host — is hardcoded here; supply
// the env vars instead so the same build artifact deploys to any environment.
//
// These are NEXT_PUBLIC_* so Next inlines them at build time. A missing value
// fails fast with a clear message rather than silently falling back to a wrong
// host.

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required env var ${name}. Set it in your environment's .env file (see .env.example).`,
    );
  }
  return value;
}

/** API base, including the `/api/v1` prefix. e.g. https://api.example.com/api/v1 */
export const API_URL = requireEnv("NEXT_PUBLIC_API_URL", process.env.NEXT_PUBLIC_API_URL);

/** Socket.io origin. Defaults to the API origin (API_URL without the /api/v1 suffix). */
export const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ?? API_URL.replace(/\/api\/v1\/?$/, "");

/** Widget app origin (the iframe host). e.g. https://widget.example.com */
export const WIDGET_URL = requireEnv("NEXT_PUBLIC_WIDGET_URL", process.env.NEXT_PUBLIC_WIDGET_URL);

/** Full URL to the embed loader script. e.g. https://embed.example.com/widget.js */
export const EMBED_URL = requireEnv("NEXT_PUBLIC_EMBED_URL", process.env.NEXT_PUBLIC_EMBED_URL);

/** Public origin of this web app. e.g. https://app.example.com */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";
