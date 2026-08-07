import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { recordUsage } from "../openrouter-usage.service.js";

const OPENROUTER_URL =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
// Reuse the cheaper enhance model when configured — this is a short extraction pass.
const TRANSCRIPT_MODEL = process.env.ENHANCE_MODEL ?? env.ai.model;

// Cap the number of trailing lines used when we can't run the LLM filter, so a
// failed/absent model still yields an issue-scoped-ish excerpt (the exchange that
// led to the ticket) rather than the whole history.
const FALLBACK_TAIL_LINES = 20;

export interface TranscriptLine {
  /** "Customer" | "Assistant" | "Operator" */
  who: string;
  /** ISO timestamp */
  ts: string;
  /** PII-masked message text */
  text: string;
}

function render(lines: TranscriptLine[]): string {
  return lines.map((l) => `[${l.ts}] ${l.who}: ${l.text}`).join("\n");
}

// Build a transcript scoped to the issue that triggered the ticket. A support chat
// often wanders — greetings, unrelated questions, resolved side-topics — and the
// operator only needs the messages that are actually part of the reported issue.
// We ask the model to SELECT the relevant line numbers (it never rewrites the
// customer's words), then reconstruct the transcript from the original masked lines.
// Anything goes wrong → fall back to the trailing window (the exchange right before
// the ticket), never the full dump.
export async function buildIssueScopedTranscript(args: {
  lines: TranscriptLine[];
  issueSummary?: string;
  // Org/conversation for usage metering (support-ticket AI spend).
  organizationId?: string;
  conversationId?: string | null;
}): Promise<string> {
  const { lines, issueSummary } = args;
  if (lines.length === 0) return "";
  // Nothing to prune (or no way to call the model) — a short chat is already scoped.
  if (lines.length <= 4 || !process.env.OPENROUTER_API_KEY) {
    return render(lines.slice(-FALLBACK_TAIL_LINES));
  }

  const numbered = lines
    .map((l, i) => `${i + 1}. [${l.who}] ${l.text}`)
    .join("\n");
  const system =
    "You scope a customer-support conversation down to only the messages that belong to " +
    "the specific issue that triggered a support ticket. Keep every message that describes, " +
    "diagnoses, reproduces, or responds to that issue (from either side). DROP greetings, " +
    "small talk, thank-yous, and any exchange about a DIFFERENT, unrelated topic that was " +
    "already handled. Respond with ONLY a JSON array of the line numbers to KEEP, in order, " +
    'e.g. [3,4,5,6]. If unsure whether a line belongs, keep it. Never invent line numbers.';
  const user =
    (issueSummary?.trim()
      ? `The ticket is about this issue:\n"""${issueSummary.trim()}"""\n\n`
      : "") + `Conversation (numbered):\n${numbered}`;

  try {
    const res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: TRANSCRIPT_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`transcript LLM ${res.status}`);
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      id?: string;
    };
    // Meter the tokens this issue-scoping call spent, attributed to the org.
    if (body.id && args.organizationId) {
      void recordUsage({
        feature: "ticket_summary",
        organizationId: args.organizationId,
        conversationId: args.conversationId ?? null,
        model: TRANSCRIPT_MODEL,
        generationIds: [body.id],
      }).catch(() => undefined);
    }
    const raw = body.choices?.[0]?.message?.content ?? "";
    // The model may wrap the array in prose or a code fence — extract the array.
    const match = raw.match(/\[[\s\S]*?\]/);
    if (!match) throw new Error("no array in response");
    const keep = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(keep)) throw new Error("not an array");
    const indices = keep
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= lines.length);
    const unique = [...new Set(indices)].sort((a, b) => a - b);
    // If the model kept nothing (or effectively everything), fall through to the tail
    // heuristic rather than emit an empty or unfiltered attachment.
    if (unique.length === 0) return render(lines.slice(-FALLBACK_TAIL_LINES));
    return render(unique.map((n) => lines[n - 1]!));
  } catch (err) {
    logger.warn("[ticket-transcript] issue-scoping failed, using tail window", {
      err: (err as Error).message,
    });
    return render(lines.slice(-FALLBACK_TAIL_LINES));
  }
}
