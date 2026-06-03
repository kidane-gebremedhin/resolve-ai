// Widget session storage. Persists a contact session token in localStorage so a
// customer's chat survives reloads and tab restarts. Spec: __specs/09-widget-state-machine.md.
//
// Sliding-window expiry: the API extends `expiresAt` on every authed call, but
// the client tracks its own copy so it can detect a stale localStorage entry
// before issuing a doomed request. Anything within ~10 minutes of expiry is
// treated as "expiring soon" and the caller may choose to refresh proactively.

const STORAGE_KEY = "csb_widget_session_v1";
const REFRESH_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export type WidgetSession = {
  id: string;
  token: string;
  expiresAt: string;
  agentId?: string;
  websiteId?: string;
  /** Currently active conversation, if any. Cleared when conversation resolves. */
  conversationId?: string;
  /** Cached email so we don't re-prompt mid-session even if the API forgets it. */
  email?: string;
  /** True once the user has submitted contact info. Survives reloads. */
  contactCaptured?: boolean;
};

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readSession(): WidgetSession | null {
  const ls = safeStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WidgetSession;
    if (!parsed?.token || !parsed.id || !parsed.expiresAt) return null;
    if (new Date(parsed.expiresAt).getTime() < Date.now()) {
      ls.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(session: WidgetSession): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Quota / private mode — fail silently, session will be in-memory only.
  }
}

export function updateSession(patch: Partial<WidgetSession>): WidgetSession | null {
  const current = readSession();
  if (!current) return null;
  const next = { ...current, ...patch };
  writeSession(next);
  return next;
}

export function clearSession(): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    ls.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Returns true when the stored session is valid but close to expiry. Useful
 * for callers that want to fire an opportunistic refresh (any authed GET will
 * trigger the API's sliding-window extension).
 */
export function isExpiringSoon(session: WidgetSession): boolean {
  const remaining = new Date(session.expiresAt).getTime() - Date.now();
  return remaining > 0 && remaining < REFRESH_WINDOW_MS;
}

/**
 * If the session is about to expire, refresh it by calling `refetch()` which
 * should hit any authed endpoint. The API will bump `expiresAt`. The caller
 * is responsible for writing the new expiresAt back via `updateSession`.
 */
export async function extendIfExpiringSoon(
  session: WidgetSession,
  refetch: () => Promise<{ expiresAt?: string } | void>,
): Promise<void> {
  if (!isExpiringSoon(session)) return;
  try {
    const result = await refetch();
    if (result && typeof result.expiresAt === "string") {
      updateSession({ expiresAt: result.expiresAt });
    }
  } catch {
    // If refresh fails the next authed call will surface the error.
  }
}
