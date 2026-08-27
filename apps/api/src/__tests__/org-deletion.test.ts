// "Delete my account" has to mean it.
//
// The failure this file exists to prevent is silent and was real: sixteen
// org-scoped collections survived deletion, including the full text of every
// knowledge document (`KbChunk`) and encrypted third-party credentials
// (`Connection`). Nothing errored. The customer was told their account was
// gone, the dashboard agreed, and the data was still there.
//
// A checklist item asking someone to remember every collection does not work —
// the list grows every time a feature ships. So the first test below derives
// the expectation from the models themselves and fails when a new one is added
// without a matching delete.

import { readFileSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import request from "supertest";
import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../test/app.js";
import { createOrgWithOwner, createAgent, createWebsite } from "../test/factories.js";
import * as models from "../models/index.js";
import { getStorage } from "../config/storage.js";

const ORG_ROUTES = path.resolve(process.cwd(), "src/routes/org.routes.ts");

/** Mongoose models whose documents belong to exactly one organization. */
function orgScopedModelNames(): string[] {
  return Object.entries(models)
    .filter(([, value]) => {
      const m = value as unknown as {
        deleteMany?: unknown;
        schema?: { path(name: string): unknown };
      };
      return typeof m?.deleteMany === "function" && Boolean(m.schema?.path("organizationId"));
    })
    .map(([name]) => name)
    .sort();
}

describe("the deletion cascade covers every org-scoped collection", () => {
  const source = readFileSync(ORG_ROUTES, "utf8");
  const cascade = source.slice(source.indexOf("2) Delete every org-scoped collection"));

  it("finds the models and the cascade at all", () => {
    // A test that silently matched nothing would pass forever.
    const names = orgScopedModelNames();
    expect(names.length).toBeGreaterThan(20);
    expect(names).toContain("KbChunk");
    expect(cascade).toContain("deleteMany");
  });

  it.each(orgScopedModelNames())("%s is deleted with the organization", (name) => {
    // `Membership` is handled separately, after the cascade, because deleting it
    // is what decides whether a user is orphaned and should go too.
    if (name === "Membership") return;
    expect(
      cascade.includes(`${name}.deleteMany({ organizationId: orgId })`),
      `${name} carries an organizationId but survives DELETE /orgs/current. ` +
        "Add it to the cascade in org.routes.ts, or carve out an exception in " +
        "__specs/12-security-compliance.md §6.7 and say why.",
    ).toBe(true);
  });

  it("purges the vector store and the object store, not just Mongo", () => {
    // Erasing the database while leaving embeddings and uploaded files behind is
    // not a deletion; it is a deletion of the index to the data.
    expect(cascade.length).toBeGreaterThan(0);
    expect(source).toContain("deleteByPrefix(`org/${orgId}/`)");
    expect(source).toContain("getPineconeIndex().deleteMany");
  });
});

describe("DELETE /orgs/current, end to end", () => {
  let app: Express;
  beforeAll(() => {
    app = createApp();
  });

  it("leaves nothing of the organization behind", async () => {
    const owner = await createOrgWithOwner(app, { email: `del-${Date.now()}@example.com` });
    const orgId = new mongoose.Types.ObjectId(owner.orgId);
    const site = await createWebsite({ orgId: owner.orgId, domain: `d${Date.now()}.test` });
    const agent = await createAgent({ orgId: owner.orgId, name: "Agent" });

    // Seed a document in every org-scoped collection the cascade claims to
    // cover, so "nothing left" is measured rather than assumed.
    const seeded: string[] = [];
    for (const name of orgScopedModelNames()) {
      if (name === "Membership") continue;
      const model = (models as unknown as Record<string, mongoose.Model<Record<string, unknown>>>)[name]!;
      try {
        await model.collection.insertOne({
          organizationId: orgId,
          agentId: agent._id,
          websiteId: site._id,
          _seeded: true,
        } as never);
        seeded.push(name);
      } catch {
        // A model with a stricter unique index may refuse a bare document; the
        // static check above already covers it.
      }
    }
    expect(seeded.length).toBeGreaterThan(15);

    const res = await request(app)
      .delete("/api/v1/orgs/current")
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);

    for (const name of seeded) {
      const model = (models as unknown as Record<string, mongoose.Model<unknown>>)[name]!;
      const left = await model.collection.countDocuments({ organizationId: orgId });
      expect(left, `${name} still holds ${left} document(s) for a deleted organization`).toBe(0);
    }

    await expect(models.Organization.exists({ _id: orgId })).resolves.toBeNull();
    await expect(models.Membership.exists({ organizationId: orgId })).resolves.toBeNull();
  });

  it("refuses to delete for anyone but the owner", async () => {
    const owner = await createOrgWithOwner(app, { email: `admin-${Date.now()}@example.com` });
    await models.Membership.updateOne(
      { organizationId: owner.orgId, userId: owner.user.id },
      { $set: { role: "admin" } },
    );
    const relogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: owner.user.email, password: "Password1234!" });

    const res = await request(app)
      .delete("/api/v1/orgs/current")
      .set("Authorization", `Bearer ${relogin.body.accessToken}`);

    expect(res.status).toBe(403);
    await expect(models.Organization.exists({ _id: owner.orgId })).resolves.toBeTruthy();
  });
});

describe("the storage adapter can actually erase a tenant", () => {
  it("deletes every object under an org prefix and leaves other orgs alone", async () => {
    const storage = getStorage();
    const keep = `org/${new mongoose.Types.ObjectId()}/attachments/keep.txt`;
    const orgId = new mongoose.Types.ObjectId().toString();

    await storage.putObject({
      key: `org/${orgId}/attachments/a.txt`,
      buffer: Buffer.from("a"),
      contentType: "text/plain",
    });
    await storage.putObject({
      key: `org/${orgId}/attachments/nested/b.txt`,
      buffer: Buffer.from("b"),
      contentType: "text/plain",
    });
    await storage.putObject({ key: keep, buffer: Buffer.from("k"), contentType: "text/plain" });

    const removed = await storage.deleteByPrefix(`org/${orgId}/`);
    expect(removed).toBe(2);

    await expect(storage.getObject(`org/${orgId}/attachments/a.txt`)).resolves.toBeNull();
    await expect(storage.getObject(`org/${orgId}/attachments/nested/b.txt`)).resolves.toBeNull();
    // Another tenant's object must be untouched — the prefix IS the boundary.
    await expect(storage.getObject(keep)).resolves.not.toBeNull();
  });

  it("is a no-op for an org that never uploaded anything", async () => {
    await expect(
      getStorage().deleteByPrefix(`org/${new mongoose.Types.ObjectId()}/`),
    ).resolves.toBe(0);
  });
});
