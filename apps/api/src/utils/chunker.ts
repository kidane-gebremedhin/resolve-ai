// Text chunker — splits long text into overlapping chunks for embedding.
// Token estimate uses 4 chars ≈ 1 token (gpt-style); for production we'd use tiktoken.
//
// Defaults: ~1200 chars (~300 tokens) with ~150 chars overlap. Smaller chunks
// give finer-grained, more precise retrieval than the previous 2000-char chunks
// (a multi-section doc collapsed into too few coarse vectors). Overlap keeps
// context from being split across a boundary.
//
// Two structure-aware behaviours sit on top of that window, both bounded and
// both operating on boundaries already present in the markdown:
//
// 1. BOUNDARY REPAIR. The window can cut through a table, a fenced code block or
//    a list group, leaving two fragments where neither is readable — a header
//    with no rows, rows with no header, half a code block. A cut that lands
//    inside one of those moves to the structure's start so it survives whole.
//
// 2. HEADING PATH. Each chunk records the heading stack above it ("Billing >
//    Refunds > EU"), so an isolated chunk carries the context its position in
//    the document used to supply.
//
// Deliberately NOT here: semantic breakpoints, embedding-similarity splitting,
// a real markdown parser, or any change to the target size. This is a repair of
// the existing chunker, not a replacement for it.

import {
  extractHeadingSpans,
  findProtectedBlocks,
  headingPathAt,
  safeCut,
} from "./markdown-structure.js";

export type Chunk = {
  index: number;
  text: string;
  /** Heading stack above this chunk, outermost first. Empty for unheaded text. */
  headingPath?: string[];
};

export function chunkText(text: string, chunkChars = 1200, overlap = 150): Chunk[] {
  const out: Chunk[] = [];
  if (!text || text.trim().length === 0) return out;

  const blocks = findProtectedBlocks(text);
  const headings = extractHeadingSpans(text);

  let i = 0;
  let idx = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + chunkChars);
    // Try to break on a paragraph or sentence boundary near the window end.
    let cut = end;
    if (end < text.length) {
      const lastPara = text.lastIndexOf("\n\n", end);
      const lastSentence = text.lastIndexOf(". ", end);
      cut = Math.max(lastPara, lastSentence, end - 200);
      if (cut <= i) cut = end;
    }

    // Repair: pull the cut out of any structure it would split. Only applied
    // when it produces forward progress — a chunk that starts inside a very
    // long table has nowhere better to cut, and stalling would be worse than a
    // split.
    if (cut < text.length) {
      const repaired = safeCut(cut, blocks);
      if (repaired > i) cut = repaired;
    }

    const piece = text.slice(i, cut).trim();
    if (piece.length > 0) {
      // The path is taken at the chunk's MIDPOINT, not its start.
      //
      // Overlap drags a chunk's start backwards, often across a heading
      // boundary, so a chunk that is almost entirely "Billing > Errors" content
      // would be labelled "Billing > Plans" purely because its first 150
      // characters are the tail of the previous section. Labelling a code block
      // about error handling as part of the pricing section is worse than no
      // label: it is embedded with it. The midpoint picks whichever section
      // actually owns the chunk.
      const midpoint = Math.floor((i + cut) / 2);
      out.push({ index: idx++, text: piece, headingPath: headingPathAt(headings, midpoint) });
    }
    if (cut >= text.length) break;
    // Advance with overlap, but always make forward progress. (The previous
    // `Math.max(cut - overlap, cut)` always evaluated to `cut`, so overlap was
    // never actually applied.)
    const next = cut - overlap;
    i = next > i ? next : cut;
  }
  return out;
}

/**
 * The string that actually gets embedded.
 *
 * Prepending the heading path gives an isolated chunk the context it lost by
 * being isolated: "Refunds > EU" plus a paragraph about 14 days embeds much
 * closer to "EU refund window" than the paragraph alone, which never names the
 * subject. The stored text stays clean, so citations show the passage rather
 * than our annotation of it.
 */
export function embeddableText(chunk: Chunk): string {
  const path = chunk.headingPath?.filter(Boolean) ?? [];
  return path.length > 0 ? `${path.join(" > ")}\n\n${chunk.text}` : chunk.text;
}
