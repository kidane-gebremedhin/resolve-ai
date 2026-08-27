// Issue-scoped ticket transcript, as an LCEL chain.
//
// A support chat wanders — greetings, unrelated questions, resolved side-topics —
// and the operator opening the ticket only needs the messages that are actually
// part of the reported issue. The model SELECTS line numbers to keep; it never
// rewrites the customer's words. Anything goes wrong → fall back to the trailing
// window (the exchange right before the ticket), never the full dump.

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { recordUsage } from "../../openrouter-usage.service.js";
import { createChatModel, generationIdOf, isLlmConfigured } from "../llm/chat-model.js";

// Reuse the cheaper enhance model when configured — this is a short extraction pass.
const transcriptModel = () => process.env.ENHANCE_MODEL ?? env.ai.model;

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

const KeepSchema = z.object({
  keep: z
    .array(z.number().int())
    .describe("The line numbers to keep, in ascending order, e.g. [3,4,5,6]."),
});

const SYSTEM_PROMPT =
  "You scope a customer-support conversation down to only the messages that belong to " +
  "the specific issue that triggered a support ticket. Keep every message that describes, " +
  "diagnoses, reproduces, or responds to that issue (from either side). DROP greetings, " +
  "small talk, thank-yous, and any exchange about a DIFFERENT, unrelated topic that was " +
  "already handled. If unsure whether a line belongs, keep it. Never invent line numbers.";

const prompt = ChatPromptTemplate.fromMessages([
  ["system", SYSTEM_PROMPT],
  ["human", "{issueBlock}Conversation (numbered):\n{numbered}"],
]);

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
  if (lines.length <= 4 || !isLlmConfigured()) {
    return render(lines.slice(-FALLBACK_TAIL_LINES));
  }

  const model = transcriptModel();
  try {
    const structured = createChatModel({ model, temperature: 0 })
      .withStructuredOutput(KeepSchema, {
        name: "kept_lines",
        method: "jsonSchema",
        includeRaw: true,
      })
      .withConfig({ runName: "ticket_transcript_scope" });

    const { raw, parsed } = (await prompt.pipe(structured).invoke({
      issueBlock: issueSummary?.trim()
        ? `The ticket is about this issue:\n"""${issueSummary.trim()}"""\n\n`
        : "",
      numbered: lines.map((l, i) => `${i + 1}. [${l.who}] ${l.text}`).join("\n"),
    })) as { raw: { id?: string }; parsed: z.infer<typeof KeepSchema> | null };

    const generationId = generationIdOf(raw as never);
    if (generationId && args.organizationId) {
      void recordUsage({
        feature: "ticket_summary",
        organizationId: args.organizationId,
        conversationId: args.conversationId ?? null,
        model,
        generationIds: [generationId],
      }).catch(() => undefined);
    }

    const indices = (parsed?.keep ?? []).filter(
      (n) => Number.isInteger(n) && n >= 1 && n <= lines.length,
    );
    const unique = [...new Set(indices)].sort((a, b) => a - b);
    // If the model kept nothing, fall through to the tail heuristic rather than
    // emit an empty attachment.
    if (unique.length === 0) return render(lines.slice(-FALLBACK_TAIL_LINES));
    return render(unique.map((n) => lines[n - 1]!));
  } catch (err) {
    logger.warn("[ticket-transcript] issue-scoping failed, using tail window", {
      err: (err as Error).message,
    });
    return render(lines.slice(-FALLBACK_TAIL_LINES));
  }
}
