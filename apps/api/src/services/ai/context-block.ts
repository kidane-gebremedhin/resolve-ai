// Assembling the numbered context block the model answers from.
//
// Until this existed, retrieved passages reached the model only as a tool
// result: a JSON blob of `{source, text, score}` with no markers, no stable
// identity, and one line of prompt telling the model to "ground every factual
// claim in the knowledge base". There was nothing to cite, so nothing cited.
//
// Everything here is MECHANICAL. It deduplicates, it reorders, it drops whole
// passages when the budget is exceeded. It never rewrites, summarises, trims or
// otherwise edits the words inside a passage — the moment context assembly can
// edit text, a citation stops being a pointer at evidence and becomes a pointer
// at our paraphrase of evidence. `assertVerbatim` exists to make that
// structural rather than a promise.
import type { KbHit } from "../kb/search.service.js";
import { env } from "../../config/env.js";

export type ContextCitation = {
  /** The integer shown in the text, 1-based, stable within a turn. */
  marker: number;
  sourceId: string;
  sourceTitle: string;
  chunkId?: string;
  headingPath?: string[];
  url?: string;
  score: number;
};

export type ContextBlock = {
  /** Rendered block, or empty string when there is no evidence. */
  text: string;
  citations: ContextCitation[];
  /** Passages dropped for the token budget, lowest-scoring first. */
  dropped: { chunkId?: string; sourceTitle: string; score: number }[];
  /** Duplicates collapsed before rendering. */
  deduped: number;
  estimatedTokens: number;
};

/** The same 4-chars-per-token estimate the chunker uses. Rough, and stated as rough. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function normaliseForComparison(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Collapse passages carrying the same content.
 *
 * Chunks overlap by design and re-crawled pages repeat themselves, so the same
 * sentences can occupy three of five slots — the model then sees one fact three
 * times and the other two not at all. Identity is by chunk id first (the same
 * chunk retrieved by both legs) and by normalised text second (genuinely
 * different chunks that happen to hold the same content).
 *
 * The highest-scoring copy wins, so the surviving citation points at the passage
 * retrieval actually ranked.
 */
export function dedupePassages(hits: readonly KbHit[]): { kept: KbHit[]; removed: number } {
  const byKey = new Map<string, KbHit>();

  for (const hit of hits) {
    const key = hit.chunkId ?? `text:${normaliseForComparison(hit.text)}`;
    const existing = byKey.get(key);
    if (!existing || hit.score > existing.score) byKey.set(key, hit);
  }

  // A second pass on text, because two different chunk ids can still carry the
  // same content after a re-crawl.
  const byText = new Map<string, KbHit>();
  for (const hit of byKey.values()) {
    const key = normaliseForComparison(hit.text);
    const existing = byText.get(key);
    if (!existing || hit.score > existing.score) byText.set(key, hit);
  }

  const kept = [...byText.values()].sort((a, b) => b.score - a.score);
  return { kept, removed: hits.length - kept.length };
}

/**
 * Place the strongest passages at the START and the END of the block.
 *
 * Attention degrades in the middle of a long context — a passage buried at
 * position 4 of 7 is measurably less likely to be used than the same passage at
 * position 1 or 7. Given passages sorted by score, this alternates placing them
 * at the front and the back, so rank 1 leads, rank 2 closes, and the weakest
 * end up in the middle where the least is lost.
 */
export function orderForAttention<T>(sorted: readonly T[]): T[] {
  const front: T[] = [];
  const back: T[] = [];
  sorted.forEach((item, i) => (i % 2 === 0 ? front.push(item) : back.unshift(item)));
  return [...front, ...back];
}

/**
 * Drop whole passages, lowest-scoring first, until the budget is met.
 *
 * Never truncates mid-passage. A half-passage is a citation that no longer
 * supports the sentence attached to it, which is worse than not having the
 * passage at all: the model reads a fragment as though it were the whole story.
 */
export function applyTokenBudget(
  sorted: readonly KbHit[],
  budgetTokens: number,
): { kept: KbHit[]; dropped: KbHit[] } {
  if (budgetTokens <= 0) return { kept: [...sorted], dropped: [] };

  const kept: KbHit[] = [];
  let used = 0;
  for (const hit of sorted) {
    const cost = estimateTokens(hit.text) + 24; // marker, title, heading path, URL
    // Always keep at least one passage: an empty block for a question that DID
    // retrieve evidence would read as "no evidence" and trigger a refusal.
    if (kept.length > 0 && used + cost > budgetTokens) break;
    kept.push(hit);
    used += cost;
  }
  return { kept, dropped: sorted.slice(kept.length) };
}

function renderHeading(hit: KbHit): string {
  const path = hit.headingPath?.filter(Boolean) ?? [];
  return path.length > 0 ? path.join(" > ") : hit.sourceTitle;
}

/**
 * Build the numbered block.
 *
 * Markers are assigned by DISPLAY position, so `[1]` is always the first passage
 * the model reads. Assigning them by score instead would put `[3]` before `[1]`
 * on the page, and a model asked to cite `[1]` would reach for whatever it saw
 * first.
 */
export function buildContextBlock(
  hits: readonly KbHit[],
  opts: { budgetTokens?: number } = {},
): ContextBlock {
  if (hits.length === 0) {
    return { text: "", citations: [], dropped: [], deduped: 0, estimatedTokens: 0 };
  }

  const { kept: unique, removed: deduped } = dedupePassages(hits);
  const budget = opts.budgetTokens ?? env.ai.contextTokenBudget;
  const { kept, dropped } = applyTokenBudget(unique, budget);
  const ordered = orderForAttention(kept);

  const lines: string[] = [];
  const citations: ContextCitation[] = [];

  ordered.forEach((hit, i) => {
    const marker = i + 1;
    const heading = renderHeading(hit);
    const location = hit.url ? `${heading} — ${hit.url}` : heading;
    // The passage text is inserted VERBATIM. Nothing between the store and here
    // may alter it.
    lines.push(`[${marker}] ${location}\n${hit.text}`);
    citations.push({
      marker,
      sourceId: hit.sourceId,
      sourceTitle: hit.sourceTitle,
      ...(hit.chunkId ? { chunkId: hit.chunkId } : {}),
      ...(hit.headingPath?.length ? { headingPath: hit.headingPath } : {}),
      ...(hit.url ? { url: hit.url } : {}),
      score: hit.score,
    });
  });

  const text = lines.join("\n\n");
  return {
    text,
    citations,
    dropped: dropped.map((d) => ({
      ...(d.chunkId ? { chunkId: d.chunkId } : {}),
      sourceTitle: d.sourceTitle,
      score: d.score,
    })),
    deduped,
    estimatedTokens: estimateTokens(text),
  };
}

/**
 * Assert every rendered passage appears verbatim in the block.
 *
 * This is a guard against a future change that adds a "harmless" trim,
 * normalisation or summarisation step. Once assembly can edit text, every
 * citation in the product is pointing at something the customer cannot verify,
 * and nothing else in the system would notice.
 */
export function assertVerbatim(block: ContextBlock, hits: readonly KbHit[]): void {
  const byMarker = new Map(block.citations.map((c) => [c.marker, c]));
  for (const [marker, citation] of byMarker) {
    const source = hits.find((h) =>
      citation.chunkId ? h.chunkId === citation.chunkId : h.sourceId === citation.sourceId,
    );
    if (!source) continue;
    if (!block.text.includes(source.text)) {
      throw new Error(
        `context block altered passage [${marker}] (${citation.sourceTitle}); citations would no longer point at real evidence`,
      );
    }
  }
}
