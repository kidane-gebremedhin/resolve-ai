// LangSmith tracing bootstrap.
//
// The LangChain SDK decides whether to trace by reading process.env at call
// time. We never want that to switch on implicitly — a stray LANGSMITH_TRACING
// in a deployment environment would start shipping customer conversation text
// to a third party. So this module is the single place that sets those vars,
// and it only does so when BOTH the flag and an API key are present (see
// `env.langsmith.enabled`); otherwise it actively clears them.

import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";

let initialized = false;

/** Call once during API startup, before any LangChain runnable is invoked. */
export function initLangSmithTracing(): void {
  if (initialized) return;
  initialized = true;

  if (!env.langsmith.enabled) {
    // Clear rather than ignore: the SDK reads these directly, so leaving a
    // half-configured pair in the environment would trace without our consent.
    delete process.env.LANGSMITH_TRACING;
    delete process.env.LANGCHAIN_TRACING_V2;
    return;
  }

  process.env.LANGSMITH_TRACING = "true";
  process.env.LANGSMITH_API_KEY = env.langsmith.apiKey ?? "";
  process.env.LANGSMITH_ENDPOINT = env.langsmith.endpoint;
  process.env.LANGSMITH_PROJECT = env.langsmith.project;
  logger.info("[ai] LangSmith tracing enabled", { project: env.langsmith.project });
}

/**
 * Per-run trace metadata. Tags let a trace be filtered by org/agent in the
 * LangSmith UI; metadata carries the ids needed to jump back to the
 * conversation in the operator inbox.
 */
export function traceMetadata(ctx: {
  organizationId: string;
  agentId: string;
  conversationId: string;
}): { tags: string[]; metadata: Record<string, string> } {
  return {
    tags: [`org:${ctx.organizationId}`, `agent:${ctx.agentId}`],
    metadata: {
      organization_id: ctx.organizationId,
      agent_id: ctx.agentId,
      conversation_id: ctx.conversationId,
    },
  };
}
