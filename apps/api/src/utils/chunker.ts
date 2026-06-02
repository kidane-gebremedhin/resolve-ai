// Text chunker — splits long text into overlapping chunks for embedding.
// Token estimate uses 4 chars ≈ 1 token (gpt-style); for production we'd use tiktoken.
//
// Defaults: ~1200 chars (~300 tokens) with ~150 chars overlap. Smaller chunks
// give finer-grained, more precise retrieval than the previous 2000-char chunks
// (a multi-section doc collapsed into too few coarse vectors). Overlap keeps
// context from being split across a boundary.

export type Chunk = { index: number; text: string };

export function chunkText(text: string, chunkChars = 1200, overlap = 150): Chunk[] {
  const out: Chunk[] = [];
  if (!text || text.trim().length === 0) return out;
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
    const piece = text.slice(i, cut).trim();
    if (piece.length > 0) out.push({ index: idx++, text: piece });
    if (cut >= text.length) break;
    // Advance with overlap, but always make forward progress. (The previous
    // `Math.max(cut - overlap, cut)` always evaluated to `cut`, so overlap was
    // never actually applied.)
    const next = cut - overlap;
    i = next > i ? next : cut;
  }
  return out;
}
