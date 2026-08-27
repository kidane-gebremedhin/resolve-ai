// Hybrid retrieval: structure-aware chunking, the lexical leg, and fusion.
//
// The chunker tests use a fixture containing all three structures fixed-size
// slicing destroys, because "we handle tables" is easy to believe and hard to
// be sure of. The fusion tests use hand-computed ranks. The lexical tests run
// against real Mongo through the in-memory server, because a `$text` query is
// exactly the kind of thing that passes as a mock and fails against the index.

import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { chunkText, embeddableText } from "../utils/chunker.js";
import {
  extractHeadingSpans,
  findProtectedBlocks,
  formatHeadingPath,
  headingPathAt,
  safeCut,
} from "../utils/markdown-structure.js";
import { fuseHybrid } from "../services/kb/hybrid-fusion.js";
import { lexicalSearch } from "../services/kb/lexical-search.service.js";
import { KbChunk } from "../models/index.js";
import { searchKb } from "../services/kb/search.service.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";
import type { KbHit } from "../services/kb/search.service.js";

// A document holding all three structures the repair exists for, each straddling
// where a 1200-char window would otherwise land.
const FILLER = "Some ordinary prose that exists only to push the window along. ".repeat(14);

const STRUCTURED_DOC = `# Billing

## Plans

${FILLER}

| Plan | Monthly | Annual | Seats |
| --- | --- | --- | --- |
| Starter | $29 | $290 | 3 |
| Team | $99 | $990 | 15 |
| Scale | $299 | $2,990 | 50 |

## Errors

${FILLER}

\`\`\`json
{
  "error": "ERR_4021",
  "message": "The subscription could not be charged",
  "retryable": true
}
\`\`\`

## Steps

${FILLER}

- First, open Settings
- Then choose Billing
- Then pick a plan
- Finally confirm the change
`;

describe("markdown structure", () => {
  describe("heading paths", () => {
    it("builds the full stack, not just the nearest heading", () => {
      const doc = "# Billing\n\n## Refunds\n\n### EU\n\ntext here\n";
      const spans = extractHeadingSpans(doc);
      const path = headingPathAt(spans, doc.indexOf("text here"));
      // "EU" alone is useless context; the stack is the whole point.
      expect(path).toEqual(["Billing", "Refunds", "EU"]);
      expect(formatHeadingPath(path)).toBe("Billing > Refunds > EU");
    });

    it("pops deeper headings when a shallower one starts a new section", () => {
      const doc = "# A\n\n## B\n\n### C\n\n## D\n\nunder D\n";
      const spans = extractHeadingSpans(doc);
      expect(headingPathAt(spans, doc.indexOf("under D"))).toEqual(["A", "D"]);
    });

    it("ignores headings inside fenced code", () => {
      // A `# comment` in a shell block is not a section.
      const doc = "# Real\n\n```bash\n# not a heading\necho hi\n```\n\nafter\n";
      const spans = extractHeadingSpans(doc);
      expect(headingPathAt(spans, doc.indexOf("after"))).toEqual(["Real"]);
    });

    it("returns an empty path for a document with no headings", () => {
      expect(headingPathAt(extractHeadingSpans("just text\n"), 3)).toEqual([]);
    });
  });

  describe("protected blocks", () => {
    it("finds tables, fenced code and list groups", () => {
      const kinds = findProtectedBlocks(STRUCTURED_DOC).map((b) => b.kind);
      expect(kinds).toContain("table");
      expect(kinds).toContain("code");
      expect(kinds).toContain("list");
    });

    it("does not treat a single list item as a group", () => {
      // Splitting between two paragraphs is exactly what the chunker should do.
      expect(findProtectedBlocks("- lonely item\n\nparagraph\n")).toEqual([]);
    });

    it("does not treat one pipe-delimited line as a table", () => {
      expect(findProtectedBlocks("a | b is not a table\n")).toEqual([]);
    });

    it("protects an unterminated fence to the end of the document", () => {
      const doc = "text\n\n```js\nconst a = 1;\nmore code\n";
      const [block] = findProtectedBlocks(doc);
      expect(block?.kind).toBe("code");
      expect(block!.end).toBeGreaterThanOrEqual(doc.trimEnd().length - 1);
    });
  });

  describe("safeCut", () => {
    it("moves a cut that lands inside a block to the block's start", () => {
      const blocks = [{ start: 100, end: 200, kind: "table" as const }];
      // The whole structure moves into the next chunk intact. Cutting at the
      // END instead would grow the current chunk by the structure's length,
      // which a 40-row table would blow entirely.
      expect(safeCut(150, blocks)).toBe(100);
    });

    it("leaves a cut already on an edge alone", () => {
      const blocks = [{ start: 100, end: 200, kind: "code" as const }];
      expect(safeCut(100, blocks)).toBe(100);
      expect(safeCut(200, blocks)).toBe(200);
      expect(safeCut(250, blocks)).toBe(250);
    });
  });
});

