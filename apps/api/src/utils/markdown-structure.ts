// Markdown structure: heading paths and the block boundaries a chunker must not
// cut through.
//
// Both jobs are a single pass over lines. Nothing here parses markdown properly
// or pulls in a dependency: the chunker needs to know two things — which heading
// a character offset sits under, and whether an offset falls inside a table, a
// fenced code block or a list group — and those are answerable from line
// prefixes alone.

export type HeadingSpan = {
  /** Character offset where this heading's section begins (start of its own line). */
  start: number;
  /** Heading levels above it, e.g. ["Billing", "Refunds", "EU"]. */
  path: string[];
};

/** A region no chunk boundary may land inside. */
export type ProtectedBlock = {
  start: number;
  end: number;
  kind: "table" | "code" | "list";
};

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

/**
 * Walk the document once, recording where each heading's section starts and the
 * full path of headings above it.
 *
 * The path is a stack: an H3 under an H2 under an H1 yields all three, and a
 * new H2 pops the H3 off. That stack is the whole reason to do this rather than
 * attach the nearest heading — "EU" alone is useless context, "Billing >
 * Refunds > EU" is not.
 *
 * Headings inside fenced code are ignored: a `# comment` in a shell block is not
 * a section.
 */
export function extractHeadingSpans(text: string): HeadingSpan[] {
  const spans: HeadingSpan[] = [];
  const stack: { level: number; title: string }[] = [];
  let offset = 0;
  let inFence = false;

  for (const line of text.split("\n")) {
    if (FENCE.test(line)) inFence = !inFence;

    if (!inFence) {
      const m = HEADING.exec(line);
      if (m) {
        const level = m[1]!.length;
        const title = m[2]!.trim().replace(/\s*#+\s*$/, "");
        while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
        if (title) stack.push({ level, title });
        spans.push({ start: offset, path: stack.map((s) => s.title) });
      }
    }
    offset += line.length + 1; // +1 for the newline consumed by split
  }

  return spans;
}

/** The heading path in force at a character offset. */
export function headingPathAt(spans: readonly HeadingSpan[], offset: number): string[] {
  let path: string[] = [];
  for (const span of spans) {
    if (span.start > offset) break;
    path = span.path;
  }
  return path;
}

/** Render a path for prepending to embedded text. Empty for an unheaded document. */
export function formatHeadingPath(path: readonly string[]): string {
  return path.join(" > ");
}

/**
 * Find every region a chunk boundary must not land inside.
 *
 * Three kinds, because these are the three that fixed-size slicing visibly
 * destroys:
 * - **code**: a fence cut in half leaves two fragments, neither of which is
 *   valid or searchable.
 * - **table**: a table cut after its divider row leaves a header with no rows
 *   and rows with no header. The rows are the facts, and they become unreadable.
 * - **list**: a list group split mid-way separates items from the sentence that
 *   introduced them.
 *
 * Only groups worth protecting are returned: a single list item is not a group,
 * and splitting between two paragraphs is exactly what the chunker should do.
 */
export function findProtectedBlocks(text: string): ProtectedBlock[] {
  const lines = text.split("\n");
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1;
  }
  const endOf = (i: number): number => offsets[i]! + lines[i]!.length;

  const blocks: ProtectedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (FENCE.test(line)) {
      const start = offsets[i]!;
      let j = i + 1;
      while (j < lines.length && !FENCE.test(lines[j]!)) j++;
      // An unterminated fence runs to the end of the document; protecting to
      // the end is right, since there is no boundary inside it that is safe.
      blocks.push({ start, end: j < lines.length ? endOf(j) : endOf(lines.length - 1), kind: "code" });
      i = j + 1;
      continue;
    }

    if (TABLE_ROW.test(line) || TABLE_DIVIDER.test(line)) {
      const start = offsets[i]!;
      let j = i;
      while (j + 1 < lines.length && (TABLE_ROW.test(lines[j + 1]!) || TABLE_DIVIDER.test(lines[j + 1]!))) {
        j++;
      }
      // Two lines is the minimum real table (header + divider); one stray
      // pipe-delimited line is not a table.
      if (j > i) blocks.push({ start, end: endOf(j), kind: "table" });
      i = j + 1;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const start = offsets[i]!;
      let j = i;
      // A list group survives blank lines and indented continuation lines, so a
      // loose list is still one group.
      while (j + 1 < lines.length) {
        const next = lines[j + 1]!;
        const isItem = LIST_ITEM.test(next);
        const isContinuation = /^\s+\S/.test(next);
        const isBlank = next.trim() === "";
        const itemFollowsBlank =
          isBlank && j + 2 < lines.length && LIST_ITEM.test(lines[j + 2]!);
        if (isItem || isContinuation || itemFollowsBlank) j++;
        else break;
      }
      if (j > i) blocks.push({ start, end: endOf(j), kind: "list" });
      i = j + 1;
      continue;
    }

    i++;
  }

  return blocks;
}

/**
 * Move a proposed cut out of any block it would split.
 *
 * Returns the block's start when the cut lands inside one, so the whole
 * structure moves into the next chunk intact. Cutting at the block's END would
 * be the alternative, but that grows the current chunk past its target size by
 * however long the structure is, and a 40-row table would blow it entirely.
 *
 * A cut at a block's exact start or end is already on an edge and is left alone.
 */
export function safeCut(cut: number, blocks: readonly ProtectedBlock[]): number {
  for (const block of blocks) {
    if (cut > block.start && cut < block.end) return block.start;
  }
  return cut;
}
