/**
 * Re-embed knowledge sources that have text content but no Pinecone vectors.
 *
 * Why this exists: earlier data (e.g. seed records) could be marked
 * `embeddingStatus: "synced"` without ever being upserted into Pinecone, so KB
 * search found nothing and the bot answered "I couldn't find that information".
 * This walks every source with an empty `pineconeIds` array that still has
 * extractable text and runs it through the real ingestion pipeline.
 *
 * Also the BACKFILL for the `KbChunk` mirror and heading paths: re-ingesting a
 * source rebuilds its chunks, its vectors and its mirror rows in one pass
 * through the real pipeline, so there is deliberately no second script.
 *
 * Usage (from apps/api):
 *   pnpm tsx scripts/reembed.ts               # repair only unembedded sources
 *   pnpm tsx scripts/reembed.ts --all         # force re-ingest every source
 *   pnpm tsx scripts/reembed.ts --org <id>    # limit to one organization
 *   pnpm tsx scripts/reembed.ts --all --dry-run   # cost + delta, writes nothing
 *   pnpm tsx scripts/reembed.ts --all --resume    # skip sources already mirrored
 *
 * RESUMABILITY is by observed state, not a checkpoint file: `--resume` skips any
 * source whose mirror row count already matches its chunk count. An interrupted
 * run is restarted with the same command and picks up where it stopped, and
 * there is no cursor to go stale if the corpus changes underneath it.
 */
import { connectDb, disconnectDb } from "../src/config/db.js";
import { KbChunk, KnowledgeSource } from "../src/models/index.js";
import { ingestSource } from "../src/services/kb/ingestion.service.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const all = process.argv.includes("--all");
  const dryRun = process.argv.includes("--dry-run");
  const resume = process.argv.includes("--resume");
  const orgId = arg("--org");

  await connectDb();

  const filter: Record<string, unknown> = {};
  if (orgId) filter.organizationId = orgId;
  if (!all) {
    // Sources with no vectors yet (missing or empty pineconeIds).
    filter.$or = [{ pineconeIds: { $exists: false } }, { pineconeIds: { $size: 0 } }];
  }

  const sources = await KnowledgeSource.find(filter, {
    title: 1,
    organizationId: 1,
    extractedText: 1,
    content: 1,
    chunkCount: 1,
  }).lean();
  // eslint-disable-next-line no-console
  console.log(`[reembed] ${sources.length} source(s) to process${all ? " (--all)" : ""}`);

  // Price the run before it writes anything. Re-embedding a corpus is the kind
  // of operation whose cost should never be a surprise discovered afterwards in
  // a provider bill.
  const totalChars = sources.reduce(
    (n, s) => n + ((s.extractedText as string | undefined) ?? (s.content as string | undefined) ?? "").length,
    0,
  );
  // The same 4-chars-per-token estimate the chunker uses. Deliberately rough and
  // stated as such: it is an order-of-magnitude check before spending, not an
  // invoice.
  const estTokens = Math.ceil(totalChars / 4);
  const costPer1M = Number(process.env.EMBEDDING_COST_PER_1M_TOKENS ?? 0.02);
  const estUsd = (estTokens / 1_000_000) * costPer1M;
  // eslint-disable-next-line no-console
  console.log(
    `[reembed] estimated ${estTokens.toLocaleString()} tokens across ${totalChars.toLocaleString()} chars ` +
      `→ ~$${estUsd.toFixed(4)} at $${costPer1M}/1M (model: ${process.env.EMBEDDING_MODEL ?? "text-embedding-3-small"})`,
  );

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log("[reembed] --dry-run: reporting the per-source delta, writing nothing\n");
    let wouldEmbed = 0;
    let alreadyMirrored = 0;
    for (const s of sources) {
      const id = s._id.toString();
      const mirrored = await KbChunk.countDocuments({ sourceId: s._id });
      const chunks = (s.chunkCount as number | undefined) ?? 0;
      const complete = mirrored > 0 && mirrored === chunks;
      if (complete) alreadyMirrored++;
      else wouldEmbed++;
      // eslint-disable-next-line no-console
      console.log(
        `[reembed] ${complete ? "SKIP " : "WRITE"} ${id} "${s.title}" — ` +
          `${chunks} chunk(s), ${mirrored} mirrored`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n[reembed] dry run: would re-ingest ${wouldEmbed}, already complete ${alreadyMirrored}, ` +
        `estimated cost ~$${estUsd.toFixed(4)}`,
    );
    await disconnectDb();
    return;
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let resumed = 0;
  const startedAt = Date.now();
  for (const s of sources) {
    const id = s._id.toString();
    try {
      if (resume) {
        // Already mirrored completely: nothing to redo. Cheap to check and it
        // makes an interrupted run restartable with the same command.
        const mirrored = await KbChunk.countDocuments({ sourceId: s._id });
        if (mirrored > 0 && mirrored === ((s.chunkCount as number | undefined) ?? -1)) {
          resumed++;
          // eslint-disable-next-line no-console
          console.log(`[reembed] RESUME-SKIP ${id} "${s.title}" (${mirrored} chunks already mirrored)`);
          continue;
        }
      }
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

  const elapsedMs = Date.now() - startedAt;
  // eslint-disable-next-line no-console
  console.log(
    `[reembed] done — embedded=${ok} skipped=${skipped} resume-skipped=${resumed} failed=${failed} ` +
      `in ${(elapsedMs / 1000).toFixed(1)}s (estimated ~$${estUsd.toFixed(4)})`,
  );
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.log("[reembed] re-run with --resume to retry only what did not finish.");
  }
  await disconnectDb();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("[reembed] fatal", err);
  process.exit(1);
});
