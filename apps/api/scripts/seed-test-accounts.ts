/**
 * seed-test-accounts.ts
 *
 * Seeds a complete set of manual-QA login accounts:
 *
 *   • One PAID organization (Business plan + an `active` Subscription) holding
 *     one account for each org membership role — owner / admin / agent / viewer.
 *   • One `platform_admin` account for the admin app. It gets its own tiny
 *     (unpaid) organization so it can also sign into the web app — without a
 *     membership its JWT carries no `organizationId` and every /app route 403s
 *     with "No organization context in token."
 *   • A Website + its Agent + WidgetSettings inside the paid org, so the widget
 *     is testable end-to-end the moment you log in.
 *
 * Idempotent: re-running upserts by email/slug and RESETS every seeded
 * password, so the credentials printed at the end are always the live ones.
 *
 * Run with:  pnpm --filter @csb/api db:seed
 *
 * The Mongo connection string comes from MONGODB_URI (env or .env) or `--uri`.
 * Override the shared password with `--password=...` (must satisfy the API's
 * strength policy: ≥8 chars, lower + upper + number + special).
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import {
    Agent,
    Membership,
    Organization,
    Subscription,
    User,
    Website,
    WidgetSettings,
} from "../src/models/index.js";

/* eslint-disable no-console */

// Matches BCRYPT_COST in auth.service.ts so seeded hashes are indistinguishable
// from ones the real signup flow produces.
const BCRYPT_COST = 12;

function flag(name: string): string | undefined {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit?.slice(name.length + 3);
}

const MONGODB_URI = flag("uri") ?? process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error("❌ No Mongo connection string. Set MONGODB_URI or pass --uri=<url>");
    process.exit(1);
}

const PASSWORD = flag("password") ?? "Test1234!";

// Mirrors `strongPassword` in auth.routes.ts. Enforced here too so a seeded
// account can never hold a password the app itself would reject on change.
const PASSWORD_RULES: Array<[RegExp, string]> = [
    [/[a-z]/, "a lowercase letter"],
    [/[A-Z]/, "an uppercase letter"],
    [/[0-9]/, "a number"],
    [/[^A-Za-z0-9]/, "a special character"],
];
{
    const missing = PASSWORD_RULES.filter(([re]) => !re.test(PASSWORD)).map(([, label]) => label);
    if (PASSWORD.length < 8) missing.unshift("at least 8 characters");
    if (missing.length) {
        console.error(`❌ Password must contain ${missing.join(", ")}.`);
        process.exit(1);
    }
}

// The paid workspace every role account belongs to.
const PAID_ORG = { name: "Acme Support Co", slug: "acme-support-co" } as const;
const PAID_PLAN = "business" as const;


// The platform admin's own workspace. It exists so the account has an org
// context at all (see the note by PLATFORM_ADMIN), and it is subscribed for the
// same reason: apps/web's /app layout is a HARD subscription gate — an org with
// no active plan is redirected to /checkout, so an unpaid Platform HQ dumped the
// platform admin on the plan picker instead of the dashboard.
const ADMIN_ORG = { name: "Platform HQ", slug: "platform-hq" } as const;

type SeedUser = {
    email: string;
    name: string;
    /** Platform-level role on the User document. */
    role: "user" | "platform_admin";
    /** Org membership role; omit for accounts that get their own org. */
    membershipRole?: "owner" | "admin" | "agent" | "viewer";
};

const PAID_ORG_USERS: SeedUser[] = [
    { email: "owner@acme.test", name: "Olivia Owner", role: "user", membershipRole: "owner" },
    { email: "admin@acme.test", name: "Adam Admin", role: "user", membershipRole: "admin" },
    { email: "agent@acme.test", name: "Ana Agent", role: "user", membershipRole: "agent" },
    { email: "viewer@acme.test", name: "Victor Viewer", role: "user", membershipRole: "viewer" },
];

const PLATFORM_ADMIN: SeedUser = {
    email: "platformadmin@acme.test",
    name: "Priya Platform",
    role: "platform_admin",
};

