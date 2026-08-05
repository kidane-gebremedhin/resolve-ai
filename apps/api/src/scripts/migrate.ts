// Single migration entrypoint. Runs in two phases:
//   1. Index sync — Mongoose auto-creates indexes when autoIndex is true (dev). In
//      production autoIndex is off, so we `syncIndexes()` every registered model here.
//      Idempotent, so it runs every time.
//   2. Data migrations — applies every migration in src/migrations not yet recorded in the
//      SchemaMigration ledger, in order, recording each after it succeeds. Re-running only
//      applies what's new. Add a migration by dropping a module in src/migrations and
//      appending it to src/migrations/index.ts — no new package script needed.
//
// This lives under src/ (not scripts/) so it is COMPILED into dist and can run in the
// production image with plain `node dist/scripts/migrate.js` — the container entrypoint
// runs it on every deploy before starting the server (see apps/api/docker-entrypoint.sh).
// `pnpm db:migrate` runs the same file via tsx in dev.
import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../config/db.js";
import "../models/index.js";
import { SchemaMigration } from "../models/index.js";
import { migrations } from "../migrations/index.js";

/* eslint-disable no-console */
async function main() {
  await connectDb();

  console.log("[migrate] phase 1 — syncing indexes");
  for (const [name, model] of Object.entries(mongoose.models)) {
    console.log(`  syncIndexes: ${name}`);
    await model.syncIndexes();
  }

  console.log("[migrate] phase 2 — data migrations");
  const applied = new Set(
    (await SchemaMigration.find().select("migrationId").lean()).map((m) => m.migrationId as string),
  );
  let ran = 0;
  for (const mig of migrations) {
    if (applied.has(mig.id)) {
      console.log(`  skip (already applied): ${mig.id}`);
      continue;
    }
    console.log(`  applying: ${mig.id} — ${mig.description}`);
    await mig.up();
    await SchemaMigration.create({ migrationId: mig.id });
    ran++;
  }
  console.log(`[migrate] done — ${ran} data migration(s) applied, ${applied.size + ran} total recorded`);

  await disconnectDb();
}

main().catch(async (err) => {
  console.error("[migrate] failed", err);
  await mongoose.disconnect();
  process.exit(1);
});
