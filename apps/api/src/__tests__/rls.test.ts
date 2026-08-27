// Multi-org row-level isolation. The tests below all share the same pattern:
// create two orgs (A and B), create a resource owned by A, then try to access
// it as B and assert that the listing endpoint never reveals it and the
// detail endpoint 404s. The "body override" tests verify that the routes
// drop any `organizationId` value coming from the client and stamp the
// authenticated org instead.

import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../test/app.js";
import {
  createAgent,
  createOrgWithOwner,
  createWebsite,
  grantPlan,
} from "../test/factories.js";
import { Conversation, KbChunk, KnowledgeSource } from "../models/index.js";
import { lexicalSearch } from "../services/kb/lexical-search.service.js";
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
    // The website quota is 0 without a subscription, so A needs a plan before
    // the tenancy behaviour under test is even reachable.
    await grantPlan(a.orgId);

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

  // The lexical leg is a SECOND query path into customer knowledge, added
  // alongside the vector one. Everything above tests HTTP routes; this tests the
  // retrieval function directly, because that is where the leak would be. A
  // filter that is right in the route and wrong in the query is still a leak.
  describe("hybrid retrieval: the lexical leg", () => {
    const orgA = new mongoose.Types.ObjectId();
    const orgB = new mongoose.Types.ObjectId();
    const agentA1 = new mongoose.Types.ObjectId();
    const agentA2 = new mongoose.Types.ObjectId();
    const agentB1 = new mongoose.Types.ObjectId();

    // beforeEach, not beforeAll: the global setup wipes every collection between
    // tests, so a one-time seed would be gone by the first assertion.
    beforeEach(async () => {
      await KbChunk.syncIndexes();
      await KbChunk.insertMany([
        {
          organizationId: orgA, agentId: agentA1, sourceId: new mongoose.Types.ObjectId(),
          chunkIndex: 0, chunkId: "rls-a1:0",
          text: "Org A agent one: the escalation codeword is PELICAN.",
        },
        {
          organizationId: orgA, agentId: agentA2, sourceId: new mongoose.Types.ObjectId(),
          chunkIndex: 0, chunkId: "rls-a2:0",
          text: "Org A agent two: the escalation codeword is PELICAN as well.",
        },
        {
          organizationId: orgB, agentId: agentB1, sourceId: new mongoose.Types.ObjectId(),
          chunkIndex: 0, chunkId: "rls-b1:0",
          text: "Org B entirely: their escalation codeword is also PELICAN.",
        },
      ]);
    });

    it("org B's knowledge never appears in an org A query", async () => {
      const hits = await lexicalSearch({
        query: "PELICAN",
        organizationId: String(orgA),
        agentId: String(agentA1),
        topK: 10,
      });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.map((h) => h.chunkId)).not.toContain("rls-b1:0");
    });

    it("a sibling agent's knowledge never appears, inside the same org", async () => {
      // The subtler boundary: same paying tenant, different agent. Knowledge is
      // keyed by (organizationId, agentId) and both halves have to hold.
      const hits = await lexicalSearch({
        query: "PELICAN",
        organizationId: String(orgA),
        agentId: String(agentA1),
        topK: 10,
      });
      expect(hits.map((h) => h.chunkId)).toEqual(["rls-a1:0"]);
    });

    it("refuses an unscoped query rather than widening it", async () => {
      // `searchKb` refuses a missing agentId rather than falling back to an
      // org-wide search. The lexical leg must refuse identically, or the guard
      // is only as strong as whichever path the caller happened to take.
      await expect(
        lexicalSearch({ query: "PELICAN", organizationId: String(orgA), agentId: "", topK: 10 }),
      ).resolves.toEqual([]);

      await expect(
        lexicalSearch({ query: "PELICAN", organizationId: "", agentId: String(agentA1), topK: 10 }),
      ).resolves.toEqual([]);
    });
  });
});
