export type ToolCall = {
  id: string;
  name: "search_kb" | "escalate_conversation" | "resolve_conversation" | "request_form";
  arguments: Record<string, unknown>;
};

// Lets the AI render an inline form in the widget to collect the exact inputs an
// integration/webhook tool needs (order #, reason, …) as ONE structured payload,
// instead of asking for each field in chat. Only offered when the agent actually
// has integration tools (appended in agent.service). On submit, the widget posts
// the payload back and the tool runs automatically.
export const REQUEST_FORM_TOOL = {
  type: "function" as const,
  function: {
    name: "request_form",
    description:
      "Show the customer an inline form to collect the inputs an integration/webhook tool needs (e.g. order number, reason). Prefer this over asking for several fields in chat. After the customer submits, the tool runs automatically. Pass the exact `toolKey` of the tool whose inputs you need.",
    parameters: {
      type: "object",
      properties: {
        toolKey: { type: "string", description: "The integration tool to collect inputs for, e.g. lookup_order." },
        title: { type: "string", description: "Optional short heading shown above the form." },
      },
      required: ["toolKey"],
      additionalProperties: false,
    },
  },
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

// Schema for the lightweight meta-pass that runs concurrently with streaming.
// Separate from FINAL_REPLY_SCHEMA so we can include quickReplies without
// polluting the main agent_reply schema (which would require the streaming
// final call to output them too, breaking streaming prose).
export const META_PASS_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "meta_pass",
    strict: true,
    schema: {
      type: "object",
      properties: {
        confidence: {
          type: "number",
          description: "Confidence 0.0-1.0 that the reply correctly addresses the customer's need.",
        },
        action: {
          type: "string",
          enum: ["reply", "escalate", "resolve"],
          description: "What should happen after this turn.",
        },
        quickReplies: {
          anyOf: [
            {
              type: "array",
              items: { type: "string" },
              description: "Up to 3 short follow-up chip labels the customer would likely tap next.",
            },
            { type: "null" },
          ],
          description: "Predicted follow-up chips (up to 3), or null if not applicable.",
        },
      },
      required: ["confidence", "action", "quickReplies"],
      additionalProperties: false,
    },
  },
};
