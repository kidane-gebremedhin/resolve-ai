// The tool step: run every tool the model asked for, and fold what comes back
// into the turn.
//
// Each call passes an input-completeness gate first. When the model has not
// supplied what a tool needs, the right answer is to render a form and stop —
// never to dispatch a booking or refund with guessed values.

import { ToolMessage, type AIMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { logger } from "../../../../config/logger.js";
import { ToolCallLog } from "../../../../models/index.js";
import { maskPii } from "../../../integrations/piiMask.js";
import { gateToolInput } from "../../tools/input-gate.js";
import type { ToolArtifact } from "../../tools/types.js";
import { getTurnContext, type TurnContext } from "../context.js";
import type {
  AgentState,
  AgentStateUpdate,
  QueryRewriteRecord,
  ToolCallRecord,
} from "../state.js";
import type { MessageBlock } from "../../../../types/messageBlocks.js";
import type { KbHit } from "../../../kb/search.service.js";
import type { RetrievalStats } from "../../retrieval/kb-retriever.js";

export const TOOLS_NODE = "tools";

/**
 * Audit record for a built-in tool call. Integration tools are logged inside
 * `dispatchToolCall`, which sees the connection and credentials this layer
 * deliberately never touches.
 */
function auditBuiltinCall(
  ctx: TurnContext,
  call: { name: string; args: Record<string, unknown> },
  result: string,
  status: "success" | "error",
  durationMs: number,
): void {
  const argsMasked = ctx.piiRedact
    ? (JSON.parse(maskPii(JSON.stringify(call.args))) as unknown)
    : call.args;
  ToolCallLog.create({
    organizationId: ctx.organizationId,
    agentId: ctx.agentId,
    conversationId: ctx.conversationId,
    contactSessionId: ctx.contactSessionId,
    toolKey: call.name,
    argsMasked,
    resultSummary: result.slice(0, 500),
    status,
    durationMs,
  }).catch((e: Error) => logger.warn("[ai] ToolCallLog create failed", { err: e.message }));
}

export async function toolsNode(
  state: AgentState,
  config?: RunnableConfig,
): Promise<AgentStateUpdate> {
  const ctx = getTurnContext(config);
  const last = state.messages[state.messages.length - 1] as AIMessage | undefined;
  const calls = last?.tool_calls ?? [];

  const messages: ToolMessage[] = [];
  const blocks: MessageBlock[] = [];
  const kbHits: KbHit[] = [];
  const queryRewrites: QueryRewriteRecord[] = [];
  const retrievalStats: RetrievalStats[] = [];
  const toolCallLog: ToolCallRecord[] = [];
  let halt = false;
  let conflicted = false;

  for (const call of calls) {
    const args = (call.args ?? {}) as Record<string, unknown>;
    const toolCallId = call.id ?? call.name;
    const started = Date.now();
    let content: string;
    let status: "success" | "error" = "success";

    const registered = ctx.registry.byName.get(call.name);
    if (!registered) {
      content = JSON.stringify({ error: `Unknown tool "${call.name}".` });
      status = "error";
      messages.push(new ToolMessage({ content, tool_call_id: toolCallId, name: call.name }));
      toolCallLog.push({ name: call.name, args, result: content });
      continue;
    }

    const gate = gateToolInput(call.name, args, ctx.registry);
    if (gate.kind === "steer") {
      content = gate.note;
      status = "error";
      messages.push(new ToolMessage({ content, tool_call_id: toolCallId, name: call.name }));
      toolCallLog.push({ name: call.name, args, result: content });
      continue;
    }
    if (gate.kind === "collect") {
      blocks.push(gate.block);
      halt = true;
      content = gate.note;
      messages.push(new ToolMessage({ content, tool_call_id: toolCallId, name: call.name }));
      toolCallLog.push({ name: call.name, args, result: content });
      continue;
    }

    try {
      // Invoking with the ToolCall (rather than the bare args) is what makes
      // LangChain return a ToolMessage carrying both the model-visible content
      // and the artifact this turn needs.
      const observed = (await registered.invoke(call, config)) as ToolMessage;
      const artifact = (observed.artifact ?? {}) as ToolArtifact;
      content = typeof observed.content === "string" ? observed.content : JSON.stringify(observed.content);
      status = artifact.status ?? "success";
      if (artifact.blocks?.length) blocks.push(...artifact.blocks);
      if (artifact.kbHits?.length) kbHits.push(...artifact.kbHits);
      if (artifact.queryRewrite) queryRewrites.push(artifact.queryRewrite);
      if (artifact.retrievalStats?.length) retrievalStats.push(...artifact.retrievalStats);
      if (artifact.halt) halt = true;
      if (artifact.conflicted) conflicted = true;
      messages.push(observed);
    } catch (err) {
      // A tool that throws returns an error result to the model rather than
      // crashing the reply — the model can still answer.
      logger.error("[ai] tool execution failed", { tool: call.name, err: (err as Error).message });
      content = JSON.stringify({ error: "tool temporarily unavailable" });
      status = "error";
      messages.push(new ToolMessage({ content, tool_call_id: toolCallId, name: call.name }));
    }

    toolCallLog.push({ name: call.name, args, result: content });
    if (ctx.registry.builtinNames.has(call.name)) {
      auditBuiltinCall(ctx, { name: call.name, args }, content, status, Date.now() - started);
    }
  }

  return {
    messages,
    blocks,
    kbHits,
    queryRewrites,
    retrievalStats,
    toolCallLog,
    halt,
    conflicted,
  };
}
