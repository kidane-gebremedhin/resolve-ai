/**
 * Migrate Agent from org-scoped to website-scoped (one agent per website).
 *  - Backfills `websiteId` on legacy agents (a free website in their org).
 *  - Creates a default agent for any website that doesn't have one yet.
 *
 * Usage (from apps/api):  pnpm tsx scripts/migrate-agent-website.ts
 */
import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../src/config/db.js";
import { Agent, Website } from "../src/models/index.js";
import { ensureWebsiteAgent } from "../src/services/agent-provisioning.js";

async function main() {
  await connectDb();

  // 1) Backfill websiteId on agents that don't have it. Assign each to a website
  //    in its org that has no agent yet.
  const missing = await Agent.collection.find({ websiteId: { $exists: false } }).toArray();
  // eslint-disable-next-line no-console
  console.log(`[migrate-agent] ${missing.length} agent(s) missing websiteId`);

  for (const a of missing) {
    const sites = await Website.find({ organizationId: a.organizationId }).sort({ createdAt: 1 });
    let target = null;
    for (const s of sites) {
      const has = await Agent.findOne({ websiteId: s._id });
      if (!has) {
        target = s;
        break;
      }
    }
    if (!target) {
      // eslint-disable-next-line no-console
      console.log(`[migrate-agent] SKIP agent ${a._id} — no free website in org ${a.organizationId}`);
      continue;
    }
    await Agent.collection.updateOne({ _id: a._id }, { $set: { websiteId: target._id } });
    // eslint-disable-next-line no-console
    console.log(`[migrate-agent] agent ${a._id} -> website ${target.domain}`);
  }

  // 2) Every website needs an agent — create defaults for any without one.
  const websites = await Website.find({}).sort({ createdAt: 1 });
  let created = 0;
  for (const s of websites) {
    const has = await Agent.findOne({ websiteId: s._id });
    if (!has) {
      await ensureWebsiteAgent(s.organizationId.toString(), s._id.toString(), `${s.name} agent`);
      created++;
      // eslint-disable-next-line no-console
      console.log(`[migrate-agent] created agent for website ${s.domain}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[migrate-agent] done — backfilled=${missing.length} created=${created}`);
  await disconnectDb();
  await mongoose.connection.close().catch(() => undefined);
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("[migrate-agent] fatal", err);
  process.exit(1);
});
