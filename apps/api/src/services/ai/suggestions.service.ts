// Generates 3 short reply suggestions an operator might send next in a
// conversation. Mirrors the LLM-call shape used by agent.service.ts: when
// OPENROUTER_API_KEY is unset (dev / tests) we fall back to deterministic
// suggestions so the endpoint always returns three strings.

import { Conversation, Message } from "../../models/index.js";
import { logger } from "../../config/logger.js";
import { env } from "../../config/env.js";

const OPENROUTER_URL =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const MAX_LEN = 200;

type LlmChoice = {
  message?: { role?: string; content?: string | null };
  finish_reason?: string;
};
type LlmResponse = { choices?: LlmChoice[] };

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
  // Pad with fallbacks if model returned fewer than 3.
  while (cleaned.length < 3) cleaned.push(FALLBACKS[cleaned.length] ?? FALLBACKS[2]);
  return cleaned.slice(0, 3);
}

const SUGGESTIONS_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "reply_suggestions",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        suggestions: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: { type: "string" },
        },
      },
      required: ["suggestions"],
    },
  },
} as const;

const SYSTEM_PROMPT = `You help a human customer-support operator decide what to say next.
Given the last few messages in a conversation, produce EXACTLY 3 short reply
suggestions the operator could send to the customer.

Rules:
- Each suggestion is one or two short sentences, under 200 characters.
- Match a friendly but professional tone.
- Never promise refunds, discounts, account changes, or anything that requires
  human authority.
- Suggestions must be distinct: one warm acknowledgement, one asking for more
  detail, one offering a concrete next step (escalation / hand-off / action).
- Output ONLY a JSON object matching the reply_suggestions schema.`;

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

  // Build a compact transcript for the model.
  const transcript = history
    .map((m) => {
      const speaker =
        m.role === "customer"
          ? "Customer"
          : m.role === "ai"
            ? "AI"
            : m.role === "operator"
              ? "Operator"
              : "System";
      return `${speaker}: ${m.content}`;
    })
    .join("\n");

  // No API key — return deterministic fallbacks. Operators see something
  // sensible even when the LLM is offline.
  if (!process.env.OPENROUTER_API_KEY) {
    return clampSuggestions([...FALLBACKS]);
  }

  const model = env.ai.model;

  try {
    const res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: env.ai.suggestionsTemperature,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Conversation status: ${conversation.status}\n\nRecent messages:\n${transcript || "(no messages yet)"}\n\nReturn 3 suggested replies the operator could send next.`,
          },
        ],
        response_format: SUGGESTIONS_SCHEMA,
      }),
    });
    if (!res.ok) {
      logger.warn("[suggestions] openrouter non-2xx", { status: res.status });
      return clampSuggestions([...FALLBACKS]);
    }
    const json = (await res.json()) as LlmResponse;
    const content = json.choices?.[0]?.message?.content ?? null;
    if (!content) return clampSuggestions([...FALLBACKS]);

    let parsed: { suggestions?: unknown } = {};
    try {
      parsed = JSON.parse(content) as { suggestions?: unknown };
    } catch {
      return clampSuggestions([...FALLBACKS]);
    }
    const arr = Array.isArray(parsed.suggestions)
      ? (parsed.suggestions.filter((x): x is string => typeof x === "string"))
      : [];
    return clampSuggestions(arr);
  } catch (err) {
    logger.warn("[suggestions] llm call failed", { err: (err as Error).message });
    return clampSuggestions([...FALLBACKS]);
  }
}
