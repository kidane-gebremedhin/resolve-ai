// Graph tests: does the agent↔tools↔finalize loop route the way it must?
//
// The chat model is replaced with a scripted stub, so these assert control flow
// and state accumulation — the parts a provider outage or a model's mood should
// never change.

import { AIMessage, AIMessageChunk, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- scripted chat model -----------------------------------------------------

/** AIMessages the agent node returns, in order. Falls back to a plain answer. */
let agentScript: AIMessage[] = [];
let agentCalls = 0;
let agentShouldThrow = false;
let finalTokens: string[] = [];
let metaResult: { confidence: number; action: string; quickReplies: string[] | null } = {
  confidence: 0.9,
  action: "reply",
  quickReplies: null,
};

vi.mock("../services/ai/llm/chat-model.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/ai/llm/chat-model.js")>();
  // Mirrors the real call chain exactly: `bindTools` and `withStructuredOutput`
  // exist on the MODEL, and `withConfig` returns a binding that has neither.
  // Keeping that shape here is what would catch a call site that configures the
  // model before binding its tools.
  const binding = {
    invoke: async () => {
      if (agentShouldThrow) throw new Error("upstream exploded");
      const scripted = agentScript[agentCalls];
      agentCalls += 1;
      return scripted ?? new AIMessage("All set.");
    },
    stream: async function* () {
      for (const token of finalTokens) yield new AIMessageChunk({ content: token });
    },
  };
  const structuredBinding = {
    invoke: async () => ({ raw: new AIMessage(""), parsed: metaResult }),
  };
  const stub = {
    bindTools: () => ({ withConfig: () => binding }),
    withConfig: () => binding,
    withStructuredOutput: () => ({ withConfig: () => structuredBinding }),
  };
  return { ...actual, createChatModel: () => stub, isLlmConfigured: () => true };
});

// Static imports are safe here: Vitest hoists `vi.mock` above them, so the graph
// is built against the stubbed chat model.
import { getReplyGraph } from "../services/ai/graph/agent.graph.js";
import { TURN_CONTEXT_KEY, type TurnContext } from "../services/ai/graph/context.js";
import type { ToolArtifact, ToolRegistry } from "../services/ai/tools/types.js";

// --- fixtures ----------------------------------------------------------------

const ORDER_SCHEMA = {
  type: "object",
  properties: { orderId: { type: "string" } },
  required: ["orderId"],
} as const;

let toolRuns: Record<string, unknown>[] = [];

function makeTool(artifact: ToolArtifact = { status: "success" }): StructuredToolInterface {
  return tool(
    async (input): Promise<[string, ToolArtifact]> => {
      toolRuns.push(input as Record<string, unknown>);
      return [JSON.stringify({ status: "shipped" }), artifact];
    },
    {
      name: "lookup_order",
      description: "Look up an order",
      schema: ORDER_SCHEMA,
      responseFormat: "content_and_artifact",
    },
  ) as unknown as StructuredToolInterface;
}

function makeRegistry(t: StructuredToolInterface): ToolRegistry {
  return {
    tools: [t],
    byName: new Map([[t.name, t]]),
    // Empty so the tool node writes no ToolCallLog rows — audit is the
    // dispatcher's job for integration tools, and is tested separately.
    builtinNames: new Set(),
    schemaByKey: new Map<string, unknown>([["lookup_order", ORDER_SCHEMA]]),
    guardrailsByKey: new Map(),
    webhookToolKeys: new Set(),
    activeToolKeys: ["lookup_order"],
    promptTools: [{ key: "lookup_order", description: "Look up an order" }],
  };
}

function makeContext(registry: ToolRegistry, overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    model: "test/model",
    temperature: 0,
    maxToolTurns: 10,
    registry,
    piiRedact: false,
    organizationId: "org-1",
    agentId: "agent-1",
    conversationId: "convo-1",
    contactSessionId: "session-1",
    ...overrides,
  };
}

const run = (ctx: TurnContext, input: Record<string, unknown> = {}) =>
  getReplyGraph().invoke(
    { messages: [], ...input },
    { configurable: { [TURN_CONTEXT_KEY]: ctx } },
  );

const toolCall = (args: Record<string, unknown>, id = "call-1") =>
  new AIMessage({
    content: "",
    tool_calls: [{ name: "lookup_order", args, id, type: "tool_call" }],
  });

beforeEach(() => {
  agentScript = [];
  agentCalls = 0;
  agentShouldThrow = false;
  toolRuns = [];
  finalTokens = ["Your order ", "has shipped."];
  metaResult = { confidence: 0.9, action: "reply", quickReplies: null };
});

// --- tests -------------------------------------------------------------------

