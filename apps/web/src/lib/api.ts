// Server-side API client. Forwards the NextAuth-session bearer token to the
// Express API, parses JSON, and surfaces structured errors. Import this from
// server components and route handlers — never from client components (we do
// not ship the raw access token to the browser).

import { redirect } from "next/navigation";
import { auth } from "./auth";
import { API_URL, API_INTERNAL_URL } from "./app-urls";

// A 401 normally means our bearer token is missing/stale/invalid, and the right
// response is to sign out and send the operator back to /login.
//
// It is NOT always that. Some endpoints answer 401 for a reason that has
// nothing to do with the session — a wrong second factor, most obviously, where
// the caller is perfectly authenticated and merely mistyped six digits. Signing
// out there destroys a valid session, throws away whatever is on screen (the
// one-time recovery codes, in the case that surfaced this), and shows a
// misleading "session expired".
//
// So auto-logout is driven by the error CODE, not the bare status. Codes that
// describe the submitted credentials rather than the session are excluded; the
// caller handles them like any other error.
const NON_SESSION_401_CODES = new Set(["totp_required", "invalid_totp"]);

function isUnauthorized(status: number, code?: string): boolean {
  return status === 401 && !NON_SESSION_401_CODES.has(code ?? "");
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

  // Server-side calls (server components, route handlers) use the internal base
  // so container→container traffic doesn't bounce through the public host;
  // browser calls (clientApiFetch passes a token) keep the public URL.
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
    // Server-side auto-logout: if the API rejects our bearer token (next-auth's
    // 7d session outlives the API's 15m JWT, or the account was deleted/wiped so
    // it no longer exists), go through /logout — a Route Handler that CLEARS the
    // session cookie before redirecting to /login. A bare redirect to /login
    // would leave the stale cookie in place and re-gate the ghost user to
    // /checkout. The client does the equivalent (signOut) in `clientApiFetch`.
    // We only do this for true server-side calls resolving the session via
    // `auth()` (no explicit token passed).
    if (
      isUnauthorized(res.status, err?.error?.code) &&
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
      isUnauthorized(err.status, err.code) &&
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
