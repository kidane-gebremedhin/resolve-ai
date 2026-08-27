// The single chat-model factory for the whole API.
//
// Every LLM call — the agent, the meta pass, operator draft polish, reply
// suggestions, ticket transcript scoping — goes through here, so timeouts,
// retries and provider routing are configured in exactly one place.

import { ChatOpenAICompletions } from "@langchain/openai";
import type { BaseMessage, AIMessage, MessageContent } from "@langchain/core/messages";
import { env } from "../../../config/env.js";

const OPENROUTER_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

/**
 * Whether a real LLM is reachable. Dev environments and the test suite run
 * without a key, and every caller degrades to a deterministic fallback rather
 * than failing the request.
 */
export function isLlmConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export type ChatModelOptions = {
  model?: string;
  temperature?: number;
  /** Streaming call — enables per-token usage accounting on the provider side. */
  streaming?: boolean;
  /**
   * Ceiling on output tokens. Left unset for the answering path, where the model
   * should decide how long a reply needs to be.
   *
   * It matters for a call with a small, fixed output shape. OpenRouter reserves
   * the full max_tokens against the account balance before the call runs, and a
   * model whose default ceiling is 64k will 402 on a low balance even though the
   * response it would produce is a few hundred tokens.
   */
  maxTokens?: number;
};

/**
 * Build a chat model bound to OpenRouter.
 *
 * NOTE: this deliberately instantiates `ChatOpenAICompletions` rather than
 * `ChatOpenAI`. The umbrella `ChatOpenAI` class silently routes some model ids
 * (gpt-5, o-series, …) to OpenAI's /responses endpoint, which OpenRouter does
 * not implement — the call would 404 for exactly the newest models. The
 * completions class always speaks /chat/completions, the only surface
 * OpenRouter exposes.
 */
/**
 * Returns the chat model itself, never a `RunnableBinding`. Run tags and names
 * belong to the caller — attach them with `.withConfig()` AFTER `bindTools()` or
 * `withStructuredOutput()`, both of which exist on the model and not on a
 * binding.
 */
export function createChatModel(opts: ChatModelOptions = {}): ChatOpenAICompletions {
  return new ChatOpenAICompletions({
    model: opts.model ?? env.ai.model,
    temperature: opts.temperature ?? env.ai.temperature,
    streaming: opts.streaming ?? false,
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    // Ask the provider to include a usage block on the final streaming chunk;
    // without it a streamed reply reports no tokens at all.
    streamUsage: true,
    apiKey: process.env.OPENROUTER_API_KEY ?? "not-configured",
    timeout: env.ai.llmTimeoutMs,
    // LangChain retries transient failures (429 / 5xx / socket reset) with
    // exponential backoff; 4xx is surfaced immediately, as it should be.
    maxRetries: env.ai.llmMaxRetries,
    configuration: { baseURL: OPENROUTER_URL },
  });
}

/**
 * OpenRouter's generation id, which is what the usage/cost API is keyed on.
 * LangChain copies the raw response `id` onto the message, for both streamed
 * and non-streamed calls.
 */
export function generationIdOf(message: BaseMessage | AIMessage | null | undefined): string | null {
  const id = (message as { id?: unknown } | null | undefined)?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Flatten LangChain message content to plain text. Content is a string for
 * ordinary replies but an array of parts when the turn carries images or a
 * provider emits structured blocks, and a naive String() on the array would
 * put "[object Object]" in front of the customer.
 */
export function contentToText(content: MessageContent | undefined | null): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      const p = part as { type?: string; text?: unknown };
      return p.type === "text" && typeof p.text === "string" ? p.text : "";
    })
    .join("");
}
