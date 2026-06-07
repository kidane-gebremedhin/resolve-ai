/**
 * Scrub website/brand-derived names off existing agents.
 *
 * Older default agents were created as `"{website.name} agent"` (e.g.
 * "shipfaster.app agent2"), so the widget — and the AI when asked "who are
 * you?" — referred to the site/company instead of an Agent identity. New agents
 * now default to the brand-neutral "Support agent"; this backfills old ones.
 *
 * Only the precise auto-generated pattern `^{site name|domain} agent...` is
 * touched — operator-chosen names (e.g. "Riley", "Acme Helper") are left alone.
 *
 * Usage (from apps/api):
 *   pnpm tsx scripts/migrate-agent-names.ts            # dry run (prints changes)
 *   pnpm tsx scripts/migrate-agent-names.ts --apply    # write the changes
 */
import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../src/config/db.js";
import { Agent, Website } from "../src/models/index.js";

const APPLY = process.argv.includes("--apply");
const CLEAN_NAME = "Support agent";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Does `agentName` look auto-derived from the website (the "{site} agent[N]"
// pattern), as opposed to an operator-chosen name?
function isWebsiteDerived(agentName: string, sources: string[]): boolean {
  // Matches "{site} agent", "{site} agent2", "{site} agent-6" — but not a name
  // that merely starts the same way (e.g. "{site} agentic-tool"). Note: a plain
  // `agent\b` fails on "agent2" (no word boundary before a digit), hence the
  // explicit lookahead for end/space/digit/hyphen.
  return sources
    .filter((s) => s && s.trim().length >= 2)
    .some((src) =>
      new RegExp(`^\\s*${escapeRegExp(src.trim())}\\s+agent(?=$|[\\s\\d-])`, "i").test(agentName),
    );
}

async function main() {
  await connectDb();

  const agents = await Agent.find({}).lean();
  // eslint-disable-next-line no-console
  console.log(`[migrate-agent-names] scanning ${agents.length} agent(s) — ${APPLY ? "APPLY" : "DRY RUN"}`);

  let changed = 0;
  for (const a of agents) {
    if (!a.name || a.name === CLEAN_NAME) continue;
    const site = a.websiteId ? await Website.findById(a.websiteId).lean() : null;
    const sources = [site?.name, site?.domain].filter(Boolean) as string[];
    if (!isWebsiteDerived(a.name, sources)) continue;

    // eslint-disable-next-line no-console
    console.log(`  ${a._id}: ${JSON.stringify(a.name)} -> ${JSON.stringify(CLEAN_NAME)}`);
    changed++;
    if (APPLY) {
      await Agent.collection.updateOne({ _id: a._id }, { $set: { name: CLEAN_NAME } });
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[migrate-agent-names] ${APPLY ? "renamed" : "would rename"} ${changed} agent(s)` +
      (APPLY ? "" : " — re-run with --apply to write"),
  );
  await disconnectDb();
  await mongoose.connection.close().catch(() => undefined);
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("[migrate-agent-names] fatal", err);
  process.exit(1);
});
