// Thin fetch-based client for the widget. All methods are typed against the
// shapes returned by apps/api/src/routes/widget.routes.ts. Authed methods take
// a session token explicitly so the call sites can't accidentally hit an
// authed endpoint with stale storage.

// API base comes from the environment (set per env via .env files). No host is
// hardcoded — a missing value fails fast rather than defaulting to a wrong host.
function requireApiUrl(): string {
  const v = process.env.NEXT_PUBLIC_API_URL;
  if (!v) throw new Error("Missing NEXT_PUBLIC_API_URL — set it for this environment.");
  return v;
}
export const API_URL = requireApiUrl();

export type WidgetAgent = {
  id: string;
  name: string;
  avatarUrl?: string;
  welcomeMessage?: string;
  suggestedQuestions?: string[];
};

export type WidgetSettings = {
  _id?: string;
  organizationId?: string;
  agentId?: string;
  welcomeMessage?: string;
  suggestedQuestions?: string[];
  primaryColor?: string;
  position?: "bottom-right" | "bottom-left" | "centered";
  theme?: "light" | "dark" | "auto";
  showBranding?: boolean;
  avatarUrl?: string;
  offlineMessage?: string;
  requireContactBeforeChat?: boolean;
} | null;

export type WidgetSection = {
  _id: string;
  title: string;
  description?: string;
  icon?: string;
  url?: string;
  action?: "link" | "start-chat" | "topic";
  topicPrompt?: string;
  order?: number;
};

export type WidgetFeatures = {
  /** Whether the mic / voice-input button is shown (ALLOW_WIDGET_VOICE_INPUT). */
  voiceInput?: boolean;
};

export type InitResponse = {
  sessionId: string;
  sessionToken: string;
  expiresAt: string;
  agent: WidgetAgent;
  settings: WidgetSettings;
  sections: WidgetSection[];
  features?: WidgetFeatures;
  /** ISO country resolved from the visitor's IP (offline geo). Defaults the phone field. */
  countryCode?: string;
};

export type SettingsResponse = {
  agent: WidgetAgent;
  settings: WidgetSettings;
  sections: WidgetSection[];
  features?: WidgetFeatures;
};

export type ConversationStatus = "active" | "escalated" | "resolved" | "expired";

export type WidgetConversation = {
  _id: string;
  status: ConversationStatus;
  subject?: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  messageCount?: number;
  resolvedAt?: string;
  escalatedAt?: string;
};

export type WidgetAttachment = {
  fileName?: string;
  fileUrl?: string;
  mimeType?: string;
  size?: number;
  url?: string;
  /** Server-extracted text (PDF/doc/sheet/text) — passed back on send so the AI reads it. */
  extractedText?: string;
};

export type MessageSource = {
  sourceId: string;
  sourceTitle: string;
  url?: string;
  score: number;
  /**
   * The integer shown inline in the reply, e.g. the 2 in "[2]".
   *
   * Optional on purpose: messages written before inline citations existed have
   * no marker, and must keep rendering as the collapsible source list they
   * always did.
   */
  marker?: number;
  /** `<sourceId>:<chunkIndex>` — which passage, not just which document. */
  chunkId?: string;
  /** Heading stack, so a citation can name the section it came from. */
  headingPath?: string[];
};

// Structured UI blocks rendered alongside or instead of prose content.
// Mirror of apps/api/src/types/messageBlocks.ts — kept as `unknown[]` here
// so the widget doesn't import server types directly.
export type MessageBlock = Record<string, unknown> & { type: string };

export type WidgetMessage = {
  _id: string;
  conversationId: string;
  role: "customer" | "ai" | "operator" | "system";
  content: string;
  createdAt: string;
  attachments?: WidgetAttachment[];
  sources?: MessageSource[];
  quickReplies?: string[];
  blocks?: MessageBlock[];
};

export type FeedbackRating = "up" | "down";

export function submitFeedback(
  sessionToken: string,
  messageId: string,
  rating: FeedbackRating,
  reason?: string,
): Promise<void> {
  return request<void>(`/widget/messages/${encodeURIComponent(messageId)}/feedback`, {
    method: "POST",
    body: { rating, reason },
    sessionToken,
  });
}

export function submitCsat(
  sessionToken: string,
  conversationId: string,
  stars: 1 | 2 | 3 | 4 | 5,
  comment?: string,
): Promise<void> {
  return request<void>(`/widget/conversations/${encodeURIComponent(conversationId)}/csat`, {
    method: "POST",
    body: { stars, comment },
    sessionToken,
  });
}

export type MessagesPage = {
  items: WidgetMessage[];
  nextCursor: string | null;
  conversationStatus?: ConversationStatus;
};

export type ContactSessionView = {
  _id: string;
  email?: string;
  phone?: string;
  name?: string;
  expiresAt?: string;
};

class ApiError extends Error {
  status: number;
  payload: unknown;
  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}
export { ApiError };

