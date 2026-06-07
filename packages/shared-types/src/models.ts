// Shared DB model interfaces. Populated in Phase 1.
// Use string ObjectId form so the type works in both server and client code.

export type ObjectIdString = string;
export type ISODateString = string;

export type Role = "owner" | "admin" | "agent" | "viewer";
export type Plan = "free" | "starter" | "pro" | "enterprise";
export type ConversationStatus = "open" | "assigned" | "escalated" | "resolved" | "closed";
export type MessageSender = "customer" | "ai" | "operator" | "system";
export type KnowledgeSourceType = "text" | "file" | "url" | "firecrawl";
export type KnowledgeSourceStatus = "pending" | "processing" | "ready" | "failed";

export interface Organization {
  _id: ObjectIdString;
  name: string;
  slug: string;
  plan: Plan;
  ownerId: ObjectIdString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface User {
  _id: ObjectIdString;
  email: string;
  name: string;
  image?: string;
  providers: ("google" | "credentials")[];
  isPlatformAdmin?: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface Membership {
  _id: ObjectIdString;
  organizationId: ObjectIdString;
  userId: ObjectIdString;
  role: Role;
  createdAt: ISODateString;
}

export interface Website {
  _id: ObjectIdString;
  organizationId: ObjectIdString;
  domain: string;
  name: string;
  agentId?: ObjectIdString;
  createdAt: ISODateString;
}

export interface Agent {
  _id: ObjectIdString;
  organizationId: ObjectIdString;
  websiteId: ObjectIdString;
  name: string;
  systemPrompt: string;
  confidenceThreshold?: number;
  createdAt: ISODateString;
}

export interface ContactSession {
  _id: ObjectIdString;
  organizationId: ObjectIdString;
  websiteId: ObjectIdString;
  email?: string;
  name?: string;
  metadata?: Record<string, unknown>;
  expiresAt: ISODateString;
  createdAt: ISODateString;
}

export interface Conversation {
  _id: ObjectIdString;
  organizationId: ObjectIdString;
  websiteId: ObjectIdString;
  agentId: ObjectIdString;
  contactSessionId: ObjectIdString;
  status: ConversationStatus;
  assignedTo?: ObjectIdString;
  lastMessageAt: ISODateString;
  createdAt: ISODateString;
}

export interface Message {
  _id: ObjectIdString;
  conversationId: ObjectIdString;
  organizationId: ObjectIdString;
  sender: MessageSender;
  senderId?: ObjectIdString;
  text: string;
  confidence?: number;
  citations?: { sourceId: ObjectIdString; snippet: string }[];
  createdAt: ISODateString;
}

export interface KnowledgeSource {
  _id: ObjectIdString;
  organizationId: ObjectIdString;
  agentId: ObjectIdString;
  type: KnowledgeSourceType;
  title: string;
  status: KnowledgeSourceStatus;
  error?: string;
  chunkCount?: number;
  contentHash?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface WidgetSettings {
  _id: ObjectIdString;
  organizationId: ObjectIdString;
  agentId: ObjectIdString;
  primaryColor: string;
  welcomeMessage: string;
  logoUrl?: string;
  position: "bottom-right" | "bottom-left" | "centered";
  theme: "light" | "dark" | "auto";
  showBranding: boolean;
}

export interface Section {
  _id: ObjectIdString;
  organizationId: ObjectIdString;
  agentId: ObjectIdString;
  label: string;
  url: string;
  icon?: string;
  order: number;
}

export interface Subscription {
  _id: ObjectIdString;
  organizationId: ObjectIdString;
  paddleSubscriptionId: string;
  paddleCustomerId: string;
  plan: Plan;
  status: "active" | "trialing" | "past_due" | "canceled" | "paused";
  currentPeriodStart?: ISODateString;
  currentPeriodEnd: ISODateString;
  canceledAt?: ISODateString;
  trialEndAt?: ISODateString;
  createdAt: ISODateString;
}
