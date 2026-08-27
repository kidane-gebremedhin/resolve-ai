// Per-turn context handed to the graph through `config.configurable`.
//
// It carries the things that are resolved once per turn and are not state: the
// agent's model settings, the tool registry built from this org's connections,
// and the conversation identifiers tools need. Only primitive values in
// `configurable` are copied into LangSmith metadata, so the registry and its
// closures never end up in a trace payload.

import type { RunnableConfig } from "@langchain/core/runnables";
import type { ToolRegistry } from "../tools/types.js";

export const TURN_CONTEXT_KEY = "turnContext";

/** Tag applied to the final customer-facing generation, so the runner can pick its tokens out of the event stream. */
export const FINAL_REPLY_TAG = "final_reply";

export type TurnContext = {
  model: string;
  temperature: number;
  maxToolTurns: number;
  registry: ToolRegistry;
  /**
   * Set when an inline-form / OTP submission ALREADY executed a tool: the graph
   * skips the agent loop entirely and only presents that result.
   */
  presentToolResult?: { toolKey: string; result: unknown };
  /** PII masking is applied to audit-log arguments when the org has it on. */
  piiRedact: boolean;
  organizationId: string;
  agentId: string;
  conversationId: string;
  contactSessionId: string;
};

export function getTurnContext(config: RunnableConfig | undefined): TurnContext {
  const ctx = config?.configurable?.[TURN_CONTEXT_KEY] as TurnContext | undefined;
  if (!ctx) throw new Error("turnContext missing from graph config");
  return ctx;
}
