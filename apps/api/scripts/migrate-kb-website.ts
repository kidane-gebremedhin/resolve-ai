/**
 * Migrate KnowledgeSource from org-scoped to website-scoped.
 *  - Drops the old unique index { organizationId, contentHash }.
 *  - Backfills `websiteId` on existing sources (the org's first active website).
 *  - Re-ingests each backfilled source so its Pinecone vectors carry the new
 *    `websiteId` metadata (required for the per-website widget search).
 *
 * Usage (from apps/api):  pnpm tsx scripts/migrate-kb-website.ts
 */
import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../src/config/db.js";
import { KnowledgeSource, Website } from "../src/models/index.js";
import { ingestSource } from "../src/services/kb/ingestion.service.js";

async function main() {
  await connectDb();

  // 1) Drop the stale unique index if present.
  try {
    await KnowledgeSource.collection.dropIndex("organizationId_1_contentHash_1");
    // eslint-disable-next-line no-console
    console.log("[migrate] dropped old index organizationId_1_contentHash_1");
  } catch {
    // eslint-disable-next-line no-console
    console.log("[migrate] old index not present (ok)");
  }

  // 2) Backfill websiteId. Use the raw collection so docs missing the now-required
  // field can still be read.
  const missing = await KnowledgeSource.collection
    .find({ websiteId: { $exists: false } })
    .toArray();
  // eslint-disable-next-line no-console
  console.log(`[migrate] ${missing.length} source(s) missing websiteId`);

  let migrated = 0;
  let skipped = 0;
  for (const doc of missing) {
    const orgId = doc.organizationId;
    const site = await Website.findOne({ organizationId: orgId, isActive: true }).sort({
      createdAt: 1,
    });
    if (!site) {
      skipped++;
      // eslint-disable-next-line no-console
      console.log(`[migrate] SKIP ${doc._id} — org ${orgId} has no active website`);
      continue;
    }
    await KnowledgeSource.collection.updateOne(
      { _id: doc._id },
      { $set: { websiteId: site._id } },
    );
    try {
      await ingestSource(doc._id.toString()); // re-embed so Pinecone gets websiteId metadata
      migrated++;
      // eslint-disable-next-line no-console
      console.log(`[migrate] OK   ${doc._id} -> website ${site.domain}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[migrate] re-ingest failed for ${doc._id}: ${(err as Error).message}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[migrate] done — migrated=${migrated} skipped=${skipped}`);
  await disconnectDb();
  await mongoose.connection.close().catch(() => undefined);
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("[migrate] fatal", err);
  process.exit(1);
});