async function upsertUser(seed: SeedUser, passwordHash: string) {
    const user = await User.findOneAndUpdate(
        { email: seed.email },
        {
            $set: {
                email: seed.email,
                name: seed.name,
                provider: "credentials",
                passwordHash,
                role: seed.role,
                // Pre-verified so nothing in the app nags for a confirmation email.
                emailVerifiedAt: new Date(),
            },
            // Never carry 2FA or a half-finished password reset across a re-seed —
            // a stale totpSecret would lock you out with the printed password.
            $unset: {
                totpSecret: 1,
                totpEnabled: 1,
                recoveryCodes: 1,
                passwordResetTokenHash: 1,
                passwordResetExpires: 1,
            },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    return user!;
}

async function upsertOrg(
    org: { name: string; slug: string },
    extra: Record<string, unknown> = {},
) {
    const doc = await Organization.findOneAndUpdate(
        { slug: org.slug },
        { $set: { name: org.name, ...extra } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    return doc!;
}

async function upsertMembership(
    userId: mongoose.Types.ObjectId,
    organizationId: mongoose.Types.ObjectId,
    role: "owner" | "admin" | "agent" | "viewer",
) {
    await Membership.findOneAndUpdate(
        { userId, organizationId },
        { $set: { role, status: "active", acceptedAt: new Date() } },
        { upsert: true, setDefaultsOnInsert: true },
    );
}

// Seeded subscriptions carry NO Paddle identifiers.
//
// They used to be given synthetic ones ("ctm_seed_…"), which made
// `hasPaddleCustomer` true on the billing page — so "Manage subscription" and
// "Cancel subscription" rendered as working buttons, then failed against Paddle
// because no such customer exists. Leaving the ids unset makes the UI tell the
// truth: those buttons are disabled for a seeded workspace, exactly as they are
// for a coupon-granted one. Marked `source: "coupon"` for the same reason —
// this entitlement was granted directly, not bought through checkout.
async function seedPaidSubscription(organizationId: mongoose.Types.ObjectId) {
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await Subscription.findOneAndUpdate(
        { organizationId },
        {
            $set: {
                plan: PAID_PLAN,
                status: "active",
                source: "coupon",
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd,
                billingInterval: "month",
            },
            // Clear cancellation state from a previous run AND any synthetic
            // Paddle ids left by older versions of this script.
            $unset: {
                canceledAt: 1,
                cancelScheduledAt: 1,
                trialEndAt: 1,
                paddleSubscriptionId: 1,
                paddleCustomerId: 1,
                paddleData: 1,
            },
        },
        { upsert: true, setDefaultsOnInsert: true },
    );

    // Older runs mirrored the fake customer id onto the Organization too.
    await Organization.updateOne(
        { _id: organizationId },
        { $unset: { paddleCustomerId: 1, paddleSubscriptionId: 1 } },
    );
}

// Website + its Agent + WidgetSettings, mirroring what POST /websites does.
async function seedWidgetStack(organizationId: mongoose.Types.ObjectId) {
    const website = (await Website.findOneAndUpdate(
        { organizationId, domain: "acme.test" },
        {
            $set: {
                name: "Acme Marketing Site",
                description: "Seeded website for manual QA of the embeddable widget.",
                // Local dev origins so the widget can be embedded from a dev server
                // or the repo's test-widget.html without a CORS rejection.
                allowedOrigins: [
                    "http://localhost:3000",
                    "http://localhost:3001",
                    "http://localhost:5173",
                ],
                isActive: true,
            },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
    ))!;

    // Reuse the real provisioning helper so the seeded agent matches a
    // dashboard-created one exactly (generic name, env-driven model defaults).
    const { ensureWebsiteAgent } = await import("../src/services/agent-provisioning.js");
    const agent = await ensureWebsiteAgent(organizationId, website._id);

    await WidgetSettings.findOneAndUpdate(
        { organizationId, agentId: agent._id },
        {
            $set: {
                welcomeMessage: "Hi! How can I help today?",
                suggestedQuestions: [
                    "What can you help me with?",
                    "How do I get started?",
                    "How do I contact support?",
                ],
                primaryColor: "#4f46e5",
                headerStyle: "pinstripe",
                position: "bottom-right",
                theme: "light",
                showBranding: true,
                requireContactBeforeChat: false,
            },
        },
        { upsert: true, setDefaultsOnInsert: true },
    );

    return { website, agent };
}

async function main() {
    console.log("\n🌱 Seeding manual-QA accounts …\n");
    await mongoose.connect(MONGODB_URI!);
    console.log("🔌 Connected to MongoDB");

    const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_COST);

    // --- Paid org ---------------------------------------------------------
    const paidOrg = await upsertOrg(PAID_ORG, { plan: PAID_PLAN });
    console.log(`🏢 Organization "${paidOrg.name}" (${PAID_PLAN}) — ${paidOrg._id}`);

    await seedPaidSubscription(paidOrg._id);
    console.log(`💳 Subscription active until next month`);

    for (const seed of PAID_ORG_USERS) {
        const user = await upsertUser(seed, passwordHash);
        await upsertMembership(user._id, paidOrg._id, seed.membershipRole!);
        console.log(`👤 ${seed.email.padEnd(26)} ${seed.membershipRole}`);
    }

    // --- Platform admin ---------------------------------------------------
    const adminOrg = await upsertOrg(ADMIN_ORG, { plan: PAID_PLAN });
    await seedPaidSubscription(adminOrg._id);
    const adminUser = await upsertUser(PLATFORM_ADMIN, passwordHash);
    await upsertMembership(adminUser._id, adminOrg._id, "owner");
    console.log(`👤 ${PLATFORM_ADMIN.email.padEnd(26)} platform_admin (owner of "${adminOrg.name}")`);

    // --- Widget stack -----------------------------------------------------
    const { website, agent } = await seedWidgetStack(paidOrg._id);
    console.log(`🌐 Website "${website.name}" — ${website._id}`);
    console.log(`🤖 Agent   "${agent.name}" — ${agent._id}`);

    // --- Summary ----------------------------------------------------------
    console.log("\n────────────────────────────────────────────────────────────");
    console.log("  Shared password:", PASSWORD);
    console.log("────────────────────────────────────────────────────────────");
    console.log(`  owner@acme.test          owner    — ${paidOrg.name}`);
    console.log(`  admin@acme.test          admin    — ${paidOrg.name}`);
    console.log(`  agent@acme.test          agent    — ${paidOrg.name}`);
    console.log(`  viewer@acme.test         viewer   — ${paidOrg.name}`);
    console.log(`  platformadmin@acme.test  platform_admin — admin app`);
    console.log("────────────────────────────────────────────────────────────");
    console.log(`  Plan: ${PAID_PLAN} · websiteId: ${website._id} · agentId: ${agent._id}`);
    console.log("────────────────────────────────────────────────────────────");
    console.log(
        "\n⚠️  These plans are granted directly, with NO Paddle customer behind them.\n" +
        "    Plan gating, quotas and the billing summary all read from Mongo and work.\n" +
        "    The customer portal / upgrade / cancel buttons are disabled for these orgs\n" +
        "    because there is nothing on Paddle's side to open — run a real sandbox\n" +
        "    checkout if you need to exercise those flows.\n",
    );

    await mongoose.disconnect();
    console.log("✅ Seed complete\n");
}

main().catch(async (err) => {
    console.error("💥 Seed failed:", err);
    await mongoose.disconnect().catch(() => { });
    process.exit(1);
});
