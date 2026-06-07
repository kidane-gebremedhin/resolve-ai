// Server-side API client. Forwards the NextAuth-session bearer token to the
// Express API, parses JSON, and surfaces structured errors. Import this from
// server components and route handlers — never from client components (we do
// not ship the raw access token to the browser).

import { redirect } from "next/navigation";
import { auth } from "./auth";
import { API_URL, API_INTERNAL_URL } from "./app-urls";

// The admin panel only ever calls authed `/admin/*` endpoints. A 401 means our
// bearer token is missing/stale/invalid (or the account was deleted/wiped); a
// 403 means this user is no longer a platform admin. Either way the session is
// no good — force a logout rather than showing "Failed to load …".
function shouldForceLogout(status: number): boolean {
  return status === 401 || status === 403;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

// `status: 0` means the network call never reached the server (DNS failure,
// connection refused, fetch aborted). Callers that already handle `ApiError`
// will treat these gracefully — instead of a stack trace surfacing
// `connect ECONNREFUSED 127.0.0.1:4000` to the user, we render a friendly
// "API unreachable" message via the existing error UI in each page.
export const API_UNREACHABLE = "api_unreachable";

function isLikelyConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("econnrefused") ||
    msg.includes("fetch failed") ||
    msg.includes("network request failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("getaddrinfo") ||
    msg.includes("enotfound")
  );
}

type FetchOptions = Omit<RequestInit, "body"> & {
  json?: unknown;
  token?: string;
};

async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const session = options.token ? null : await auth();
  const token = options.token ?? session?.accessToken;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.authorization = `Bearer ${token}`;

  // Server-side calls use the internal base (container→container); the browser
  // path keeps the public URL.
  const base = typeof window === "undefined" ? API_INTERNAL_URL : API_URL;
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const method = (options.method ?? "GET").toUpperCase();
  // Retry idempotent reads through a brief API outage (e.g. a dev `tsx watch`
  // restart or a deploy) so a transient blip doesn't surface as "Failed to
  // load…". Non-GET requests are NOT retried (avoid double-submitting writes).
  const maxAttempts = method === "GET" ? 3 : 1;
  let res: Response | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      res = await fetch(url, {
        ...options,
        headers,
        body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
        cache: "no-store",
      });
      break;
    } catch (err) {
      // Connection-level failure (API not running, wrong port, DNS, etc).
      if (isLikelyConnectionError(err)) {
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 400 * attempt));
          continue;
        }
        // Convert to ApiError so pages can render their existing error fallback
        // instead of bubbling up a raw `connect ECONNREFUSED 127.0.0.1:4000`.
        throw new ApiError(
          0,
          API_UNREACHABLE,
          `Can't reach the API at ${API_URL}. Is the API server running?`,
        );
      }
      throw err;
    }
  }
  if (!res) {
    throw new ApiError(0, API_UNREACHABLE, `Can't reach the API at ${API_URL}.`);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;

  if (!res.ok) {
    const err = body as { error?: { code?: string; message?: string; details?: unknown } } | undefined;
    const message = err?.error?.message ?? `Request failed: ${res.status}`;
    // Server-side auto-logout: when the API rejects our token (stale JWT, the
    // account was wiped, or admin rights revoked), go through /logout — a Route
    // Handler that CLEARS the session cookie before redirecting to /login. A
    // bare /login redirect would leave the stale cookie in place. Pages must
    // re-throw non-ApiError errors so this redirect isn't swallowed by their
    // try/catch (see each list page's load()).
    if (
      shouldForceLogout(res.status) &&
      options.token === undefined &&
      typeof window === "undefined"
    ) {
      redirect("/logout");
    }
    throw new ApiError(
      res.status,
      err?.error?.code ?? "api_error",
      message,
      err?.error?.details,
    );
  }

  return body as T;
}

export const api = {
  get: <T>(path: string, opts?: FetchOptions) => apiFetch<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, json?: unknown, opts?: FetchOptions) =>
    apiFetch<T>(path, { ...opts, method: "POST", json }),
  patch: <T>(path: string, json?: unknown, opts?: FetchOptions) =>
    apiFetch<T>(path, { ...opts, method: "PATCH", json }),
  put: <T>(path: string, json?: unknown, opts?: FetchOptions) =>
    apiFetch<T>(path, { ...opts, method: "PUT", json }),
  delete: <T>(path: string, opts?: FetchOptions) =>
    apiFetch<T>(path, { ...opts, method: "DELETE" }),
};

/** Browser-side fetch using the NextAuth session token retrieved via /api/session-token. */
export async function clientApiFetch<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const tokenRes = await fetch("/api/session-token", { cache: "no-store" });
  const { accessToken } = (await tokenRes.json()) as { accessToken?: string };
  try {
    return await apiFetch<T>(path, { ...options, token: accessToken });
  } catch (err) {
    // Auto-logout on stale/invalid token. Doing this here (not in apiFetch)
    // keeps the redirect a browser-only concern — server fetches still throw
    // so route handlers can decide for themselves.
    if (
      err instanceof ApiError &&
      shouldForceLogout(err.status) &&
      typeof window !== "undefined"
    ) {
      const { signOut } = await import("next-auth/react");
      await signOut({ redirect: false });
      const back = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?session=expired&from=${back}`;
    }
    throw err;
  }
}

export const clientApi = {
  get: <T>(path: string) => clientApiFetch<T>(path, { method: "GET" }),
  post: <T>(path: string, json?: unknown) =>
    clientApiFetch<T>(path, { method: "POST", json }),
  patch: <T>(path: string, json?: unknown) =>
    clientApiFetch<T>(path, { method: "PATCH", json }),
  put: <T>(path: string, json?: unknown) =>
    clientApiFetch<T>(path, { method: "PUT", json }),
  delete: <T>(path: string) =>
    clientApiFetch<T>(path, { method: "DELETE" }),
};

export const API_BASE_URL = API_URL;
