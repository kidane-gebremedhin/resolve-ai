// Validating the citations a reply actually emitted.
//
// A model told to cite will sometimes cite `[4]` when only three passages were
// provided, or attach no marker at all to a sentence stating a fact. Both are
// invisible without a check: the widget renders whatever it is given, and the
// customer has no way to tell a real citation from an invented one.
//
// So this does two things at finalize time. It DROPS markers that point at
// nothing, because a citation to a non-existent passage is worse than no
// citation — it looks like evidence. And it measures how much of the answer is
// uncited, which becomes a live control on confidence rather than a number
// someone reads in a dashboard later.
import type { ContextCitation } from "./context-block.js";

export type CitationValidation = {
  /** The reply with impossible markers removed. */
  text: string;
  /** Citations actually referenced, in marker order. */
  used: ContextCitation[];
  /** Markers the model emitted that pointed at nothing. */
  invalidMarkers: number[];
  /** Sentences that state a fact and carry no marker. */
  uncitedSentences: string[];
  /** Uncited factual sentences over total factual sentences. */
  uncitedRatio: number;
  factualSentences: number;
};

const MARKER = /\[(\d{1,2})\]/g;

/**
 * Split a reply into sentences.
 *
 * Deliberately crude: this feeds a ratio used as a confidence signal, not a
 * linguistic analysis, and a heavyweight sentence splitter would be a dependency
 * bought for nothing. Markdown list items count as sentences because a list of
 * facts is exactly where citations go missing.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Whether a sentence asserts something checkable.
 *
 * Pleasantries, questions and offers to help carry no factual claim, so
 * requiring a citation on them would make the ratio meaningless — a friendly
 * reply would score as badly as a fabricated one. The test is deliberately
 * conservative: when unsure, treat it as NOT factual, so the ratio understates
 * rather than overstates the problem and never escalates a turn for being
 * polite.
 */
export function isFactualSentence(sentence: string): boolean {
  const s = sentence.trim();
  if (s.length < 15) return false;
  // A question asks rather than asserts.
  if (s.endsWith("?")) return false;
  // Greetings, sign-offs and offers to help.
  if (
    /^(hi|hello|hey|thanks|thank you|sure|of course|happy to|glad to|let me know|is there anything|i'?m here|no problem|you'?re welcome|sorry)\b/i.test(
      s,
    )
  ) {
    return false;
  }
  // "I can help you with that", "I'm happy to", "I'll connect you" — about the
  // interaction, not about the product.
  if (
    /^(i can|i'?ll|i will|i'?d be|i'?m (happy|glad|here|sorry|able)|would you|do you|can you|shall i|let me)\b/i.test(
      s,
    )
  ) {
    return false;
  }
  // An explicit non-answer is the behaviour we WANT on a negative case; making
  // it count against the ratio would punish exactly the right response.
  if (/\b(don'?t have|do not have|couldn'?t find|could not find|no information|not in (our|the) knowledge)\b/i.test(s)) {
    return false;
  }
  return true;
}

export function validateCitations(
  replyText: string,
  available: readonly ContextCitation[],
): CitationValidation {
  const valid = new Set(available.map((c) => c.marker));
  const invalidMarkers: number[] = [];
  const usedMarkers = new Set<number>();

  // Strip markers that point at nothing. Left in place they render as a
  // citation the customer can click and that resolves to nothing, which is a
  // worse failure than an uncited sentence.
  const text = replyText.replace(MARKER, (match, digits: string) => {
    const marker = Number(digits);
    if (valid.has(marker)) {
      usedMarkers.add(marker);
      return match;
    }
    if (!invalidMarkers.includes(marker)) invalidMarkers.push(marker);
    return "";
  });

  const cleaned = text.replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1");

  const sentences = splitSentences(cleaned);
  const factual = sentences.filter(isFactualSentence);
  const uncited = factual.filter((s) => !MARKER.test(s) && !/\[\d{1,2}\]/.test(s));

  return {
    text: cleaned.trim(),
    used: available.filter((c) => usedMarkers.has(c.marker)).sort((a, b) => a.marker - b.marker),
    invalidMarkers,
    uncitedSentences: uncited,
    uncitedRatio: factual.length === 0 ? 0 : uncited.length / factual.length,
    factualSentences: factual.length,
  };
}
