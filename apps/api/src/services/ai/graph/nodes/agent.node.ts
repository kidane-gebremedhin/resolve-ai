// The agent step: give the model the conversation so far plus its tools, and let
// it decide whether to call one or to answer.

import type { RunnableConfig } from "@langchain/core/runnables";
import { logger } from "../../../../config/logger.js";
import { createChatModel, generationIdOf } from "../../llm/chat-model.js";
import { getTurnContext } from "../context.js";
import type { AgentState, AgentStateUpdate } from "../state.js";

export const AGENT_NODE = "agent";

export async function agentNode(
  state: AgentState,
  config?: RunnableConfig,
): Promise<AgentStateUpdate> {
  const ctx = getTurnContext(config);
  const model = createChatModel({ model: ctx.model, temperature: ctx.temperature });
  // Tools first, run name second: bindTools lives on the model, withConfig
  // returns a binding that no longer has it.
  const bound = (
    ctx.registry.tools.length > 0 ? model.bindTools(ctx.registry.tools) : model
  ).withConfig({ runName: "agent_step" });

  try {
    const message = await bound.invoke(state.messages, config);
    const generationId = generationIdOf(message);
    return {
      messages: [message],
      toolTurns: 1,
      ...(generationId ? { generationIds: [generationId] } : {}),
    };
  } catch (err) {
    // A failure here must not abort the turn. Returning no message leaves the
    // last message as the customer's (or a tool's), which routes straight to
    // finalize — the customer still gets an answer, just without further tool
    // use. LangChain has already exhausted its retries by this point.
    logger.error("[ai] agent step failed, proceeding to final reply", {
      err: (err as Error).message,
    });
    return { toolTurns: 1 };
  }
}
