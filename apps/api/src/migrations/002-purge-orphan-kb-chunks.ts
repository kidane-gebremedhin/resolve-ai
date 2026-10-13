import { KbChunk, KnowledgeSource } from "../models/index.js";
import { getPineconeIndex } from "../config/pinecone.js";
import { logger } from "../config/logger.js";
import type { Migration } from "./types.js";

// Remove KbChunk mirror rows whose source no longer exists.
//
// `purgeSourceVectors` used to return early when a source had no recorded
// vector ids, which skipped the mirror delete. Any source deleted in that state
// (Pinecone not configured, or an ingest that wrote the mirror and failed before
// recording ids) left its passages behind, still lexically retrievable. The
// purge is fixed; this clears what it already left.
//
// Only rows pointing at a source that is GONE are touched: that is index data
// for a deletion an operator already confirmed, not customer knowledge. Live
// sources and their passages are never read for deletion here.
//
// Idempotent: a second run finds no orphans and does nothing.

const BATCH = 500;

async function purgeOrphanChunks(): Promise<void> {
  const referenced = await KbChunk.distinct("sourceId");
  let orphanSources = 0;
  let removed = 0;

  for (let i = 0; i < referenced.length; i += BATCH) {
    const slice = referenced.slice(i, i + BATCH);
    const live = new Set(
      (await KnowledgeSource.find({ _id: { $in: slice } }, { _id: 1 }).lean()).map((s) => String(s._id)),
    );
    const gone = slice.filter((id) => !live.has(String(id)));
    if (gone.length === 0) continue;
    orphanSources += gone.length;

    // A passage's chunkId is its vector id. Best effort: a vector store that is
    // down must not block the deploy this migration runs in, and the mirror row
    // is what keeps a deleted source retrievable by keyword.
    const chunkIds = (await KbChunk.find({ sourceId: { $in: gone } }, { chunkId: 1 }).lean()).map((c) =>
      String(c.chunkId),
    );
    for (let j = 0; j < chunkIds.length; j += BATCH) {
      try {
        await getPineconeIndex().deleteMany(chunkIds.slice(j, j + BATCH));
      } catch (err) {
        logger.warn("[migration 002] vector delete failed, mirror rows still removed", {
          err: (err as Error).message,
        });
      }
    }

    const res = await KbChunk.deleteMany({ sourceId: { $in: gone } });
    removed += res.deletedCount ?? 0;
  }

  logger.info("[migration 002] orphan kb chunks purged", { orphanSources, removed });
}

export const migration: Migration = {
  id: "002-purge-orphan-kb-chunks",
  description: "Remove KbChunk mirror rows (and their vectors) left behind by sources deleted with no recorded vector ids",
  async up() {
    await purgeOrphanChunks();
  },
};
