// Operator draft polish, as an LCEL chain.
//
// Same contract as before: no key configured, or an empty draft, returns the
// draft untouched — the operator's own words are always a safe answer.

import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { env } from "../../../config/env.js";
import { recordUsage } from "../../openrouter-usage.service.js";
import { ENHANCE_SYSTEM_PROMPT } from "../prompts.js";
import { createChatModel, generationIdOf, isLlmConfigured } from "../llm/chat-model.js";

// Prefer the dedicated ENHANCE_MODEL when set so we can route polish requests
// to a cheaper/faster model than the main agent uses.
const enhanceModel = () => process.env.ENHANCE_MODEL ?? env.ai.model;

const prompt = ChatPromptTemplate.fromMessages([
  ["system", ENHANCE_SYSTEM_PROMPT],
  ["human", "{userContent}"],
]);

export async function enhanceDraft(args: {
  draft: string;
  customerLastMessage?: string;
  // Org/conversation for usage metering (operator-side AI spend).
  organizationId?: string;
  conversationId?: string | null;
}): Promise<{ enhanced: string }> {
  const draft = args.draft.trim();
  if (!draft) return { enhanced: "" };
  if (!isLlmConfigured()) return { enhanced: draft };

  const userContent = args.customerLastMessage
    ? `Customer's last message:\n"""${args.customerLastMessage}"""\n\nOperator draft to polish:\n"""${draft}"""`
    : `Operator draft to polish:\n"""${draft}"""`;

  const model = createChatModel({
    model: enhanceModel(),
    temperature: env.ai.enhanceTemperature,
  }).withConfig({ runName: "enhance_draft" });

  // The raw message is kept (rather than piping straight to a string parser) so
  // the generation id survives for usage metering.
  const message = await prompt.pipe(model).invoke({ userContent });
  const enhanced = (await new StringOutputParser().invoke(message)).trim();

  const generationId = generationIdOf(message);
  if (generationId && args.organizationId) {
    void recordUsage({
      feature: "enhance",
      organizationId: args.organizationId,
      conversationId: args.conversationId ?? null,
      model: enhanceModel(),
      generationIds: [generationId],
    }).catch(() => undefined);
  }

  return { enhanced: enhanced || draft };
}
