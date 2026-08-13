/**
 * seed-coupons.ts
 *
 * Seeds lifetime-deal coupons in every state the redemption flow can be in, so
 * each business rule can be exercised by hand without editing the database:
 *
 *   SEED-HAPPY-BIZ      valid, plenty of capacity   → succeeds
 *   SEED-HAPPY-PRO      valid, grants the pro tier  → succeeds (or "already have")
 *   SEED-HAPPY-ENT      valid, grants enterprise    → succeeds
 *   SEED-INACTIVE       isActive: false             → "no longer active"
 *   SEED-FUTURE         validFrom in +30d           → "not yet valid"
 *   SEED-EXPIRED        validUntil 30d ago          → "expired"
 *   SEED-SOLDOUT        redemptionsCount == max     → "maximum number of uses"
 *   SEED-LASTSLOT       exactly one slot left       → for racing two redemptions
 *
 * Idempotent: upserts by code and RESETS counters/dates, so re-running restores
 * every coupon to its intended state after you've burned through them.
 *
 * Run with:  pnpm --filter @csb/api db:seed:coupons
 *
 * Connection string from MONGODB_URI (env or .env) or `--uri=<url>`.
 */

import "dotenv/config";
import mongoose from "mongoose";
import { Coupon, CouponRedemption } from "../src/models/index.js";

/* eslint-disable no-console */

function flag(name: string): string | undefined {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit?.slice(name.length + 3);
}

const MONGODB_URI = flag("uri") ?? process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error("❌ No Mongo connection string. Set MONGODB_URI or pass --uri=<url>");
    process.exit(1);
}

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

type SeedCoupon = {
    code: string;
    grantsTier: "pro" | "business" | "enterprise";
    maxRedemptions: number;
    redemptionsCount: number;
    maxPerUser: number;
    validFrom: Date;
    validUntil: Date | null;
    isActive: boolean;
    partner?: string;
    campaign?: string;
    description?: string;
    internalNotes?: string;
    /** What this row is for — printed, not stored. */
    expect: string;
};

const COUPONS: SeedCoupon[] = [
    {
        code: "SEED-HAPPY-BIZ",
        grantsTier: "business",
        maxRedemptions: 100,
        redemptionsCount: 0,
        maxPerUser: 1,
        validFrom: new Date(now - DAY),
        validUntil: null,
        isActive: true,
        partner: "AppSumo",
        campaign: "ltd-launch",
        description: "AppSumo Tier 2 — Business, lifetime",
        internalNotes: "Never shown to the redeemer. If you can see this in the UI, that's a bug.",
        expect: "redeems successfully → org on business",
    },
    {
        code: "SEED-HAPPY-PRO",
        grantsTier: "pro",
        maxRedemptions: 100,
        redemptionsCount: 0,
        maxPerUser: 1,
        validFrom: new Date(now - DAY),
        validUntil: null,
        isActive: true,
        partner: "PitchGround",
        description: "PitchGround Tier 1 — Pro, lifetime",
        expect: "redeems on a free org; refused on business/enterprise (no downgrade)",
    },
    {
        code: "SEED-HAPPY-ENT",
        grantsTier: "enterprise",
        maxRedemptions: 100,
        redemptionsCount: 0,
        maxPerUser: 1,
        validFrom: new Date(now - DAY),
        validUntil: null,
        isActive: true,
        partner: "StackSocial",
        description: "StackSocial Tier 3 — Enterprise, lifetime",
        expect: "upgrades even an org already on business",
    },
    {
        code: "SEED-INACTIVE",
        grantsTier: "business",
        maxRedemptions: 100,
        redemptionsCount: 0,
        maxPerUser: 1,
        validFrom: new Date(now - DAY),
        validUntil: null,
        isActive: false,
        partner: "AppSumo",
        expect: '"This coupon is no longer active"',
    },
    {
        code: "SEED-FUTURE",
        grantsTier: "business",
        maxRedemptions: 100,
        redemptionsCount: 0,
        maxPerUser: 1,
        validFrom: new Date(now + 30 * DAY),
        validUntil: null,
        isActive: true,
        partner: "AppSumo",
        expect: '"This coupon is not yet valid"',
    },
    {
        code: "SEED-EXPIRED",
        grantsTier: "business",
        maxRedemptions: 100,
        redemptionsCount: 0,
        maxPerUser: 1,
        validFrom: new Date(now - 60 * DAY),
        validUntil: new Date(now - 30 * DAY),
        isActive: true,
        partner: "AppSumo",
        expect: '"This coupon has expired"',
    },
    {
        code: "SEED-SOLDOUT",
        grantsTier: "business",
        maxRedemptions: 5,
        redemptionsCount: 5,
        maxPerUser: 1,
        validFrom: new Date(now - DAY),
        validUntil: null,
        isActive: true,
        partner: "AppSumo",
        expect: '"This coupon has reached its maximum number of uses"',
    },
    {
        code: "SEED-LASTSLOT",
        grantsTier: "enterprise",
        maxRedemptions: 1,
        redemptionsCount: 0,
        maxPerUser: 1,
        validFrom: new Date(now - DAY),
        validUntil: null,
        isActive: true,
        partner: "AppSumo",
        description: "One slot only — race two redemptions at this to prove exactly one wins.",
        expect: "exactly ONE of two concurrent redemptions succeeds",
    },
];

async function main() {
    console.log("\n🎟️  Seeding LTD coupons …\n");
    await mongoose.connect(MONGODB_URI!);
    console.log("🔌 Connected to MongoDB");

    for (const { expect: _expect, ...doc } of COUPONS) {
        await Coupon.findOneAndUpdate(
            { code: doc.code },
            { $set: doc, $unset: { createdBy: 1 } },
            { upsert: true, setDefaultsOnInsert: true },
        );
    }

    // Clear this run's redemption history for the seeded codes ONLY. The audit
    // log is append-only in production; wiping it here is deliberate so the
    // per-org "already used" guard doesn't block a repeat manual test.
    const seeded = await Coupon.find({ code: { $in: COUPONS.map((c) => c.code) } })
        .select("_id")
        .lean();
    const removed = await CouponRedemption.deleteMany({
        couponId: { $in: seeded.map((c) => c._id) },
    });

    console.log(`🧹 Cleared ${removed.deletedCount} prior redemption(s) of seeded coupons\n`);
    console.log("────────────────────────────────────────────────────────────────────");
    for (const c of COUPONS) {
        console.log(`  ${c.code.padEnd(16)} ${c.grantsTier.padEnd(11)} ${c.expect}`);
    }
    console.log("────────────────────────────────────────────────────────────────────");
    console.log(
        "\n  Redeem at  /app/billing  as an owner or admin of an org.\n" +
        "  Agents and viewers are refused (403) — coupons change what the org pays for.\n",
    );

    await mongoose.disconnect();
    console.log("✅ Coupon seed complete\n");
}

main().catch(async (err) => {
    console.error("💥 Coupon seed failed:", err);
    await mongoose.disconnect().catch(() => { });
    process.exit(1);
});