describe("structure-aware chunking", () => {
  const chunks = chunkText(STRUCTURED_DOC);

  it("never splits a markdown table", () => {
    // The divider row is what makes a table readable: a chunk holding rows
    // without it, or a header without rows, is unusable to a model.
    const tableRows = ["| Starter | $29", "| Team | $99", "| Scale | $299"];
    const holder = chunks.find((c) => c.text.includes(tableRows[0]!));
    expect(holder, "no chunk contains the table").toBeTruthy();
    for (const row of tableRows) {
      expect(holder!.text, `table split: ${row} landed in another chunk`).toContain(row);
    }
    expect(holder!.text).toContain("| Plan | Monthly | Annual | Seats |");
  });

  it("never splits a fenced code block", () => {
    const holder = chunks.find((c) => c.text.includes("ERR_4021"));
    expect(holder).toBeTruthy();
    // Both fences in the same chunk, or the JSON is not parseable by anyone.
    expect(holder!.text.match(/```/g)?.length).toBe(2);
    expect(holder!.text).toContain('"retryable": true');
  });

  it("never splits a list group", () => {
    const holder = chunks.find((c) => c.text.includes("First, open Settings"));
    expect(holder).toBeTruthy();
    expect(holder!.text).toContain("Finally confirm the change");
  });

  it("labels each chunk with the heading path at its start", () => {
    // The path is taken at the chunk's MIDPOINT. Taking it at the start looks
    // more natural and is wrong: overlap drags the start backwards across a
    // heading boundary, so a chunk that is almost entirely one section's content
    // gets labelled with the previous one. That label is then embedded with the
    // text, which is worse than having no label at all.
    const codeChunk = chunks.find((c) => c.text.includes("ERR_4021"));
    expect(codeChunk!.headingPath).toEqual(["Billing", "Errors"]);

    // The first chunk opens on the H1 but is mostly "Plans" content, and the
    // midpoint rule labels it accordingly rather than by the line it starts on.
    expect(chunks[0]!.headingPath).toEqual(["Billing", "Plans"]);

    // Every chunk gets a path, and every path starts at the document root.
    for (const c of chunks) {
      expect(c.headingPath!.length).toBeGreaterThan(0);
      expect(c.headingPath![0]).toBe("Billing");
    }
  });

  it("leaves unbroken text byte-identical to the old chunker", () => {
    // The repair must only touch chunks that were ACTUALLY broken. Text with no
    // protected structures in it has nothing to repair, so it must come back
    // exactly as the previous chunker produced it — otherwise every existing
    // chunk id in every customer's index shifts for no reason, and a backfill
    // that should be a no-op re-embeds the whole corpus.
    //
    // The old algorithm is inlined here rather than described, so this asserts
    // equality against the real thing instead of against my memory of it.
    const legacyChunk = (text: string, chunkChars = 1200, overlap = 150) => {
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
    };

    for (const prose of [
      "Paragraph one. ".repeat(300),
      "A sentence without structures.\n\n".repeat(150),
      "short",
      "",
    ]) {
      const legacy = legacyChunk(prose);
      const current = chunkText(prose);
      expect(current.map((c) => c.text)).toEqual(legacy.map((c) => c.text));
      expect(current.map((c) => c.index)).toEqual(legacy.map((c) => c.index));
    }
  });

  it("prepends the heading path to the embedded text but not the stored text", () => {
    const chunk = { index: 0, text: "Refunds take 5-10 days.", headingPath: ["Billing", "Refunds"] };
    expect(embeddableText(chunk)).toBe("Billing > Refunds\n\nRefunds take 5-10 days.");
    // Stored text stays clean so a citation shows the passage, not our
    // annotation of it.
    expect(chunk.text).toBe("Refunds take 5-10 days.");
  });

  it("leaves the embedded text alone when there is no heading", () => {
    expect(embeddableText({ index: 0, text: "bare", headingPath: [] })).toBe("bare");
  });
});

describe("hybrid fusion", () => {
  const hit = (id: string, score: number): KbHit => ({
    sourceId: "src",
    sourceTitle: "",
    chunkIndex: Number(id),
    chunkId: `src:${id}`,
    text: `chunk ${id}`,
    score,
  });

  it("ranks a passage both legs found above one leg's favourite", () => {
    // dense rank 1 → 0.5 × 1/61 = 0.008197
    // both legs rank 2 → 0.5 × 1/62 × 2 = 0.016129
    // Agreement between two independent retrieval methods is the signal.
    const fused = fuseHybrid(
      [
        { leg: "dense", hits: [hit("1", 0.9), hit("2", 0.5)] },
        { leg: "lexical", hits: [hit("3", 12), hit("2", 8)] },
      ],
      { alpha: 0.5, strategy: "rrf", topK: 10 },
    );
    expect(fused[0]!.chunkId).toBe("src:2");
    expect(fused[0]!.retrievedBy!.sort()).toEqual(["dense", "lexical"]);
  });

  it("reports the dense cosine score, never a fused or lexical one", () => {
    // The score floor, the knowledge-gap threshold and the citation panel all
    // read this. None of them should ever see an unbounded $text score.
    const fused = fuseHybrid(
      [
        { leg: "dense", hits: [hit("1", 0.42)] },
        { leg: "lexical", hits: [hit("1", 97.3)] },
      ],
      { alpha: 0.5, strategy: "rrf", topK: 10 },
    );
    expect(fused[0]!.score).toBe(0.42);
  });

  it("alpha 1.0 excludes the lexical leg entirely", () => {
    const fused = fuseHybrid(
      [
        { leg: "dense", hits: [hit("1", 0.9)] },
        { leg: "lexical", hits: [hit("2", 20)] },
      ],
      { alpha: 1, strategy: "rrf", topK: 10 },
    );
    expect(fused.map((h) => h.chunkId)).toEqual(["src:1"]);
  });

  it("alpha 0.0 excludes the dense leg entirely", () => {
    const fused = fuseHybrid(
      [
        { leg: "dense", hits: [hit("1", 0.9)] },
        { leg: "lexical", hits: [hit("2", 20)] },
      ],
      { alpha: 0, strategy: "rrf", topK: 10 },
    );
    expect(fused.map((h) => h.chunkId)).toEqual(["src:2"]);
  });

  it("weighted fusion normalises each leg before blending", () => {
    // Raw scores are 0.9 vs 40: blending them directly would let the lexical
    // leg win by three orders of magnitude regardless of relevance. After
    // min-max both legs' top hit is 1.0, so alpha decides.
    const fused = fuseHybrid(
      [
        { leg: "dense", hits: [hit("1", 0.9), hit("9", 0.1)] },
        { leg: "lexical", hits: [hit("2", 40), hit("8", 5)] },
      ],
      { alpha: 0.7, strategy: "weighted", topK: 10 },
    );
    expect(fused[0]!.chunkId).toBe("src:1");
  });

  it("breaks ties deterministically", () => {
    const legs = [{ leg: "dense" as const, hits: [hit("2", 0.5), hit("1", 0.5)] }];
    const a = fuseHybrid(legs, { alpha: 1, strategy: "rrf", topK: 10 }).map((h) => h.chunkId);
    const b = fuseHybrid(legs, { alpha: 1, strategy: "rrf", topK: 10 }).map((h) => h.chunkId);
    expect(a).toEqual(b);
  });

  it("respects topK", () => {
    const fused = fuseHybrid(
      [{ leg: "dense", hits: [hit("1", 0.9), hit("2", 0.8), hit("3", 0.7)] }],
      { alpha: 1, strategy: "rrf", topK: 2 },
    );
    expect(fused).toHaveLength(2);
  });
});

describe("lexical search", () => {
  const ORG_A = new mongoose.Types.ObjectId();
  const ORG_B = new mongoose.Types.ObjectId();
  const AGENT_A = new mongoose.Types.ObjectId();
  const AGENT_A2 = new mongoose.Types.ObjectId();
  const AGENT_B = new mongoose.Types.ObjectId();

  beforeEach(async () => {
    await KbChunk.syncIndexes();
    await KbChunk.insertMany([
      {
        organizationId: ORG_A, agentId: AGENT_A, sourceId: new mongoose.Types.ObjectId(),
        chunkIndex: 0, chunkId: "a:0",
        text: "If the charge fails the API returns ERR_4021 and the subscription is not created.",
        headingPath: ["Billing", "Errors"],
      },
      {
        organizationId: ORG_A, agentId: AGENT_A, sourceId: new mongoose.Types.ObjectId(),
        chunkIndex: 1, chunkId: "a:1",
        text: "Refunds are issued within thirty days of the original purchase date.",
        headingPath: ["Billing", "Refunds"],
      },
      {
        organizationId: ORG_A, agentId: AGENT_A2, sourceId: new mongoose.Types.ObjectId(),
        chunkIndex: 0, chunkId: "a2:0",
        text: "A different agent in the same org also documents ERR_4021 handling.",
      },
      {
        organizationId: ORG_B, agentId: AGENT_B, sourceId: new mongoose.Types.ObjectId(),
        chunkIndex: 0, chunkId: "b:0",
        text: "Another tenant entirely, also mentioning ERR_4021 in its runbook.",
      },
    ]);
  });

  it("finds an exact rare token that dense retrieval has no signal for", async () => {
    // The specific query and the specific chunk, named. An embedding of
    // "ERR_4021" is not meaningfully near a passage containing it: the token is
    // rare precisely because it carries no distributional meaning, which is
    // what makes it a perfect lexical target and a hopeless dense one.
    const hits = await lexicalSearch({
      query: "ERR_4021",
      organizationId: String(ORG_A),
      agentId: String(AGENT_A),
      topK: 5,
    });
    expect(hits.map((h) => h.chunkId)).toContain("a:0");
    expect(hits[0]!.text).toContain("ERR_4021");
  });

  it("returns the chunk text from the mirror, untruncated", async () => {
    const hits = await lexicalSearch({
      query: "refunds thirty days",
      organizationId: String(ORG_A),
      agentId: String(AGENT_A),
      topK: 5,
    });
    expect(hits[0]!.text).toBe(
      "Refunds are issued within thirty days of the original purchase date.",
    );
  });

  describe("tenancy", () => {
    it("never crosses an organization boundary", async () => {
      const hits = await lexicalSearch({
        query: "ERR_4021",
        organizationId: String(ORG_A),
        agentId: String(AGENT_A),
        topK: 10,
      });
      expect(hits.map((h) => h.chunkId)).not.toContain("b:0");
    });

    it("never crosses an agent boundary inside one org", async () => {
      // The subtler leak: same tenant, different agent's knowledge base.
      const hits = await lexicalSearch({
        query: "ERR_4021",
        organizationId: String(ORG_A),
        agentId: String(AGENT_A),
        topK: 10,
      });
      expect(hits.map((h) => h.chunkId)).not.toContain("a2:0");
    });

    it("refuses to run without an agentId, exactly as searchKb refuses", async () => {
      const hits = await lexicalSearch({
        query: "ERR_4021",
        organizationId: String(ORG_A),
        agentId: "",
        topK: 10,
      });
      // Not "returns everything in the org" — returns nothing.
      expect(hits).toEqual([]);
    });

    it("refuses to run without an organizationId", async () => {
      const hits = await lexicalSearch({
        query: "ERR_4021",
        organizationId: "",
        agentId: String(AGENT_A),
        topK: 10,
      });
      expect(hits).toEqual([]);
    });
  });

  describe("degradation to dense-only", () => {
    // These are meaningless at the default alpha of 1.0, where the lexical leg
    // never runs at all: the assertions would pass without proving anything.
    // Forcing alpha here makes the test exercise the path it claims to.
    let previousAlpha: number;
    beforeEach(() => {
      previousAlpha = env.kb.hybridAlpha;
      (env.kb as { hybridAlpha: number }).hybridAlpha = 0.5;
    });
    afterEach(() => {
      (env.kb as { hybridAlpha: number }).hybridAlpha = previousAlpha;
    });

    it("survives the lexical leg throwing, and logs it", async () => {
      // The lexical leg is an enhancement. Losing it degrades retrieval to
      // exactly what it was before hybrid shipped, which is a working system;
      // letting it throw would take the whole reply down for an optimisation.
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
      const find = vi.spyOn(KbChunk, "find").mockImplementation(() => {
        throw new Error("text index missing");
      });

      try {
        const hits = await searchKb({
          query: "ERR_4021",
          organizationId: String(ORG_A),
          agentId: String(AGENT_A),
        });
        // Dense returns nothing here (no Pinecone in tests), but crucially the
        // call RESOLVED rather than rejecting.
        expect(Array.isArray(hits)).toBe(true);
        expect(warn).toHaveBeenCalledWith(
          "[kb] lexical leg failed, degrading to dense-only",
          expect.objectContaining({ err: "text index missing" }),
        );
      } finally {
        find.mockRestore();
        warn.mockRestore();
      }
    });

    it("survives the lexical leg hanging past its timeout", async () => {
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
      const find = vi.spyOn(KbChunk, "find").mockImplementation(
        () =>
          ({
            sort: () => ({
              limit: () => ({
                lean: () => new Promise(() => {}), // never settles
              }),
            }),
          }) as never,
      );

      try {
        const started = Date.now();
        const hits = await searchKb({
          query: "ERR_4021",
          organizationId: String(ORG_A),
          agentId: String(AGENT_A),
        });
        expect(Array.isArray(hits)).toBe(true);
        // It gave up rather than waiting forever.
        expect(Date.now() - started).toBeLessThan(env.kb.lexicalTimeoutMs + 3_000);
        expect(warn).toHaveBeenCalledWith(
          "[kb] lexical leg failed, degrading to dense-only",
          expect.objectContaining({ err: expect.stringContaining("timed out") }),
        );
      } finally {
        find.mockRestore();
        warn.mockRestore();
      }
    });
  });

  it("returns nothing for an empty query rather than everything", async () => {
    const hits = await lexicalSearch({
      query: "   ",
      organizationId: String(ORG_A),
      agentId: String(AGENT_A),
      topK: 10,
    });
    expect(hits).toEqual([]);
  });
});
