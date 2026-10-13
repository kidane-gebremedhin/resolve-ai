// The chunker runs synchronously inside the API process, so its cost is time
// in which no request, socket event or streamed token is served for anyone.
//
// Two scans made it quadratic on common shapes (__specs/38 S1): an unbounded
// `lastIndexOf` that walked back to the start of the document when a separator
// was absent (CSV, HTML-derived text), and a linear heading lookup per chunk.
// A 25MB CSV took 537s. These tests pin two things: the output is identical to
// the original algorithm, and large inputs finish in bounded time.

import { describe, expect, it } from "vitest";
import { chunkText } from "../utils/chunker.js";
import {
  extractHeadingSpans,
  findProtectedBlocks,
  type HeadingSpan,
  type ProtectedBlock,
} from "../utils/markdown-structure.js";

// ---- The original algorithm, verbatim apart from names, as the reference ----

function refHeadingPathAt(spans: readonly HeadingSpan[], offset: number): string[] {
  let path: string[] = [];
  for (const span of spans) {
    if (span.start > offset) break;
    path = span.path;
  }
  return path;
}

function refSafeCut(cut: number, blocks: readonly ProtectedBlock[]): number {
  for (const block of blocks) {
    if (cut > block.start && cut < block.end) return block.start;
  }
  return cut;
}

function refChunkText(text: string, chunkChars = 1200, overlap = 150) {
  const out: { index: number; text: string; headingPath?: string[] }[] = [];
  if (!text || text.trim().length === 0) return out;
  const blocks = findProtectedBlocks(text);
  const headings = extractHeadingSpans(text);
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
    if (cut < text.length) {
      const repaired = refSafeCut(cut, blocks);
      if (repaired > i) cut = repaired;
    }
    const piece = text.slice(i, cut).trim();
    if (piece.length > 0) {
      const midpoint = Math.floor((i + cut) / 2);
      out.push({ index: idx++, text: piece, headingPath: refHeadingPathAt(headings, midpoint) });
    }
    if (cut >= text.length) break;
    const next = cut - overlap;
    i = next > i ? next : cut;
  }
  return out;
}

// ---- Deterministic document generator covering every structure the chunker knows ----

function prng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

function randomDoc(seed: number, size: number): string {
  const r = prng(seed);
  const words = "refund shipping order invoice account billing express region policy plan".split(" ");
  const sentence = () =>
    Array.from({ length: 4 + Math.floor(r() * 14) }, () => words[Math.floor(r() * words.length)]).join(" ") + ".";
  let s = "";
  while (s.length < size) {
    const k = r();
    if (k < 0.12) s += `${"#".repeat(1 + Math.floor(r() * 3))} Heading ${Math.floor(r() * 999)}\n\n`;
    else if (k < 0.2) s += "| a | b |\n|---|---|\n" + Array.from({ length: 1 + Math.floor(r() * 30) }, () => `| ${sentence()} | x |`).join("\n") + "\n\n";
    else if (k < 0.27) s += "```\n" + Array.from({ length: 1 + Math.floor(r() * 25) }, sentence).join("\n") + "\n```\n\n";
    else if (k < 0.35) s += Array.from({ length: 2 + Math.floor(r() * 12) }, () => `- ${sentence()}`).join("\n") + "\n\n";
    else if (k < 0.45) s += Array.from({ length: 5 + Math.floor(r() * 40) }, (_, n) => `${n},"${sentence()}"`).join("\n") + "\n";
    else s += Array.from({ length: 1 + Math.floor(r() * 6) }, sentence).join(" ") + (r() < 0.6 ? "\n\n" : " ");
  }
  return s;
}

describe("chunker", () => {
  it("produces exactly the original algorithm's chunks", () => {
    // Every structure the chunker reacts to, at sizes that cross many windows.
    for (let seed = 1; seed <= 60; seed++) {
      const doc = randomDoc(seed, 2_000 + seed * 1_500);
      expect(chunkText(doc), `seed ${seed}`).toEqual(refChunkText(doc));
    }
    // Shapes with no separators at all, where the old scan was worst.
    const csv = Array.from({ length: 3_000 }, (_, n) => `${n},"How do I do thing ${n}?","Answer ${n}"`).join("\n");
    expect(chunkText(csv)).toEqual(refChunkText(csv));
    const noBreaks = "x".repeat(20_000);
    expect(chunkText(noBreaks)).toEqual(refChunkText(noBreaks));
  });

  it("chunks 4MB of CSV in well under a second", () => {
    // The original took 23s here.
    const row = (n: number) => `${n},"How do I return order ${n}?","Refunds take five to ten business days after inspection."`;
    let csv = "id,question,answer\n";
    for (let n = 0; csv.length < 4 * 1024 * 1024; n++) csv += row(n) + "\n";
    const t = Date.now();
    const chunks = chunkText(csv);
    expect(chunks.length).toBeGreaterThan(3_000);
    expect(Date.now() - t).toBeLessThan(1_500);
  });

  it("chunks 4MB of heading-dense markdown in well under a second", () => {
    // The original took 1.2s here and 40.8s at 25MB.
    let md = "";
    for (let n = 0; md.length < 4 * 1024 * 1024; n++) {
      md += `# Heading ${n}\n\nRefunds are processed within five to ten business days. Express shipping costs extra.\n\n`;
    }
    const t = Date.now();
    const chunks = chunkText(md);
    expect(chunks.length).toBeGreaterThan(3_000);
    expect(chunks[chunks.length - 1]!.headingPath?.length).toBe(1);
    expect(Date.now() - t).toBeLessThan(1_500);
  });
});
