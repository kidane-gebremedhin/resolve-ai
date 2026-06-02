// Multi-org row-level isolation. The tests below all share the same pattern:
// create two orgs (A and B), create a resource owned by A, then try to access
// it as B and assert that the listing endpoint never reveals it and the
// detail endpoint 404s. The "body override" tests verify that the routes
// drop any `organizationId` value coming from the client and stamp the
// authenticated org instead.

import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../test/app.js";
import { createAgent, createOrgWithOwner, createWebsite } from "../test/factories.js";
import { Conversation, KnowledgeSource } from "../models/index.js";
import crypto from "node:crypto";
import mongoose from "mongoose";

describe("multi-org RLS", () => {
  let app: Express;
  beforeAll(() => {
    app = createApp();
  });

  it("user B cannot see or fetch a website owned by org A", async () => {
    const a = await createOrgWithOwner(app, { email: "a-site@example.com" });
    const b = await createOrgWithOwner(app, { email: "b-site@example.com" });
    const siteA = await createWebsite({ orgId: a.orgId, domain: "a.example.com" });
    const siteAId = String(siteA._id);

    // Listing should not include A's website.
    const list = await request(app)
      .get("/api/v1/websites")
      .set("Authorization", `Bearer ${b.accessToken}`);
    expect(list.status).toBe(200);
    const ids = (list.body as Array<{ _id: string }>).map((w) => String(w._id));
    expect(ids).not.toContain(siteAId);

    // Direct fetch of A's website by id should 404 for B.
    const direct = await request(app)
      .get(`/api/v1/websites/${siteAId}`)
      .set("Authorization", `Bearer ${b.accessToken}`);
    expect(direct.status).toBe(404);
  });

  it("POST /websites ignores a client-supplied organizationId — the auth context wins", async () => {
    const a = await createOrgWithOwner(app, { email: "a-poster@example.com" });
    const b = await createOrgWithOwner(app, { email: "b-poster@example.com" });

    const res = await request(app)
      .post("/api/v1/websites")
      .set("Authorization", `Bearer ${a.accessToken}`)
      // Try to trick the route into stamping the website as belonging to B.
      .send({
        organizationId: b.orgId,
        name: "Site under A",
        domain: "trick.example.com",
        allowedOrigins: [],
      });

    expect(res.status).toBe(201);
    expect(String(res.body.organizationId)).toBe(String(a.orgId));
    expect(String(res.body.organizationId)).not.toBe(String(b.orgId));
  });

  it("user B cannot see or fetch an agent owned by org A", async () => {
    const a = await createOrgWithOwner(app, { email: "a-agent@example.com" });
    const b = await createOrgWithOwner(app, { email: "b-agent@example.com" });
    const agentA = await createAgent({ orgId: a.orgId, name: "AgentA" });
    const agentAId = String(agentA._id);

    const list = await request(app)
      .get("/api/v1/agents")
      .set("Authorization", `Bearer ${b.accessToken}`);
    expect(list.status).toBe(200);
    const ids = (list.body as Array<{ _id: string }>).map((a) => String(a._id));
    expect(ids).not.toContain(agentAId);

    const direct = await request(app)
      .get(`/api/v1/agents/${agentAId}`)
      .set("Authorization", `Bearer ${b.accessToken}`);
    expect(direct.status).toBe(404);
  });

  it("POST /agents ignores a client-supplied organizationId", async () => {
    const a = await createOrgWithOwner(app, { email: "a-agent2@example.com" });
    const b = await createOrgWithOwner(app, { email: "b-agent2@example.com" });
    const siteA = await createWebsite({ orgId: a.orgId, domain: "a-agent2.example.com" });

    const res = await request(app)
      .post("/api/v1/agents")
      .set("Authorization", `Bearer ${a.accessToken}`)
      .send({ organizationId: b.orgId, websiteId: String(siteA._id), name: "ShouldBeOrgA" });

    expect(res.status).toBe(201);
    expect(String(res.body.organizationId)).toBe(String(a.orgId));
  });

  it("user B cannot fetch a conversation owned by org A", async () => {
    const a = await createOrgWithOwner(app, { email: "a-conv@example.com" });
    const b = await createOrgWithOwner(app, { email: "b-conv@example.com" });

    const siteA = await createWebsite({ orgId: a.orgId, domain: "ac.example.com" });
    const agentA = await createAgent({ orgId: a.orgId });

    // Inject a conversation directly. We need a contactSessionId but the
    // schema only stores an ObjectId reference — a fresh ObjectId is enough
    // for the isolation test.
    const conv = await Conversation.create({
      threadId: crypto.randomUUID(),
      organizationId: a.orgId,
      websiteId: siteA._id,
      agentId: agentA._id,
      contactSessionId: new mongoose.Types.ObjectId(),
      status: "active",
    });

    const list = await request(app)
      .get("/api/v1/conversations")
      .set("Authorization", `Bearer ${b.accessToken}`);
    expect(list.status).toBe(200);
    const items = (list.body as { items: Array<{ _id: string }> }).items;
    const ids = items.map((c) => String(c._id));
    expect(ids).not.toContain(String(conv._id));

    const direct = await request(app)
      .get(`/api/v1/conversations/${String(conv._id)}`)
      .set("Authorization", `Bearer ${b.accessToken}`);
    expect(direct.status).toBe(404);
  });

  it("user B cannot see or fetch a knowledge source owned by org A", async () => {
    const a = await createOrgWithOwner(app, { email: "a-kb@example.com" });
    const b = await createOrgWithOwner(app, { email: "b-kb@example.com" });
    const siteA = await createWebsite({ orgId: a.orgId, domain: "akb.example.com" });
    const agentA = await createAgent({ orgId: a.orgId, websiteId: siteA._id });

    const ks = await KnowledgeSource.create({
      organizationId: a.orgId,
      agentId: agentA._id,
      type: "text",
      title: "Org A doc",
      content: "secret-content-for-org-a",
      extractedText: "secret-content-for-org-a",
      contentHash: crypto.createHash("sha256").update("rls-kb-test").digest("hex"),
      embeddingStatus: "pending",
      createdBy: new mongoose.Types.ObjectId(a.user.id),
      version: 1,
    });

    const list = await request(app)
      .get("/api/v1/knowledge")
      .set("Authorization", `Bearer ${b.accessToken}`);
    expect(list.status).toBe(200);
    const ids = (list.body as Array<{ _id: string }>).map((k) => String(k._id));
    expect(ids).not.toContain(String(ks._id));

    const direct = await request(app)
      .get(`/api/v1/knowledge/${String(ks._id)}`)
      .set("Authorization", `Bearer ${b.accessToken}`);
    expect(direct.status).toBe(404);
  });
});
