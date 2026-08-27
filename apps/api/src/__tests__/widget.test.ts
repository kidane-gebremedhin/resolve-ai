// Widget session lifecycle. We exercise:
//   - /widget/init success: returns session token, agent, settings, sections
//   - /widget/init for unknown domain: 404
//   - /widget/conversations/:id/messages without an X-Session-Token: 401
//   - The ContactSession's expiresAt is in the future and within the
//     configured TTL.

import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../test/app.js";
import {
  createAgent,
  createOrgWithOwner,
  createSession,
  createWebsite,
  grantPlan,
} from "../test/factories.js";
import { ContactSession, Conversation } from "../models/index.js";
import { env } from "../config/env.js";
import crypto from "node:crypto";
import mongoose from "mongoose";

describe("widget session lifecycle", () => {
  let app: Express;
  beforeAll(() => {
    app = createApp();
  });

  it("POST /widget/init returns session + agent + settings + sections for a known domain", async () => {
    const a = await createOrgWithOwner(app, { email: "widget-ok@example.com" });
    const site = await createWebsite({ orgId: a.orgId, domain: "shop.example.com" });
    await createAgent({ orgId: a.orgId, websiteId: site._id, name: "Shopbot" });

    const res = await request(app)
      .post("/api/v1/widget/init")
      .send({ domain: "shop.example.com" });

    expect(res.status).toBe(200);
    expect(typeof res.body.sessionId).toBe("string");
    expect(typeof res.body.sessionToken).toBe("string");
    expect(res.body.agent).toMatchObject({ name: "Shopbot" });
    // settings may be null when no WidgetSettings doc exists for the org+agent.
    expect(res.body).toHaveProperty("settings");
    expect(Array.isArray(res.body.sections)).toBe(true);
  });

  it("POST /widget/init with an unknown domain → 404", async () => {
    const res = await request(app)
      .post("/api/v1/widget/init")
      .send({ domain: "nowhere.example.com" });

    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe("not_found");
  });

  it("POST /widget/init issues a ContactSession whose expiresAt is in the future and within the configured TTL", async () => {
    const a = await createOrgWithOwner(app, { email: "widget-ttl@example.com" });
    const site = await createWebsite({ orgId: a.orgId, domain: "ttl.example.com" });
    await createAgent({ orgId: a.orgId, websiteId: site._id });

    const before = Date.now();
    const session = await createSession(app, { domain: "ttl.example.com" });
    const after = Date.now();

    const expiresAt = new Date(session.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(after);

    const ttlMs = env.sessionTokenExpiryHours * 60 * 60 * 1000;
    // The created session's expiresAt should be within (now, now + ttl + slack).
    expect(expiresAt).toBeLessThanOrEqual(after + ttlMs + 1000);
    expect(expiresAt).toBeGreaterThanOrEqual(before + ttlMs - 1000);

    // And the row really exists with that expiry.
    const row = await ContactSession.findById(session.sessionId).lean();
    expect(row).not.toBeNull();
    expect(row!.expiresAt.getTime()).toBeGreaterThan(after);
  });

  it("POST /widget/conversations/:id/messages without X-Session-Token → 401", async () => {
    const a = await createOrgWithOwner(app, { email: "widget-401@example.com" });
    const site = await createWebsite({ orgId: a.orgId, domain: "msg.example.com" });
    const agent = await createAgent({ orgId: a.orgId, websiteId: site._id });

    // Create a conversation directly so we have a valid :id to point at.
    const conv = await Conversation.create({
      threadId: crypto.randomUUID(),
      organizationId: a.orgId,
      websiteId: site._id,
      agentId: agent._id,
      contactSessionId: new mongoose.Types.ObjectId(),
      status: "active",
    });

    const res = await request(app)
      .post(`/api/v1/widget/conversations/${String(conv._id)}/messages`)
      .send({ content: "hello there" });

    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("unauthorized");
  });

  it("POST /widget/conversations/:id/messages with a valid session token works (sanity check on the middleware contract)", async () => {
    const a = await createOrgWithOwner(app, { email: "widget-200@example.com" });
    // Unsubscribed orgs get a message quota of 0, so the widget is paywalled
    // from the very first message. Grant a plan to reach the middleware
    // contract this test is actually about.
    await grantPlan(a.orgId);
    const site = await createWebsite({ orgId: a.orgId, domain: "msg2.example.com" });
    const agent = await createAgent({ orgId: a.orgId, websiteId: site._id });

    const session = await createSession(app, { domain: "msg2.example.com" });

    // Create a conversation belonging to that contact session so the route's
    // {_id, organizationId, contactSessionId} filter matches.
    const conv = await Conversation.create({
      threadId: crypto.randomUUID(),
      organizationId: a.orgId,
      websiteId: site._id,
      agentId: agent._id,
      contactSessionId: new mongoose.Types.ObjectId(session.sessionId),
      status: "active",
    });

    const res = await request(app)
      .post(`/api/v1/widget/conversations/${String(conv._id)}/messages`)
      .set("X-Session-Token", session.sessionToken)
      .send({ content: "hello from the widget" });

    expect(res.status).toBe(201);
    expect(res.body.message?.content).toBe("hello from the widget");
  });

  // The paywall is deliberate: an org with no subscription has a quota of zero,
  // so the widget is gated from the FIRST message rather than after a free
  // allowance. This test exists so that decision can't be reversed by accident —
  // if a free tier is introduced later, this is the test that should fail first.
  it("POST /widget/conversations/:id/messages is paywalled for an org with no subscription", async () => {
    const a = await createOrgWithOwner(app, { email: "widget-402@example.com" });
    const site = await createWebsite({ orgId: a.orgId, domain: "paywall.example.com" });
    const agent = await createAgent({ orgId: a.orgId, websiteId: site._id });
    const session = await createSession(app, { domain: "paywall.example.com" });

    const conv = await Conversation.create({
      threadId: crypto.randomUUID(),
      organizationId: a.orgId,
      websiteId: site._id,
      agentId: agent._id,
      contactSessionId: new mongoose.Types.ObjectId(session.sessionId),
      status: "active",
    });

    const res = await request(app)
      .post(`/api/v1/widget/conversations/${String(conv._id)}/messages`)
      .set("X-Session-Token", session.sessionToken)
      .send({ content: "hello from an unsubscribed org" });

    expect(res.status).toBe(402);
    expect(res.body.error?.code).toBe("plan_limit_exceeded");
    expect(res.body.error?.limit).toBe(0);
  });
});
