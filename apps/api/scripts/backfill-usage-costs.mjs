#!/usr/bin/env node
// Backfill UsageRecord.costUsd for records written before the /generation retry
// fix (see CHANGELOG_12.md / QA_TEST_RESULTS_1.md §17).
//
// Those records were saved with costUsd: 0 because fetchGeneration() gave up on
// OpenRouter's "not priced yet" 404 instead of retrying. The generation ids were
// stored correctly, so the real cost can still be fetched and applied.
//
// This matters beyond reporting: budget-limit.middleware.ts enforces plan caps
// by summing costUsd, so under-counted records mean budgets under-enforce.
//
// Usage:
//   node scripts/backfill-usage-costs.mjs            # dry run, prints what would change
//   node scripts/backfill-usage-costs.mjs --apply    # write the costs back
//   node scripts/backfill-usage-costs.mjs --apply --limit 500
//
// Safe to re-run: it only touches records that still have costUsd == 0 and at
// least one generation id, and it never lowers a cost that is already set.

import "dotenv/config";
import mongoose from "mongoose";

const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 1000;

const MONGO_URI = process.env.MONGODB_URI ?? process.env.MONGO_URI;
const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const KEY = process.env.OPENROUTER_API_KEY;

if (!MONGO_URI) { console.error("MONGODB_URI is not set."); process.exit(1); }
if (!KEY) { console.error("OPENROUTER_API_KEY is not set."); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Generations older than ~30 days may have aged out of OpenRouter's API; a 404
// here is terminal rather than "not ready", so one attempt is enough.
async function fetchCost(generationId) {
  try {
    const res = await fetch(`${OPENROUTER_URL}/generation?id=${encodeURIComponent(generationId)}`, {
      headers: { authorization: `Bearer ${KEY}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const json = await res.json();
    const total = json?.data?.total_cost;
    if (typeof total !== "number") return { ok: false, reason: "no_cost" };
    return { ok: true, cost: total, data: json.data };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function main() {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  } catch {
    console.error(
      `Could not reach MongoDB at ${MONGO_URI.replace(/\/\/[^@]*@/, "//***@")}\n` +
      "Start the stack first: pnpm dev:infra",
    );
    process.exit(1);
  }
  const UsageRecord = mongoose.connection.collection("usagerecords");

  const candidates = await UsageRecord.find({
    costUsd: 0,
    generationIds: { $exists: true, $ne: [] },
  }).limit(LIMIT).toArray();

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${candidates.length} record(s) with costUsd: 0 and generation ids\n`);

  let repaired = 0, unresolved = 0, recovered = 0;

  for (const rec of candidates) {
    let sum = 0, found = 0;
    for (const gid of rec.generationIds) {
      const r = await fetchCost(gid);
      if (r.ok) { sum += r.cost; found += 1; }
      await sleep(120); // stay well inside OpenRouter's rate limit
    }

    if (found === 0) {
      unresolved += 1;
      console.log(`  ✗ ${rec._id} — none of ${rec.generationIds.length} generation(s) resolved`);
      continue;
    }

    repaired += 1;
    recovered += sum;
    console.log(
      `  ✓ ${rec._id} — ${found}/${rec.generationIds.length} generation(s) → $${sum.toFixed(6)}`,
    );

    if (APPLY) {
      await UsageRecord.updateOne(
        { _id: rec._id, costUsd: 0 },
        { $set: { costUsd: sum, backfilledAt: new Date() } },
      );
    }
  }

  console.log(
    `\n${APPLY ? "Applied" : "Would apply"}: ${repaired} record(s), ` +
    `$${recovered.toFixed(6)} recovered. Unresolved: ${unresolved}.`,
  );
  if (!APPLY && repaired > 0) console.log("Re-run with --apply to write these costs back.");

  await mongoose.disconnect();
}

main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
