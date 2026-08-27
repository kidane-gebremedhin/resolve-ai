// Three reply suggestions an operator might send next, as an LCEL chain.
//
// Every failure path returns the deterministic fallbacks: an operator staring at
// an empty suggestion bar is worse than three generic-but-sane options, so this
// never surfaces an error.

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { Conversation, Message } from "../../../models/index.js";
import { logger } from "../../../config/logger.js";
import { env } from "../../../config/env.js";
import { recordUsage } from "../../openrouter-usage.service.js";
import { createChatModel, generationIdOf, isLlmConfigured } from "../llm/chat-model.js";

const MAX_LEN = 200;

const FALLBACKS = [
  "Could you tell me more?",
  "Let me look into that for you.",
  "I'll connect you with a specialist.",
] as const;

function clampSuggestions(input: string[]): string[] {
  const cleaned = input
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0)
    .map((s) => (s.length > MAX_LEN ? s.slice(0, MAX_LEN) : s));
  // Pad with fallbacks if the model returned fewer than 3.
  while (cleaned.length < 3) cleaned.push(FALLBACKS[cleaned.length] ?? FALLBACKS[2]);
  return cleaned.slice(0, 3);
}

const SuggestionsSchema = z.object({
  suggestions: z.array(z.string()).describe("Exactly three suggested operator replies."),
});

const SYSTEM_PROMPT = `You help a human customer-support operator decide what to say next.
Given the last few messages in a conversation, produce EXACTLY 3 short reply
suggestions the operator could send to the customer.

Rules:
- Each suggestion is one or two short sentences, under 200 characters.
- Match a friendly but professional tone.
- Never promise refunds, discounts, account changes, or anything that requires
  human authority.
- Suggestions must be distinct: one warm acknowledgement, one asking for more
  detail, one offering a concrete next step (escalation / hand-off / action).`;

const prompt = ChatPromptTemplate.fromMessages([
  ["system", SYSTEM_PROMPT],
  [
    "human",
    "Conversation status: {status}\n\nRecent messages:\n{transcript}\n\nReturn 3 suggested replies the operator could send next.",
  ],
]);

const speakerOf = (role: string): string =>
  role === "customer" ? "Customer" : role === "ai" ? "AI" : role === "operator" ? "Operator" : "System";

export async function generateSuggestions(args: {
  conversationId: string;
  organizationId: string;
}): Promise<string[]> {
  const conversation = await Conversation.findOne({
    _id: args.conversationId,
    organizationId: args.organizationId,
  });
  if (!conversation) return clampSuggestions([...FALLBACKS]);

  const history = await Message.find({ conversationId: conversation._id })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  // Re-order oldest-first for natural reading.
  history.reverse();
  const transcript = history.map((m) => `${speakerOf(m.role)}: ${m.content}`).join("\n");

  // No API key — return deterministic fallbacks. Operators see something
  // sensible even when the LLM is offline.
  if (!isLlmConfigured()) return clampSuggestions([...FALLBACKS]);

  const model = env.ai.model;
  try {
    const structured = createChatModel({ model, temperature: env.ai.suggestionsTemperature })
      .withStructuredOutput(SuggestionsSchema, {
        name: "reply_suggestions",
        method: "jsonSchema",
        includeRaw: true,
      })
      .withConfig({ runName: "reply_suggestions" });

    const { raw, parsed } = (await prompt.pipe(structured).invoke({
      status: conversation.status,
      transcript: transcript || "(no messages yet)",
    })) as { raw: { id?: string }; parsed: z.infer<typeof SuggestionsSchema> | null };

    const generationId = generationIdOf(raw as never);
    if (generationId) {
      void recordUsage({
        feature: "suggestions",
        organizationId: args.organizationId,
        conversationId: conversation._id,
        websiteId: conversation.websiteId ?? null,
        model,
        generationIds: [generationId],
      }).catch(() => undefined);
    }

    return clampSuggestions(parsed?.suggestions ?? []);
  } catch (err) {
    logger.warn("[suggestions] llm call failed", { err: (err as Error).message });
    return clampSuggestions([...FALLBACKS]);
  }
}
