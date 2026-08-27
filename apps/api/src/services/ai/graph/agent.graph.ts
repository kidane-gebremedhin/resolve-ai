// The customer-reply graph.
//
//   agent ──has tool calls?──> tools ──may continue?──> agent
//     │                          │
//     └────────── no ────────────┴──> finalize ──> END
//
// The loop is bounded three ways: the model choosing not to call a tool, a tool
// halting the turn to wait on the customer, and a hard ceiling on round trips so
// a model stuck on a failing tool cannot burn an org's budget.

import { END, START, StateGraph } from "@langchain/langgraph";
import type { AIMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { logger } from "../../../config/logger.js";
import { getTurnContext } from "./context.js";
import { AGENT_NODE, agentNode } from "./nodes/agent.node.js";
import { FINALIZE_NODE, finalizeNode } from "./nodes/finalize.node.js";
import { TOOLS_NODE, toolsNode } from "./nodes/tools.node.js";
import { AgentStateAnnotation, type AgentState } from "./state.js";

export const GRAPH_NAME = "customer_reply";

/** After the agent speaks: run the tools it asked for, or go write the reply. */
function routeFromAgent(state: AgentState, config?: RunnableConfig): typeof TOOLS_NODE | typeof FINALIZE_NODE {
  const ctx = getTurnContext(config);
  const last = state.messages[state.messages.length - 1] as AIMessage | undefined;
  const toolCalls = last?.tool_calls ?? [];
  if (toolCalls.length === 0) return FINALIZE_NODE;
  if (state.halt) return FINALIZE_NODE;
  if (state.toolTurns >= ctx.maxToolTurns) {
    logger.warn("[ai] tool-turn ceiling reached, finalizing", {
      conversationId: ctx.conversationId,
      toolTurns: state.toolTurns,
    });
    return FINALIZE_NODE;
  }
  return TOOLS_NODE;
}

/** After tools run: back to the agent unless the turn now belongs to the customer. */
function routeFromTools(state: AgentState): typeof AGENT_NODE | typeof FINALIZE_NODE {
  return state.halt ? FINALIZE_NODE : AGENT_NODE;
}

/**
 * Present-only turns skip the agent loop entirely. A form or OTP submission has
 * already executed the tool, so the only job left is to present that result —
 * letting the model loop again would let it resurface an unrelated earlier
 * request or re-run a non-idempotent action.
 */
function routeFromStart(_state: AgentState, config?: RunnableConfig): typeof AGENT_NODE | typeof FINALIZE_NODE {
  return getTurnContext(config).presentToolResult ? FINALIZE_NODE : AGENT_NODE;
}

function build() {
  return new StateGraph(AgentStateAnnotation)
    .addNode(AGENT_NODE, agentNode)
    .addNode(TOOLS_NODE, toolsNode)
    .addNode(FINALIZE_NODE, finalizeNode)
    .addConditionalEdges(START, routeFromStart, [AGENT_NODE, FINALIZE_NODE])
    .addConditionalEdges(AGENT_NODE, routeFromAgent, [TOOLS_NODE, FINALIZE_NODE])
    .addConditionalEdges(TOOLS_NODE, routeFromTools, [AGENT_NODE, FINALIZE_NODE])
    .addEdge(FINALIZE_NODE, END)
    .compile();
}

let compiled: ReturnType<typeof build> | null = null;

/**
 * The compiled graph is a stateless singleton — everything conversation-specific
 * (tools, model, ids) arrives per invocation via `configurable.turnContext`.
 */
export function getReplyGraph(): ReturnType<typeof build> {
  compiled ??= build();
  return compiled;
}
