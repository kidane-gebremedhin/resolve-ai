export type ToolCall = {
  id: string;
  name: "search_kb" | "escalate_conversation" | "resolve_conversation";
  arguments: Record<string, unknown>;
};

export const AGENT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_kb",
      description:
        "Search the organization's knowledge base for relevant passages. Use this before answering any question whose answer is not obviously in the conversation history.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "A focused search query (3-12 words). Rephrase the customer's question to extract the core information need.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "escalate_conversation",
      description:
        "Transfer the conversation to a human operator. Use this when (a) the customer explicitly asks for a human, (b) the customer is angry/frustrated, (c) you cannot help confidently after a KB search, or (d) the issue requires account access or payment changes.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "One-sentence reason for the handoff, written for the operator.",
          },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "resolve_conversation",
      description:
        "Mark the conversation as resolved. Use ONLY when the customer has confirmed their issue is fixed or thanks you in a way that clearly ends the exchange.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "One-sentence summary of how the issue was resolved.",
          },
        },
        required: ["summary"],
        additionalProperties: false,
      },
    },
  },
];

// Tool list for a conversation, gated by org settings. When human escalation is
// disabled, the escalate_conversation tool is removed entirely so the model
// cannot signal a handoff.
export function buildAgentTools(opts: { allowEscalation: boolean }) {
  return AGENT_TOOLS.filter(
    (t) => opts.allowEscalation || t.function.name !== "escalate_conversation",
  );
}

export const FINAL_REPLY_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "agent_reply",
    strict: true,
    schema: {
      type: "object",
      properties: {
        reply: {
          type: "string",
          description: "The message text to send to the customer.",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description:
            "Your honest confidence (0.0-1.0) that this reply correctly addresses the customer's need. Be conservative. A low score does NOT mean escalate — when unsure, reply and ask the customer if they want a human operator.",
        },
        action: {
          type: "string",
          enum: ["reply", "escalate", "resolve"],
          description:
            "What should happen after this turn. 'reply' = continue chatting. 'escalate' = hand off to a human. 'resolve' = mark conversation closed.",
        },
      },
      required: ["reply", "confidence", "action"],
      additionalProperties: false,
    },
  },
};
