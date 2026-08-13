// Lifetime-deal coupon redemption.
//
// The most important case here is the concurrency one: two requests racing for
// the last slot must produce exactly ONE upgrade. A validate-then-increment
// implementation passes every other test in this file and still over-issues
// lifetime plans under load, so that test is the one that actually pins the
// design down.

import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import mongoose from "mongoose";
import { createApp } from "../test/app.js";
import { createOrgWithOwner, type RegisteredOwner } from "../test/factories.js";
import {
  Coupon,
  CouponRedemption,
  Organization,
  Subscription,
  User,
} from "../models/index.js";
import { redeemCoupon } from "../services/coupon.service.js";

const PASSWORD = "Passw0rd!test";

let counter = 0;
function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

async function makeCoupon(overrides: Record<string, unknown> = {}) {
  return Coupon.create({
    code: overrides.code ?? `LTD-TEST-${++counter}`,
    grantsTier: "business",
    maxRedemptions: 10,
    maxPerUser: 1,
    validFrom: new Date(Date.now() - 60_000),
    validUntil: null,
    isActive: true,
    partner: "AppSumo",
    ...overrides,
  });
}

/** Promotes a registered user to platform_admin and returns a fresh token. */
async function asPlatformAdmin(app: Express): Promise<string> {
  const email = uniqueEmail("padmin");
  await createOrgWithOwner(app, { email, password: PASSWORD });
  await User.updateOne({ email }, { $set: { role: "platform_admin" } });
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password: PASSWORD });
  return (login.body as { accessToken: string }).accessToken;
}

