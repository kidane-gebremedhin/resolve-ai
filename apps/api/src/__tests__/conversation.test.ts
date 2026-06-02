// Conversation status transitions + cross-org isolation on writes.
// The conversation router exposes `PATCH /:id` but no `PATCH /:id/assign`
// endpoint at this point in the implementation. The assignment test below
// uses `PATCH /:id` with `assignedOperatorId` — which the route accepts via
// the same patchSchema — so we cover the "assignment can be set" behaviour
// without depending on a /assign sub-route. See the TODO note inline.

import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../test/app.js";
import {
  createAgent,
  createOrgWithOwner,
  createWebsite,
} from "../test/factories.js";
import { Conversation } from "../models/index.js";
import crypto from "node:crypto";
import mongoose from "mongoose";

async function seedConversation(opts: { orgId: string }): Promise<{
  id: string;
}> {
  const site = await createWebsite({ orgId: opts.orgId });
  const agent = await createAgent({ orgId: opts.orgId });
  const conv = await Conversation.create({
    threadId: crypto.randomUUID(),
    organizationId: opts.orgId,
    websiteId: site._id,
    agentId: agent._id,
    contactSessionId: new mongoose.Types.ObjectId(),
    status: "active",
  });
  return { id: String(conv._id) };
}

describe("conversations", () => {
  let app: Express;
  beforeAll(() => {
    app = createApp();
  });

  it("a freshly seeded conversation has status='active'", async () => {
    const a = await createOrgWithOwner(app, { email: "conv-active@example.com" });
    const { id } = await seedConversation({ orgId: a.orgId });
    const res = await request(app)
      .get(`/api/v1/conversations/${id}`)
      .set("Authorization", `Bearer ${a.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
  });

  it("PATCH /conversations/:id with status='resolved' stamps resolvedBy='operator'", async () => {
    const a = await createOrgWithOwner(app, { email: "conv-resolve@example.com" });
    const { id } = await seedConversation({ orgId: a.orgId });

    const res = await request(app)
      .patch(`/api/v1/conversations/${id}`)
      .set("Authorization", `Bearer ${a.accessToken}`)
      .send({ status: "resolved" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("resolved");
    expect(res.body.resolvedBy).toBe("operator");
    expect(res.body.resolvedAt).toBeDefined();
  });

  it("PATCH /conversations/:id with status='escalated' stamps escalatedAt", async () => {
    const a = await createOrgWithOwner(app, { email: "conv-escalate@example.com" });
    const { id } = await seedConversation({ orgId: a.orgId });

    const res = await request(app)
      .patch(`/api/v1/conversations/${id}`)
      .set("Authorization", `Bearer ${a.accessToken}`)
      .send({ status: "escalated" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("escalated");
    expect(res.body.escalatedAt).toBeDefined();
  });

  // TODO: when a dedicated `PATCH /conversations/:id/assign` endpoint lands,
  // switch this test to call it. For now we exercise the same field
  // (`assignedOperatorId`) through the existing PATCH /:id route — that is
  // the only assignment surface that exists in conversation.routes.ts today.
  it("PATCH /conversations/:id can set assignedOperatorId", async () => {
    const a = await createOrgWithOwner(app, { email: "conv-assign@example.com" });
    const { id } = await seedConversation({ orgId: a.orgId });
    const operatorId = String(new mongoose.Types.ObjectId());

    const res = await request(app)
      .patch(`/api/v1/conversations/${id}`)
      .set("Authorization", `Bearer ${a.accessToken}`)
      .send({ assignedOperatorId: operatorId });

    expect(res.status).toBe(200);
    expect(String(res.body.assignedOperatorId)).toBe(operatorId);
  });

  it("cannot PATCH a conversation owned by another org → 404", async () => {
    const a = await createOrgWithOwner(app, { email: "conv-isolate-a@example.com" });
    const b = await createOrgWithOwner(app, { email: "conv-isolate-b@example.com" });
    const { id } = await seedConversation({ orgId: a.orgId });

    const res = await request(app)
      .patch(`/api/v1/conversations/${id}`)
      .set("Authorization", `Bearer ${b.accessToken}`)
      .send({ status: "resolved" });

    expect(res.status).toBe(404);

    // And the conversation in A's org must remain untouched.
    const after = await Conversation.findById(id).lean();
    expect(after?.status).toBe("active");
    expect(after?.resolvedAt).toBeUndefined();
  });
});