describe("customer reply graph", () => {
  it("answers without touching a tool when the model doesn't ask for one", async () => {
    const state = await run(makeContext(makeRegistry(makeTool())));

    expect(toolRuns).toHaveLength(0);
    expect(agentCalls).toBe(1);
    expect(state.replyText).toBe("Your order has shipped.");
    expect(state.confidence).toBe(0.9);
    expect(state.action).toBe("reply");
  });

  it("runs the requested tool, loops back to the agent, then finalizes", async () => {
    agentScript = [toolCall({ orderId: "A-1001" })];
    const state = await run(makeContext(makeRegistry(makeTool())));

    expect(toolRuns).toEqual([{ orderId: "A-1001" }]);
    // Called twice: once to request the tool, once after seeing its result.
    expect(agentCalls).toBe(2);
    expect(state.toolCallLog).toEqual([
      { name: "lookup_order", args: { orderId: "A-1001" }, result: '{"status":"shipped"}' },
    ]);
    expect(state.messages.some((m) => m instanceof ToolMessage)).toBe(true);
    expect(state.replyText).toBe("Your order has shipped.");
  });

  it("collects missing inputs with a form instead of dispatching a guess", async () => {
    agentScript = [toolCall({})];
    const state = await run(makeContext(makeRegistry(makeTool())));

    // The tool never ran, and the turn stopped to wait for the customer.
    expect(toolRuns).toHaveLength(0);
    expect(agentCalls).toBe(1);
    expect(state.halt).toBe(true);
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]).toMatchObject({ type: "form", toolKey: "lookup_order" });
  });

  it("stops looping once a tool hands control back to the customer", async () => {
    agentScript = [toolCall({ orderId: "A-1001" })];
    const haltingTool = makeTool({
      halt: true,
      status: "success",
      blocks: [{ type: "otp", otpToken: "tok", toolKey: "lookup_order", args: {}, message: "code?" }],
    });
    const state = await run(makeContext(makeRegistry(haltingTool)));

    expect(toolRuns).toHaveLength(1);
    // No second agent turn — it would let the model claim an action that has
    // not happened yet.
    expect(agentCalls).toBe(1);
    expect(state.blocks[0]).toMatchObject({ type: "otp" });
    expect(state.replyText).toBe("Your order has shipped.");
  });

  it("carries a tool's KB hits through to the turn's citations", async () => {
    agentScript = [toolCall({ orderId: "A-1001" })];
    const citingTool = makeTool({
      status: "success",
      kbHits: [
        { sourceId: "s1", sourceTitle: "Shipping FAQ", chunkIndex: 0, text: "…", score: 0.82 },
      ],
    });
    const state = await run(makeContext(makeRegistry(citingTool)));

    expect(state.kbHits).toHaveLength(1);
    expect(state.kbHits[0]).toMatchObject({ sourceTitle: "Shipping FAQ", score: 0.82 });
  });

  it("reports an unknown tool back to the model rather than crashing the turn", async () => {
    agentScript = [
      new AIMessage({
        content: "",
        tool_calls: [{ name: "does_not_exist", args: {}, id: "call-x", type: "tool_call" }],
      }),
    ];
    const state = await run(makeContext(makeRegistry(makeTool())));

    const toolMessages = state.messages.filter((m): m is ToolMessage => m instanceof ToolMessage);
    expect(toolMessages).toHaveLength(1);
    expect(String(toolMessages[0]!.content)).toContain("Unknown tool");
    expect(state.replyText).toBe("Your order has shipped.");
  });

  it("stops at the tool-turn ceiling when the model keeps calling a tool", async () => {
    // Always asks for the tool again, so only the ceiling can end the loop.
    agentScript = Array.from({ length: 10 }, (_, i) => toolCall({ orderId: "A-1001" }, `call-${i}`));
    const state = await run(makeContext(makeRegistry(makeTool()), { maxToolTurns: 3 }));

    // Three agent turns, but only two rounds of tools: the third turn trips the
    // ceiling and routes to finalize before dispatching anything further.
    expect(agentCalls).toBe(3);
    expect(toolRuns).toHaveLength(2);
    // The turn still ends with a reply for the customer.
    expect(state.replyText).toBe("Your order has shipped.");
  });

  it("skips the agent loop entirely when presenting an already-executed tool result", async () => {
    agentScript = [toolCall({ orderId: "A-1001" })];
    const state = await run(
      makeContext(makeRegistry(makeTool()), {
        presentToolResult: { toolKey: "book_meeting", result: { booked: true } },
      }),
    );

    expect(agentCalls).toBe(0);
    expect(toolRuns).toHaveLength(0);
    expect(state.replyText).toBe("Your order has shipped.");
  });

  it("still answers the customer when the agent step fails outright", async () => {
    agentShouldThrow = true;
    const state = await run(makeContext(makeRegistry(makeTool())));

    expect(state.replyText).toBe("Your order has shipped.");
    expect(state.action).toBe("reply");
  });

  it("passes the meta pass's action and follow-up chips through to the turn", async () => {
    metaResult = { confidence: 0.2, action: "escalate", quickReplies: ["Talk to a human", ""] };
    const state = await run(makeContext(makeRegistry(makeTool())));

    expect(state.action).toBe("escalate");
    expect(state.confidence).toBe(0.2);
    // Blank chips are dropped rather than rendered as empty buttons.
    expect(state.quickReplies).toEqual(["Talk to a human"]);
  });
});