describe("LTD coupons", () => {
  let app: Express;

  beforeAll(async () => {
    app = createApp();
    // Mongoose builds indexes lazily; the unique (couponId, organizationId)
    // index is a correctness guarantee here, so force it into existence.
    await CouponRedemption.syncIndexes();
    await Coupon.syncIndexes();
  });

  beforeEach(() => {
    counter += 1000;
  });

  // ------------------------------------------------------------ happy path

  it("redeems a valid coupon and upgrades the organization", async () => {
    const owner = await createOrgWithOwner(app, { email: uniqueEmail("happy"), password: PASSWORD });
    const coupon = await makeCoupon({ grantsTier: "business" });

    const res = await request(app)
      .post("/api/v1/coupons/redeem")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      // Supertest sends no User-Agent by default; set one so the forensics
      // assertion below exercises real header capture.
      .set("User-Agent", "vitest-suite/1.0")
      .send({ code: coupon.code });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tierGranted).toBe("business");

    // Both entitlement surfaces must agree: the Organization.plan mirror the
    // quota middleware reads, and the Subscription the dashboard gate reads.
    const org = await Organization.findById(owner.orgId).lean();
    expect(org?.plan).toBe("business");

    const sub = await Subscription.findOne({ organizationId: owner.orgId }).lean();
    expect(sub?.plan).toBe("business");
    expect(sub?.status).toBe("active");
    expect(sub?.source).toBe("coupon");
    expect(sub?.couponCode).toBe(coupon.code);
    // Lifetime: the period end is far enough out that nothing expires it.
    expect(sub!.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now() + 10 * 365 * 864e5);

    // Audit row written, with forensics captured.
    const redemption = await CouponRedemption.findOne({ couponId: coupon._id }).lean();
    expect(redemption).toBeTruthy();
    expect(redemption?.tierGranted).toBe("business");
    expect(String(redemption?.organizationId)).toBe(owner.orgId);
    expect(redemption?.userAgent).toBe("vitest-suite/1.0");
    expect(redemption?.ipAddress).toBeTruthy();

    const after = await Coupon.findById(coupon._id).lean();
    expect(after?.redemptionsCount).toBe(1);
  });

  it("matches codes case-insensitively", async () => {
    const owner = await createOrgWithOwner(app, { email: uniqueEmail("case"), password: PASSWORD });
    const coupon = await makeCoupon();

    const res = await request(app)
      .post("/api/v1/coupons/redeem")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ code: coupon.code.toLowerCase() });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // -------------------------------------------------------- rejection rules

  const rejections: Array<{
    name: string;
    overrides: Record<string, unknown>;
    expected: string;
  }> = [
    { name: "inactive", overrides: { isActive: false }, expected: "no longer active" },
    {
      name: "not yet valid",
      overrides: { validFrom: new Date(Date.now() + 864e5) },
      expected: "not yet valid",
    },
    {
      name: "expired",
      overrides: { validUntil: new Date(Date.now() - 864e5) },
      expected: "expired",
    },
    {
      name: "global cap reached",
      overrides: { maxRedemptions: 2, redemptionsCount: 2 },
      expected: "maximum number of uses",
    },
  ];

  for (const rejection of rejections) {
    it(`rejects a ${rejection.name} coupon with its own message`, async () => {
      const owner = await createOrgWithOwner(app, {
        email: uniqueEmail(rejection.name.replace(/\s+/g, "")),
        password: PASSWORD,
      });
      const coupon = await makeCoupon(rejection.overrides);

      const res = await request(app)
        .post("/api/v1/coupons/redeem")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ code: coupon.code });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain(rejection.expected);

      // Nothing was granted.
      const org = await Organization.findById(owner.orgId).lean();
      expect(org?.plan ?? null).toBeNull();
    });
  }

  it("rejects an unknown code", async () => {
    const owner = await createOrgWithOwner(app, { email: uniqueEmail("unknown"), password: PASSWORD });
    const res = await request(app)
      .post("/api/v1/coupons/redeem")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ code: "NOPE-NOPE-NOPE" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid coupon code");
  });

  it("rejects a second redemption by the same organization", async () => {
    const owner = await createOrgWithOwner(app, { email: uniqueEmail("twice"), password: PASSWORD });
    const coupon = await makeCoupon({ grantsTier: "enterprise" });

    const first = await request(app)
      .post("/api/v1/coupons/redeem")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ code: coupon.code });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/v1/coupons/redeem")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ code: coupon.code });

    expect(second.status).toBe(400);
    // Rule 7 fires before rule 6 here — they already hold the tier.
    expect(second.body.message).toMatch(/already/i);

    // Crucially, the failed attempt must not have consumed a second slot.
    const after = await Coupon.findById(coupon._id).lean();
    expect(after?.redemptionsCount).toBe(1);
  });

  it("refuses to downgrade an organization already on a better plan", async () => {
    const owner = await createOrgWithOwner(app, { email: uniqueEmail("downgrade"), password: PASSWORD });
    await Organization.updateOne({ _id: owner.orgId }, { $set: { plan: "enterprise" } });

    const coupon = await makeCoupon({ grantsTier: "pro" });
    const res = await request(app)
      .post("/api/v1/coupons/redeem")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ code: coupon.code });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("You already have a enterprise plan");

    const org = await Organization.findById(owner.orgId).lean();
    expect(org?.plan).toBe("enterprise");
  });

  it("refuses when the org is already on the exact same plan", async () => {
    const owner = await createOrgWithOwner(app, { email: uniqueEmail("same"), password: PASSWORD });
    await Organization.updateOne({ _id: owner.orgId }, { $set: { plan: "business" } });

    const coupon = await makeCoupon({ grantsTier: "business" });
    const res = await request(app)
      .post("/api/v1/coupons/redeem")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ code: coupon.code });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("You already have a business plan");
  });

  it("allows an upgrade from a lower plan", async () => {
    const owner = await createOrgWithOwner(app, { email: uniqueEmail("upgrade"), password: PASSWORD });
    await Organization.updateOne({ _id: owner.orgId }, { $set: { plan: "pro" } });

    const coupon = await makeCoupon({ grantsTier: "enterprise" });
    const res = await request(app)
      .post("/api/v1/coupons/redeem")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ code: coupon.code });

    expect(res.status).toBe(200);
    const org = await Organization.findById(owner.orgId).lean();
    expect(org?.plan).toBe("enterprise");
  });

  it("enforces the per-user cap across two organizations", async () => {
    // maxPerUser 1: the same person redeeming for a second workspace is blocked
    // by the per-user count even though the org-level guard wouldn't catch it.
    const email = uniqueEmail("peruser");
    const first = await createOrgWithOwner(app, { email, password: PASSWORD });
    const coupon = await makeCoupon({ maxPerUser: 1 });

    const ok = await request(app)
      .post("/api/v1/coupons/redeem")
      .set("Authorization", `Bearer ${first.accessToken}`)
      .send({ code: coupon.code });
    expect(ok.status).toBe(200);

    // Second org owned by the SAME user.
    const user = await User.findOne({ email }).lean();
    const org2 = await Organization.create({ name: "Second WS", slug: `second-ws-${counter}` });
    await mongoose.models.Membership.create({
      userId: user!._id,
      organizationId: org2._id,
      role: "owner",
      status: "active",
      acceptedAt: new Date(),
    });

    const result = await redeemCoupon({
      code: coupon.code,
      userId: String(user!._id),
      userEmail: email,
      organizationId: String(org2._id),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe("already_used");
  });

  // ------------------------------------------------------------ concurrency

  it("grants exactly one upgrade when two orgs race for the final slot", async () => {
    const a = await createOrgWithOwner(app, { email: uniqueEmail("race-a"), password: PASSWORD });
    const b = await createOrgWithOwner(app, { email: uniqueEmail("race-b"), password: PASSWORD });

    // One slot left, two claimants.
    const coupon = await makeCoupon({ maxRedemptions: 1, redemptionsCount: 0 });

    const [ra, rb] = await Promise.all([
      redeemCoupon({
        code: coupon.code,
        userId: a.user.id,
        userEmail: a.user.email,
        organizationId: a.orgId,
      }),
      redeemCoupon({
        code: coupon.code,
        userId: b.user.id,
        userEmail: b.user.email,
        organizationId: b.orgId,
      }),
    ]);

    const succeeded = [ra, rb].filter((r) => r.ok);
    const failed = [ra, rb].filter((r) => !r.ok);

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as { failure: string }).failure).toBe("sold_out");

    // The counter must not exceed the cap...
    const after = await Coupon.findById(coupon._id).lean();
    expect(after?.redemptionsCount).toBe(1);

    // ...and exactly one audit row and one upgraded org must exist.
    const redemptions = await CouponRedemption.countDocuments({ couponId: coupon._id });
    expect(redemptions).toBe(1);

    const orgs = await Organization.find({
      _id: { $in: [a.orgId, b.orgId] },
      plan: { $exists: true, $ne: null },
    }).lean();
    expect(orgs).toHaveLength(1);
  });

  // -------------------------------------------------------------- validate

  it("previews a coupon without changing anything, and hides internal fields", async () => {
    const owner = await createOrgWithOwner(app, { email: uniqueEmail("preview"), password: PASSWORD });
    const coupon = await makeCoupon({
      description: "AppSumo Tier 3",
      internalNotes: "do not share",
    });

    const res = await request(app)
      .post("/api/v1/coupons/validate")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ code: coupon.code });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.coupon).toEqual({
      code: coupon.code,
      grantsTier: "business",
      description: "AppSumo Tier 3",
      partner: "AppSumo",
    });
    // Never leak the operational fields.
    expect(res.body.coupon.internalNotes).toBeUndefined();
    expect(res.body.coupon.maxRedemptions).toBeUndefined();
    expect(res.body.coupon.redemptionsCount).toBeUndefined();
    expect(res.body.coupon.createdBy).toBeUndefined();

    // Dry run: nothing consumed.
    const after = await Coupon.findById(coupon._id).lean();
    expect(after?.redemptionsCount).toBe(0);
    const org = await Organization.findById(owner.orgId).lean();
    expect(org?.plan ?? null).toBeNull();
  });

  // ------------------------------------------------------------------ authz

  it("requires authentication on both user endpoints", async () => {
    for (const path of ["/api/v1/coupons/validate", "/api/v1/coupons/redeem"]) {
      const res = await request(app).post(path).send({ code: "ANY-CODE-HERE" });
      expect(res.status).toBe(401);
    }
  });

  it("refuses redemption for a non-admin org member", async () => {
    // Coupons change what the workspace pays for, so agents/viewers are barred
    // by requireOrgRole("admin") the same way the billing routes bar them.
    const owner = await createOrgWithOwner(app, { email: uniqueEmail("viewer"), password: PASSWORD });
    const viewerEmail = uniqueEmail("v");
    const viewer = await createOrgWithOwner(app, { email: viewerEmail, password: PASSWORD });
    // Demote the viewer inside their own org.
    await mongoose.models.Membership.updateOne(
      { userId: viewer.user.id, organizationId: viewer.orgId },
      { $set: { role: "viewer" } },
    );
    const relogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: viewerEmail, password: PASSWORD });
    const viewerToken = (relogin.body as { accessToken: string }).accessToken;

    const coupon = await makeCoupon();
    const res = await request(app)
      .post("/api/v1/coupons/redeem")
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ code: coupon.code });

    expect(res.status).toBe(403);
    expect(String(owner.orgId)).toBeTruthy();
  });

  describe("admin routes", () => {
    const adminRoutes: Array<[string, string]> = [
      ["get", "/api/v1/admin/coupons"],
      ["post", "/api/v1/admin/coupons"],
      ["patch", `/api/v1/admin/coupons/${new mongoose.Types.ObjectId()}`],
      ["delete", `/api/v1/admin/coupons/${new mongoose.Types.ObjectId()}`],
      ["get", `/api/v1/admin/coupons/${new mongoose.Types.ObjectId()}/redemptions`],
    ];

    it("rejects every admin route without a token", async () => {
      for (const [method, path] of adminRoutes) {
        const res = await (request(app) as never as Record<string, (p: string) => request.Test>)[
          method
        ](path).send({});
        expect(res.status).toBe(401);
      }
    });

    it("rejects every admin route for a normal (non-platform-admin) user", async () => {
      const owner = await createOrgWithOwner(app, { email: uniqueEmail("nonadmin"), password: PASSWORD });
      for (const [method, path] of adminRoutes) {
        const res = await (request(app) as never as Record<string, (p: string) => request.Test>)[
          method
        ](path)
          .set("Authorization", `Bearer ${owner.accessToken}`)
          .send({});
        expect(res.status).toBe(403);
      }
    });

    it("creates a single coupon and lists it with redemption counts", async () => {
      const token = await asPlatformAdmin(app);

      const created = await request(app)
        .post("/api/v1/admin/coupons")
        .set("Authorization", `Bearer ${token}`)
        .send({ grantsTier: "business", maxRedemptions: 50, partner: "AppSumo" });

      expect(created.status).toBe(201);
      expect(created.body.code).toMatch(/^APPSUMO-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(created.body.grantsTier).toBe("business");

      const list = await request(app)
        .get("/api/v1/admin/coupons?partner=AppSumo")
        .set("Authorization", `Bearer ${token}`);

      expect(list.status).toBe(200);
      expect(list.body.items.length).toBeGreaterThan(0);
      expect(list.body.items[0]).toHaveProperty("actualRedemptions");
    });

    it("bulk-generates unique codes", async () => {
      const token = await asPlatformAdmin(app);
      const res = await request(app)
        .post("/api/v1/admin/coupons")
        .set("Authorization", `Bearer ${token}`)
        .send({ bulk: true, count: 25, grantsTier: "pro", maxRedemptions: 1, partner: "PitchGround" });

      expect(res.status).toBe(201);
      expect(res.body.created).toBe(25);
      expect(new Set(res.body.codes as string[]).size).toBe(25);
      for (const code of res.body.codes as string[]) {
        // No ambiguous characters anywhere in the generated segments.
        expect(code.replace("PITCHGROUND-", "")).not.toMatch(/[IO01]/);
      }
    });

    it("caps bulk generation at 1000", async () => {
      const token = await asPlatformAdmin(app);
      const res = await request(app)
        .post("/api/v1/admin/coupons")
        .set("Authorization", `Bearer ${token}`)
        .send({ bulk: true, count: 1001, grantsTier: "pro", maxRedemptions: 1 });
      expect(res.status).toBe(400);
    });

    it("keeps code and grantsTier immutable", async () => {
      const token = await asPlatformAdmin(app);
      const coupon = await makeCoupon();

      const res = await request(app)
        .patch(`/api/v1/admin/coupons/${coupon._id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ code: "HACKED-CODE", grantsTier: "enterprise" });

      // `.strict()` on the patch schema rejects unknown keys outright.
      expect(res.status).toBe(400);

      const unchanged = await Coupon.findById(coupon._id).lean();
      expect(unchanged?.code).toBe(coupon.code);
      expect(unchanged?.grantsTier).toBe("business");
    });

    it("refuses to delete a coupon that has redemptions", async () => {
      const token = await asPlatformAdmin(app);
      const owner = await createOrgWithOwner(app, { email: uniqueEmail("del"), password: PASSWORD });
      const coupon = await makeCoupon();

      await request(app)
        .post("/api/v1/coupons/redeem")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ code: coupon.code });

      const res = await request(app)
        .delete(`/api/v1/admin/coupons/${coupon._id}`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/isActive/);
      expect(await Coupon.findById(coupon._id)).toBeTruthy();
    });

    it("deletes an unredeemed coupon", async () => {
      const token = await asPlatformAdmin(app);
      const coupon = await makeCoupon();
      const res = await request(app)
        .delete(`/api/v1/admin/coupons/${coupon._id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(204);
      expect(await Coupon.findById(coupon._id)).toBeNull();
    });

    it("returns paginated redemption history", async () => {
      const token = await asPlatformAdmin(app);
      const owner = await createOrgWithOwner(app, { email: uniqueEmail("hist"), password: PASSWORD });
      const coupon = await makeCoupon();

      await request(app)
        .post("/api/v1/coupons/redeem")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ code: coupon.code });

      const res = await request(app)
        .get(`/api/v1/admin/coupons/${coupon._id}/redemptions`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].couponCode).toBe(coupon.code);
      expect(res.body.items[0].tierGranted).toBe("business");
    });
  });
});
