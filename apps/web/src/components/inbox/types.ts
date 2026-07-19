// Shared shapes for the operator inbox. These mirror the Mongoose models on the
// Express API but only include fields the operator UI actually renders. Keep
// them loose (most ids stringified) since `JSON.stringify` of a Mongoose doc
// flattens ObjectIds to strings.

export type ConversationStatus = "active" | "escalated" | "resolved" | "expired";

export type Conversation = {
  _id: string;
  threadId: string;
  organizationId: string;
  websiteId: string;
  agentId: string;
  contactSessionId: string;
  status: ConversationStatus;
  assignedOperatorId?: string | null;
  /** Visitor IP, enriched by the conversations list endpoint. */
  ipAddress?: string | null;
  subject?: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  messageCount?: number;
  resolvedAt?: string;
  resolvedBy?: "ai" | "operator" | "system";
  escalatedAt?: string;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
};

export type MessageRole = "customer" | "ai" | "operator" | "system";

export type Attachment = {
  fileName?: string;
  fileUrl?: string;
  url?: string;
  mimeType?: string;
  size?: number;
  extractedText?: string;
};

export type Message = {
  _id: string;
  conversationId: string;
  organizationId: string;
  role: MessageRole;
  content: string;
  senderId?: string;
  senderType: "contact" | "user" | "ai" | "system";
  confidence?: number;
  isEnhanced?: boolean;
  originalContent?: string;
  readByOperator?: boolean;
  attachments?: Attachment[];
  toolCalls?: { name: string; args?: unknown; result?: unknown }[];
  createdAt: string;
};

export type ConversationListResponse = {
  items: Conversation[];
  nextCursor: string | null;
};

export type MessageListResponse = {
  items: Message[];
  nextCursor: string | null;
};

export type ContactSession = {
  _id: string;
  email?: string;
  phone?: string;
  name?: string;
  ipAddress?: string;
  userAgent?: string;
  websiteId: string;
  metadata?: Record<string, unknown> | null;
};

export type InboxFilter = "all" | "active" | "escalated" | "resolved";

export function filterToStatus(filter: InboxFilter): ConversationStatus | undefined {
  if (filter === "all") return undefined;
  return filter;
}
