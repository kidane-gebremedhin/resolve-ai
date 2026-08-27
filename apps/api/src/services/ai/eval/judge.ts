// LLM-as-judge: the shared definition of what "faithful" means here.
//
// This lives in the API rather than in `packages/rag-eval` because it now has
// two callers with opposite lifecycles — the offline harness scoring a golden
// set, and the online sampler scoring real production turns (__specs/39). The
// harness already depends on the API for `createChatModel`, so putting the judge
// here is the direction that has no cycle in it. Duplicating the prompt would be
// worse than either: two judges drifting apart would make the online number and
// the offline number silently incomparable, which is the one property this whole
// design is built to keep.
//
// The judge is deliberately given ONLY the retrieved context and the answer. It
// never sees the knowledge base, so it cannot reward an answer for being true;
// it can only score whether the passages support it.

import { createChatModel, contentToText, generationIdOf } from "../llm/chat-model.js";

/** How a judge scored one atomic claim against the retrieved context. */
export type ClaimVerdict = "supported" | "contradicted" | "not_found";

export type ClaimJudgement = {
  claim: string;
  verdict: ClaimVerdict;
  /** The judge's reason, surfaced in the report so a low score is diagnosable. */
  reason?: string;
};

export type JudgeVerdict = {
  claims: ClaimJudgement[];
  answerRelevance: number;
  correctness: number | null;
  contextUsedCount: number;
  contextRequiredCovered: number;
  contextRequiredTotal: number;
  citationsSupported: number;
  citationsTotal: number;
  declined: boolean;
  notes?: string;
};

export type JudgePassage = { id: string; title: string; text: string };

/**
 * Faithfulness: supported claims over total claims. The hallucination metric.
 *
 * `contradicted` and `not_found` both count against it, and they are kept
 * distinct in the report rather than merged: a contradicted claim means the
 * context said otherwise (a retrieval or grounding failure), while not_found
 * means the model produced something the context never mentioned (invention).
 * The fixes are different.
 *
 * An answer with zero claims returns null, not 1.0. "I don't know" makes no
 * factual assertions, so it cannot be unfaithful, and scoring it a perfect 1
 * would let a bot that refuses everything top the faithfulness table.
 */
export function faithfulness(claims: readonly ClaimJudgement[]): number | null {
  if (claims.length === 0) return null;
  const supported = claims.filter((c) => c.verdict === "supported").length;
  return supported / claims.length;
}

/**
 * The judge prompt's version, folded into the offline cache key.
 *
 * Bump it whenever `JUDGE_SYSTEM` changes: a verdict produced by an older prompt
 * is not interchangeable with one produced by a newer one, and a cache that does
 * not know that will quietly average two different metrics together.
 */
export const JUDGE_PROMPT_VERSION = "v1";

/**
 * Output ceiling for a judge call.
 *
 * A verdict is a small JSON object — a handful of atomic claims and eight
 * numbers — so this is generous by an order of magnitude. It is set at all
 * because OpenRouter reserves the full max_tokens against the account balance
 * before the call runs, and a judge model whose default ceiling is 64k tokens
 * returns a 402 on a low balance for a response that would have cost cents.
 */
export const JUDGE_MAX_OUTPUT_TOKENS = 4000;

export const JUDGE_SYSTEM = `You are a strict evaluator of a retrieval-augmented support assistant.
You judge ONLY against the numbered context passages you are given. You do not
use outside knowledge, and you never reward an answer for being plausible.

Return a single JSON object, no prose, no markdown fence, with these keys:
{
  "claims": [{"claim": "<one atomic factual assertion from the answer>",
              "verdict": "supported" | "contradicted" | "not_found",
              "reason": "<short>"}],
  "answerRelevance": <0..1, does the answer address the question asked>,
  "correctness": <0..1 against the reference answer, or null if no reference given>,
  "contextUsedCount": <how many of the numbered passages the answer actually needed>,
  "contextRequiredCovered": <how many facts the reference answer needs that ARE present in the passages>,
  "contextRequiredTotal": <how many facts the reference answer needs in total>,
  "citationsSupported": <citations in the answer that point at a passage supporting the sentence>,
  "citationsTotal": <citations present in the answer>,
  "declined": <true if the answer declines to answer / says it does not know>,
  "notes": "<optional>"
}

Rules that decide the hard cases:
- Decompose the answer into ATOMIC claims. "The Team plan is $99/month and
  includes 15 seats" is two claims, not one.
- "supported" means a passage states it. "contradicted" means a passage says
  otherwise. "not_found" means no passage speaks to it. Pleasantries, offers to
  help further, and questions back to the customer are NOT claims: omit them.
- An answer that correctly declines has zero claims. Do not invent one.
- Judge correctness against the reference answer's SUBSTANCE, not its wording.`;

export function buildJudgeUserPrompt(args: {
  question: string;
  answer: string;
  referenceAnswer: string;
  passages: readonly JudgePassage[];
}): string {
  const ctx = args.passages.length
    ? args.passages.map((p, i) => `[${i + 1}] (${p.title}) ${p.text}`).join("\n\n")
    : "(no passages were retrieved)";
  return [
    `QUESTION:\n${args.question}`,
    `REFERENCE ANSWER:\n${args.referenceAnswer || "(none provided)"}`,
    `CONTEXT PASSAGES:\n${ctx}`,
    `ANSWER UNDER TEST:\n${args.answer}`,
  ].join("\n\n---\n\n");
}

/** Strip a ```json fence if the model adds one despite being told not to. */
export function parseJudgeVerdict(raw: string): JudgeVerdict {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`judge returned no JSON object: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<JudgeVerdict>;
  return {
    claims: Array.isArray(parsed.claims) ? parsed.claims : [],
    answerRelevance: typeof parsed.answerRelevance === "number" ? parsed.answerRelevance : 0,
    correctness: typeof parsed.correctness === "number" ? parsed.correctness : null,
    contextUsedCount: Number(parsed.contextUsedCount ?? 0),
    contextRequiredCovered: Number(parsed.contextRequiredCovered ?? 0),
    contextRequiredTotal: Number(parsed.contextRequiredTotal ?? 0),
    citationsSupported: Number(parsed.citationsSupported ?? 0),
    citationsTotal: Number(parsed.citationsTotal ?? 0),
    declined: Boolean(parsed.declined),
    notes: typeof parsed.notes === "string" ? parsed.notes : undefined,
  };
}

/**
 * One judge call. No caching: the offline harness wraps this in its disk cache
 * (a rerun re-scores an unchanged answer for free), and the online sampler has
 * nothing to cache because every production answer is new.
 */
export async function runJudge(args: {
  model: string;
  question: string;
  answer: string;
  referenceAnswer?: string;
  passages: readonly JudgePassage[];
}): Promise<{ verdict: JudgeVerdict; generationId: string | null }> {
  const llm = createChatModel({
    model: args.model,
    temperature: 0,
    maxTokens: JUDGE_MAX_OUTPUT_TOKENS,
  });
  const res = await llm.invoke([
    { role: "system", content: JUDGE_SYSTEM },
    {
      role: "user",
      content: buildJudgeUserPrompt({
        question: args.question,
        answer: args.answer,
        referenceAnswer: args.referenceAnswer ?? "",
        passages: args.passages,
      }),
    },
  ]);
  return { verdict: parseJudgeVerdict(contentToText(res.content)), generationId: generationIdOf(res) };
}
