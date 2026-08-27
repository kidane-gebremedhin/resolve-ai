/**
 * Backfill `priority` and `sourceUpdatedAt` onto existing knowledge.
 *
 * This is a METADATA-ONLY update and needs no re-embedding, which is worth
 * stating plainly because it is not obvious: P4 moved retrieval's source of
 * truth for chunk text and metadata from Pinecone into the `kbchunks` mirror,
 * so conflict resolution reads these fields from Mongo. Pinecone metadata is
 * only a fallback for vectors written before the mirror existed, and it carries
 * no conflict fields for those — which is exactly the case where the fallback
 * already degrades to "no priority, no date", i.e. score-only resolution.
 *
 * Had retrieval still read from Pinecone, this would have required either a
 * per-vector metadata update (the wrapper in `config/pinecone.ts` exposes only
 * upsert/query/delete, so it would have needed extending) or a full re-embed.
 * Neither was necessary.
 *
 * `sourceUpdatedAt` is seeded from `lastSyncedAt` where available, falling back
 * to `updatedAt`. Both are approximations of when the CONTENT last changed —
 * that information was never recorded before this — and the script says so
 * rather than implying the dates are exact.
 *
 * Run: pnpm tsx scripts/backfill-conflict-metadata.ts [--dry-run] [--org <id>]
 */
import "dotenv/config";
import { connectDb, disconnectDb } from "../src/config/db.js";
import { KbChunk, KnowledgeSource } from "../src/models/index.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const orgId = arg("--org");

  await connectDb();

  const filter: Record<string, unknown> = {};
  if (orgId) filter.organizationId = orgId;

  const sources = await KnowledgeSource.find(filter, {
    title: 1,
    priority: 1,
    sourceUpdatedAt: 1,
    lastSyncedAt: 1,
    updatedAt: 1,
  }).lean();

  console.log(`[conflict-backfill] ${sources.length} source(s)${dryRun ? " (dry run)" : ""}\n`);

  let sourcesUpdated = 0;
  let chunksUpdated = 0;
  let alreadyDone = 0;

  for (const s of sources) {
    const needsPriority = s.priority === undefined || s.priority === null;
    const needsDate = !s.sourceUpdatedAt;

    if (!needsPriority && !needsDate) {
      alreadyDone++;
      continue;
    }

    // An approximation, and labelled as one: the real content-change time was
    // never recorded. `lastSyncedAt` is the closest available proxy.
    const seededDate =
      (s.sourceUpdatedAt as Date | undefined) ??
      (s.lastSyncedAt as Date | undefined) ??
      (s.updatedAt as Date | undefined) ??
      null;

    const set: Record<string, unknown> = {};
    if (needsPriority) set.priority = 0;
    if (needsDate && seededDate) set.sourceUpdatedAt = seededDate;

    console.log(
      `[conflict-backfill] ${dryRun ? "WOULD SET" : "SET"} ${String(s._id)} "${s.title}" ` +
        `priority=${set.priority ?? s.priority ?? 0} ` +
        `sourceUpdatedAt=${set.sourceUpdatedAt ? new Date(set.sourceUpdatedAt as Date).toISOString().slice(0, 10) : "unchanged"}`,
    );

    if (!dryRun) {
      await KnowledgeSource.updateOne({ _id: s._id }, { $set: set });
      // Mirror onto the chunks, which is where retrieval reads them.
      const res = await KbChunk.updateMany(
        { sourceId: s._id },
        { $set: { priority: set.priority ?? s.priority ?? 0, sourceUpdatedAt: seededDate } },
      );
      chunksUpdated += res.modifiedCount ?? 0;
    }
    sourcesUpdated++;
  }

  console.log(
    `\n[conflict-backfill] ${dryRun ? "would update" : "updated"} ${sourcesUpdated} source(s) ` +
      `and ${chunksUpdated} chunk(s); ${alreadyDone} already complete.`,
  );
  console.log("[conflict-backfill] no vectors were re-embedded and none needed to be.");

  await disconnectDb();
}

main().catch((err) => {
  console.error("[conflict-backfill] fatal", err);
  process.exit(1);
});
