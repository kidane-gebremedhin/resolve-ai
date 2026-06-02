// Thin fetch-based client for the widget. All methods are typed against the
// shapes returned by apps/api/src/routes/widget.routes.ts. Authed methods take
// a session token explicitly so the call sites can't accidentally hit an
// authed endpoint with stale storage.

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

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
  title?: string;
  subtitle?: string;
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

export type InitResponse = {
  sessionId: string;
  sessionToken: string;
  expiresAt: string;
  agent: WidgetAgent;
  settings: WidgetSettings;
  sections: WidgetSection[];
};

export type SettingsResponse = {
  agent: WidgetAgent;
  settings: WidgetSettings;
  sections: WidgetSection[];
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
};

export type WidgetMessage = {
  _id: string;
  conversationId: string;
  role: "customer" | "ai" | "operator" | "system";
  content: string;
  createdAt: string;
  attachments?: WidgetAttachment[];
};

export type MessagesPage = {
  items: WidgetMessage[];
  nextCursor: string | null;
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
