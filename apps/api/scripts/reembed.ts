/**
 * Re-embed knowledge sources that have text content but no Pinecone vectors.
 *
 * Why this exists: earlier data (e.g. seed records) could be marked
 * `embeddingStatus: "synced"` without ever being upserted into Pinecone, so KB
 * search found nothing and the bot answered "I couldn't find that information".
 * This walks every source with an empty `pineconeIds` array that still has
 * extractable text and runs it through the real ingestion pipeline.
 *
 * Usage (from apps/api):
 *   pnpm tsx scripts/reembed.ts            # repair only unembedded sources
 *   pnpm tsx scripts/reembed.ts --all      # force re-ingest every source
 *   pnpm tsx scripts/reembed.ts --org <id> # limit to one organization
 */
import { connectDb, disconnectDb } from "../src/config/db.js";
import { KnowledgeSource } from "../src/models/index.js";
import { ingestSource } from "../src/services/kb/ingestion.service.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const all = process.argv.includes("--all");
  const orgId = arg("--org");

  await connectDb();

  const filter: Record<string, unknown> = {};
  if (orgId) filter.organizationId = orgId;
  if (!all) {
    // Sources with no vectors yet (missing or empty pineconeIds).
    filter.$or = [{ pineconeIds: { $exists: false } }, { pineconeIds: { $size: 0 } }];
  }

  const sources = await KnowledgeSource.find(filter, { title: 1, organizationId: 1 }).lean();
  // eslint-disable-next-line no-console
  console.log(`[reembed] ${sources.length} source(s) to process${all ? " (--all)" : ""}`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const s of sources) {
    const id = s._id.toString();
    try {
      await ingestSource(id);
      const after = await KnowledgeSource.findById(id, { chunkCount: 1, pineconeIds: 1 }).lean();
      const chunks = after?.chunkCount ?? 0;
      if (chunks === 0) {
        skipped++;
        // eslint-disable-next-line no-console
        console.log(`[reembed] SKIP  ${id} "${s.title}" (no chunkable text)`);
      } else {
        ok++;
        // eslint-disable-next-line no-console
        console.log(`[reembed] OK    ${id} "${s.title}" → ${chunks} chunk(s)`);
      }
    } catch (err) {
      failed++;
      // eslint-disable-next-line no-console
      console.error(`[reembed] FAIL  ${id} "${s.title}": ${(err as Error).message}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[reembed] done — embedded=${ok} skipped=${skipped} failed=${failed}`);
  await disconnectDb();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("[reembed] fatal", err);
  process.exit(1);
});
