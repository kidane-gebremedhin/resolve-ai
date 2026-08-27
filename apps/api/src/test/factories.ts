// Test factories — small builders that produce the fixture graph each test
// needs (org + owner + token + optional website/agent/conversation/session).
// We deliberately go through the HTTP API for things like /auth/register and
// /widget/init so the factories also exercise the real wiring; we go straight
// to the model for plain fixtures like Website/Agent/Conversation.

import request from "supertest";
import type { Express } from "express";
import { Agent, Conversation, Organization, Website } from "../models/index.js";
import type {
  AgentDocType,
  ConversationDocType,
  WebsiteDocType,
} from "../models/index.js";
import crypto from "node:crypto";

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export interface RegisteredOwner {
  user: {
    id: string;
    email: string;
    name: string;
    organizationId: string;
    membershipRole: "owner";
  };
  orgId: string;
  accessToken: string;
  refreshToken: string;
}

export interface RegisterInput {
  email?: string;
  password?: string;
  name?: string;
  organizationName?: string;
}

/**
 * Registers a new org+owner via `POST /api/v1/auth/register` and returns the
 * issued tokens plus the resolved organizationId. All fields default to
 * unique values per call so multiple invocations within a single test produce
 * independent tenants.
 */
export async function createOrgWithOwner(
  app: Express,
  input: RegisterInput = {},
): Promise<RegisteredOwner> {
  const email = input.email ?? `${unique("user")}@example.com`;
  // Must satisfy `strongPassword` in auth.routes.ts (>=8 chars, lower, upper,
  // number, special). The old default ("password1234") predated that policy and
  // made every factory-backed test fail at registration with a 400.
  const password = input.password ?? "Password1234!";
  const name = input.name ?? "Test User";
  const organizationName = input.organizationName ?? unique("Org");

  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ email, password, name, organizationName });

  if (res.status !== 201) {
    throw new Error(
      `createOrgWithOwner failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }

  const body = res.body as {
    user: {
      id: string;
      email: string;
      name: string;
      organizationId: string;
      membershipRole: "owner";
    };
    accessToken: string;
    refreshToken: string;
  };

  return {
    user: body.user,
    orgId: body.user.organizationId,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  };
}

/**
 * Puts an org on a paid plan.
 *
 * `POST /auth/register` deliberately leaves an org with no plan, and an
 * unsubscribed org has a quota of ZERO for messages, websites, knowledge
 * sources and seats — the product paywalls from the first message, so every
 * quota-guarded route answers 402 until a subscription exists. Any test that
 * exercises behaviour BEYOND the paywall has to grant a plan first; without
 * this the assertion under test never runs and the failure looks like a bug in
 * the route rather than a missing fixture.
 */
export async function grantPlan(
  orgId: string,
  plan: "pro" | "business" | "enterprise" = "business",
): Promise<void> {
  await Organization.updateOne({ _id: orgId }, { $set: { plan } });
}

/**
 * Creates a Website doc directly via the model. We bypass the API here so the
 * factory works even before the requester has any auth context.
 */
export async function createWebsite(input: {
  orgId: string;
  domain?: string;
  name?: string;
  isActive?: boolean;
}): Promise<WebsiteDocType & { _id: unknown }> {
  const domain = input.domain ?? `${unique("site")}.example.com`;
  return Website.create({
    organizationId: input.orgId,
    name: input.name ?? domain,
    domain,
    allowedOrigins: [],
    isActive: input.isActive ?? true,
  });
}

/**
 * Creates an Agent doc directly via the model.
 */
export async function createAgent(input: {
  orgId: string;
  /** Agents are per-website; if omitted a fresh website is created for it. */
  websiteId?: unknown;
  name?: string;
  isActive?: boolean;
}): Promise<AgentDocType & { _id: unknown }> {
  const websiteId =
    input.websiteId ?? (await createWebsite({ orgId: input.orgId }))._id;
  return Agent.create({
    organizationId: input.orgId,
    websiteId,
    name: input.name ?? unique("Agent"),
    welcomeMessage: "Hello!",
    suggestedQuestions: ["How do I get started?"],
    isActive: input.isActive ?? true,
  });
}

/**
 * Creates a Conversation doc directly via the model. Useful for tests that
 * need a conversation under a specific org without going through the widget.
 */
export async function createConversation(input: {
  orgId: string;
  websiteId: string;
  agentId: string;
  contactSessionId: string;
  status?: "active" | "escalated" | "resolved" | "expired";
}): Promise<ConversationDocType & { _id: unknown }> {
  return Conversation.create({
    threadId: crypto.randomUUID(),
    organizationId: input.orgId,
    websiteId: input.websiteId,
    agentId: input.agentId,
    contactSessionId: input.contactSessionId,
    status: input.status ?? "active",
  });
}

export interface WidgetSession {
  sessionId: string;
  sessionToken: string;
  expiresAt: string;
  agent: { id: string; name: string };
  settings: unknown;
  sections: unknown[];
}

/**
 * Starts a widget session via `POST /api/v1/widget/init`. Requires that the
 * organization already has at least one active Website (matching `domain`) AND
 * one active Agent — the route 404s otherwise.
 */
export async function createSession(
  app: Express,
  input: { domain: string; metadata?: Record<string, unknown> },
): Promise<WidgetSession> {
  const res = await request(app)
    .post("/api/v1/widget/init")
    .send({ domain: input.domain, metadata: input.metadata });

  if (res.status !== 200) {
    throw new Error(`createSession failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return res.body as WidgetSession;
}
