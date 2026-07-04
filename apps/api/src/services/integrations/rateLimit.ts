// In-memory sliding-window rate limiter for integration tool calls.
// Two independent windows per connection:
//   - per-session:    caps a single visitor (connectionId + contactSessionId)
//   - per-connection: caps ALL visitors combined (connectionId) — optional
// Both are configurable per connection (rateLimitPerSession / rateLimitPerConnection).
// Falls back gracefully — never blocks on internal error.

type WindowEntry = {
  timestamps: number[];
};

const store = new Map<string, WindowEntry>();

export type RateLimitConfig = {
  perSession?: number;
  perConnection?: number;
  windowMs?: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  scope?: "session" | "connection";
};

function evict(key: string, window: number, now: number): WindowEntry {
  const entry = store.get(key) ?? { timestamps: [] };
  entry.timestamps = entry.timestamps.filter((t) => now - t < window);
  store.set(key, entry);
  return entry;
}

export function checkRateLimit(
  connectionId: string,
  contactSessionId: string,
  config: RateLimitConfig = {},
): RateLimitResult {
  const window = config.windowMs ?? 60_000;
  const perSession = config.perSession && config.perSession > 0 ? config.perSession : 10;
  const perConnection = config.perConnection && config.perConnection > 0 ? config.perConnection : 0;
  const now = Date.now();

  const sessionKey = `s:${connectionId}:${contactSessionId}`;
  const session = evict(sessionKey, window, now);
  if (session.timestamps.length >= perSession) {
    return { allowed: false, remaining: 0, scope: "session" };
  }

  // Optional cross-session cap for the whole connection.
  let connection: WindowEntry | null = null;
  if (perConnection > 0) {
    const connKey = `c:${connectionId}`;
    connection = evict(connKey, window, now);
    if (connection.timestamps.length >= perConnection) {
      return { allowed: false, remaining: 0, scope: "connection" };
    }
  }

  // Both windows have room — record in both.
  session.timestamps.push(now);
  if (connection) connection.timestamps.push(now);
  return { allowed: true, remaining: perSession - session.timestamps.length };
}
