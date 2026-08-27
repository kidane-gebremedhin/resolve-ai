/**
 * How much did boundary repair actually change?
 *
 * Re-chunks every source with the current chunker and with the previous
 * fixed-size algorithm, and reports where they differ. This exists because
 * "we repair broken chunks" is a claim, and the only honest way to state it is
 * with the share of the corpus that was actually broken — which may well be
 * zero on a given corpus, and that is a finding rather than a failure.
 *
 * Read-only. Run: pnpm tsx scripts/analyze-chunk-repair.ts
 */
import "dotenv/config";
import { connectDb, disconnectDb } from "../src/config/db.js";
import { KnowledgeSource } from "../src/models/index.js";
import { chunkText } from "../src/utils/chunker.js";
import { findProtectedBlocks } from "../src/utils/markdown-structure.js";

/** The chunker as it was before structure awareness. */
function legacyChunk(text: string, chunkChars = 1200, overlap = 150): { index: number; text: string }[] {
  const out: { index: number; text: string }[] = [];
  if (!text || text.trim().length === 0) return out;
  let i = 0;
  let idx = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + chunkChars);
    let cut = end;
    if (end < text.length) {
      const lastPara = text.lastIndexOf("\n\n", end);
      const lastSentence = text.lastIndexOf(". ", end);
      cut = Math.max(lastPara, lastSentence, end - 200);
      if (cut <= i) cut = end;
    }
    const piece = text.slice(i, cut).trim();
    if (piece.length > 0) out.push({ index: idx++, text: piece });
    if (cut >= text.length) break;
    const next = cut - overlap;
    i = next > i ? next : cut;
  }
  return out;
}

async function main(): Promise<void> {
  await connectDb();
  const sources = await KnowledgeSource.find({}, { title: 1, extractedText: 1, content: 1 }).lean();

  let totalChunks = 0;
  let changedChunks = 0;
  let sourcesWithStructures = 0;
  let sourcesChanged = 0;
  const perSource: string[] = [];

  for (const s of sources) {
    const text = (s.extractedText as string | undefined) ?? (s.content as string | undefined) ?? "";
    if (!text.trim()) continue;

    const blocks = findProtectedBlocks(text);
    if (blocks.length > 0) sourcesWithStructures++;

    const legacy = legacyChunk(text).map((c) => c.text);
    const current = chunkText(text).map((c) => c.text);
    totalChunks += Math.max(legacy.length, current.length);

    const differing = Math.max(legacy.length, current.length) - legacy.filter((t, i) => t === current[i]).length;
    if (differing > 0) sourcesChanged++;
    changedChunks += differing;

    perSource.push(
      `  ${String(s.title).padEnd(24)} chunks ${legacy.length}→${current.length}  ` +
        `blocks[${blocks.map((b) => b.kind).join(",") || "none"}]  changed=${differing}`,
    );
  }

  console.log(`\n[chunk-repair] ${sources.length} source(s)\n`);
  console.log(perSource.join("\n"));
  console.log(
    `\n[chunk-repair] ${changedChunks} of ${totalChunks} chunks changed ` +
      `(${totalChunks === 0 ? 0 : ((changedChunks / totalChunks) * 100).toFixed(1)}% of the corpus), ` +
      `across ${sourcesChanged}/${sources.length} sources.`,
  );
  console.log(
    `[chunk-repair] ${sourcesWithStructures}/${sources.length} sources contain a table, fenced code block or list group at all.`,
  );

  await disconnectDb();
}

main().catch((err) => {
  console.error("[chunk-repair] fatal", err);
  process.exit(1);
});
