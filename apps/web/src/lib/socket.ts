"use client";

import { io, type Socket } from "socket.io-client";
import { SOCKET_URL } from "./app-urls";

let cached: Socket | null = null;
let cachedToken: string | null = null;

export function getOperatorSocket(accessToken: string): Socket {
  if (cached && cachedToken === accessToken) return cached;
  if (cached) cached.disconnect();
  let latest = accessToken;
  cached = io(SOCKET_URL, {
    // `auth` as a function is invoked before EVERY (re)connect, so we refresh
    // the access token first. Without this, a reconnect after the 15-min token
    // expiry would re-send the stale token, fail auth, and disconnect for good
    // (live updates silently stop). We fetch a fresh token and fall back to the
    // last known one if that fetch fails.
    auth: (cb: (data: Record<string, unknown>) => void) => {
      fetch("/api/session-token", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { accessToken?: string }) => {
          if (d.accessToken) latest = d.accessToken;
        })
        .catch(() => undefined)
        .finally(() => cb({ token: latest, kind: "operator" }));
    },
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });
  cachedToken = accessToken;
  return cached;
}

export function getWidgetSocket(sessionToken: string): Socket {
  if (cached && cachedToken === sessionToken) return cached;
  if (cached) cached.disconnect();
  cached = io(SOCKET_URL, {
    auth: { sessionToken, kind: "contact" },
    transports: ["websocket"],
    reconnection: true,
  });
  cachedToken = sessionToken;
  return cached;
}

export function disconnectSocket(): void {
  if (cached) {
    cached.disconnect();
    cached = null;
    cachedToken = null;
  }
}