async function request<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    sessionToken?: string;
    formData?: FormData;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (options.sessionToken) {
    headers["x-session-token"] = options.sessionToken;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    signal: options.signal,
  });

  // 204 etc — no payload.
  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;

  if (!res.ok) {
    // Budget cap hit (402). NEVER surface the server's budget wording/amounts to
    // the customer — show a neutral, generic message. The org owner is notified
    // separately (email + in-app notification); the visitor just sees a soft error.
    if (res.status === 402) {
      throw new ApiError(
        "Sorry, I encountered some issues, please try again later.",
        res.status,
        json,
      );
    }
    const message =
      (json && typeof json === "object" && "error" in json && typeof (json as { error?: unknown }).error === "string"
        ? ((json as { error?: string }).error as string)
        : `Request failed: ${res.status}`) ?? `Request failed: ${res.status}`;
    throw new ApiError(message, res.status, json);
  }
  return json as T;
}

// ---------- Unauthenticated ----------

export function initWidget(args: {
  domain: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
}): Promise<InitResponse> {
  // `agentId` is the preferred resolver: the API ties the session to that
  // agent's organization, so the widget uses that org's knowledge base and its
  // conversations land in that org's inbox — independent of the embedding page.
  // `domain` is kept as a fallback for embedded clients. We also stash agentId
  // in metadata for audit logs.
  const metadata = args.agentId
    ? { ...(args.metadata ?? {}), agentId: args.agentId }
    : args.metadata;
  return request<InitResponse>("/widget/init", {
    method: "POST",
    body: { domain: args.domain, agentId: args.agentId, metadata },
  });
}

// ---------- Authenticated (require sessionToken) ----------

export function getSettings(sessionToken: string): Promise<SettingsResponse> {
  return request<SettingsResponse>("/widget/settings", { sessionToken });
}

export function updateContact(
  sessionToken: string,
  sessionId: string,
  payload: { email?: string; phone?: string; name?: string },
): Promise<{ session: ContactSessionView }> {
  return request<{ session: ContactSessionView }>(
    `/widget/sessions/${encodeURIComponent(sessionId)}/contact`,
    { method: "POST", body: payload, sessionToken },
  );
}

export function createConversation(
  sessionToken: string,
  sectionId?: string,
): Promise<{ conversation: WidgetConversation }> {
  return request<{ conversation: WidgetConversation }>(
    "/widget/conversations",
    {
      method: "POST",
      body: sectionId ? { sectionId } : {},
      sessionToken,
    },
  );
}

export function listMessages(
  sessionToken: string,
  conversationId: string,
  cursor?: string,
  limit = 50,
): Promise<MessagesPage> {
  const qs = new URLSearchParams();
  if (cursor) qs.set("cursor", cursor);
  qs.set("limit", String(limit));
  return request<MessagesPage>(
    `/widget/conversations/${encodeURIComponent(conversationId)}/messages?${qs.toString()}`,
    { sessionToken },
  );
}

export function sendMessage(
  sessionToken: string,
  conversationId: string,
  content: string,
  attachments?: WidgetAttachment[],
): Promise<{ message: WidgetMessage }> {
  return request<{ message: WidgetMessage }>(
    `/widget/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      body: { content, attachments },
      sessionToken,
    },
  );
}

export function uploadAttachment(
  sessionToken: string,
  conversationId: string,
  file: File,
): Promise<{ attachment: WidgetAttachment }> {
  const fd = new FormData();
  fd.append("file", file);
  return request<{ attachment: WidgetAttachment }>(
    `/widget/conversations/${encodeURIComponent(conversationId)}/attachments`,
    { method: "POST", formData: fd, sessionToken },
  );
}

// Client-side country detection — fallback for the phone-field default country
// when the server didn't resolve one (e.g. on localhost the API's IP is private,
// and on resumed sessions /init isn't called). Runs in the VISITOR's browser, so
// it sees the visitor's real public IP in every environment (no reverse-proxy
// caveats). Uses GeoJS: free, keyless, HTTPS, CORS-enabled. Cached in
// localStorage so we hit it at most once per visitor.
const COUNTRY_CACHE_KEY = "csb_widget_country";

export async function detectVisitorCountry(): Promise<string | undefined> {
  if (typeof window === "undefined") return undefined;
  try {
    const cached = window.localStorage.getItem(COUNTRY_CACHE_KEY);
    if (cached) return cached;
  } catch {
    /* localStorage blocked — fall through to network */
  }
  try {
    const res = await fetch("https://get.geojs.io/v1/ip/country.json", {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return undefined;
    const j = (await res.json()) as { country?: string };
    const code = j.country && /^[A-Za-z]{2}$/.test(j.country) ? j.country.toUpperCase() : undefined;
    if (code) {
      try {
        window.localStorage.setItem(COUNTRY_CACHE_KEY, code);
      } catch {
        /* ignore cache write failure */
      }
    }
    return code;
  } catch {
    return undefined;
  }
}
