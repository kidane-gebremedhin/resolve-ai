import { ENHANCE_SYSTEM_PROMPT } from "./prompts.js";
import { env } from "../../config/env.js";
import { recordUsage } from "../openrouter-usage.service.js";

const OPENROUTER_URL =
  process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
// Prefer the dedicated ENHANCE_MODEL when set so we can route polish requests
// to a cheaper/faster model than the main agent uses.
const ENHANCE_MODEL = process.env.ENHANCE_MODEL ?? env.ai.model;

export async function enhanceDraft(args: {
  draft: string;
  customerLastMessage?: string;
  // Org/conversation for usage metering (operator-side AI spend).
  organizationId?: string;
  conversationId?: string | null;
}): Promise<{ enhanced: string }> {
  const draft = args.draft.trim();
  if (!draft) return { enhanced: "" };
  if (!process.env.OPENROUTER_API_KEY) {
    return { enhanced: draft };
  }

  const userContent = args.customerLastMessage
    ? `Customer's last message:\n"""${args.customerLastMessage}"""\n\nOperator draft to polish:\n"""${draft}"""`
    : `Operator draft to polish:\n"""${draft}"""`;

  const res = await fetch(`${OPENROUTER_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: ENHANCE_MODEL,
      temperature: env.ai.enhanceTemperature,
      messages: [
        { role: "system", content: ENHANCE_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Enhance LLM ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    id?: string;
  };
  // Meter the tokens this polish call spent, attributed to the operator's org.
  if (body.id && args.organizationId) {
    void recordUsage({
      feature: "enhance",
      organizationId: args.organizationId,
      conversationId: args.conversationId ?? null,
      model: ENHANCE_MODEL,
      generationIds: [body.id],
    }).catch(() => undefined);
  }
  const enhanced = body.choices?.[0]?.message?.content?.trim() ?? draft;
  return { enhanced };
}
