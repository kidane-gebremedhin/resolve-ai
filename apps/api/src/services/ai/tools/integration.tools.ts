// Integration tools — one LangChain tool per operator-connected capability
// (lookup_order, book_meeting, create_support_ticket, custom webhooks, …).
//
// The tool body is a thin, honest wrapper around `dispatchToolCall`, which owns
// the real pipeline: guardrails → rate limit → OTP identity check → credential
// decrypt → adapter execute → audit log. Everything this file adds is the
// translation between a dispatch outcome and what the model + widget need to
// see next.

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { logger } from "../../../config/logger.js";
import { dispatchToolCall, resultToBlocks } from "../../integrations/dispatcher.js";
import { safeToolParameters, stripUrlKeys } from "../shared/sanitize.js";
import type { ToolArtifact, ToolExecutionContext } from "./types.js";

/** One integration tool key, resolved to the schema and connection chain it runs against. */
export type IntegrationToolSpec = {
  key: string;
  description: string;
  /** The schema offered to the model (enum-unioned across the connection chain). */
  schema: unknown;
  /**
   * Ordered connection ids: primary first, then fallbacks. Several connections
   * can expose the same key (Stripe + Paddle both do subscriptions), but the
   * model is offered the key ONCE — duplicate function names 400 the whole
   * request — so the chain is walked here instead.
   */
  connectionChain: string[];
};

/**
 * A lookup that SUCCEEDS but reports a definite not-found (the adapters'
 * `{ found: false }` convention) is a SOFT miss: when several connections expose
 * this tool the record may live in the OTHER provider, so keep walking the chain
 * before concluding "no records". If every connection misses, the last
 * found:false result stands — a truthful definite answer.
 */
function isSoftMiss(dispatch: Awaited<ReturnType<typeof dispatchToolCall>>): boolean {
  return dispatch.ok && (dispatch.result as { found?: boolean } | null)?.found === false;
}

async function dispatchWithFallback(
  key: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
  chain: string[],
): Promise<Awaited<ReturnType<typeof dispatchToolCall>>> {
  const dispatchCtx = {
    organizationId: ctx.organizationId,
    agentId: ctx.agentId,
    conversationId: ctx.conversationId,
    contactSessionId: ctx.contactSessionId,
  };
  let dispatch = await dispatchToolCall(key, args, dispatchCtx, chain[0] || undefined);
  for (let i = 1; i < chain.length; i++) {
    const hardError = !dispatch.ok && dispatch.status === "error";
    // Success, or an intentional stop (guardrail / OTP / rate limit) — not something
    // another connection would answer differently.
    if (!hardError && !isSoftMiss(dispatch)) break;
    logger.info("[ai] tool primary missed/failed, trying fallback", { tool: key, attempt: i });
    dispatch = await dispatchToolCall(key, args, dispatchCtx, chain[i]);
  }
  return dispatch;
}

/** Translate a dispatch outcome into what the model reads and what the widget renders. */
function toToolOutput(
  key: string,
  args: Record<string, unknown>,
  dispatch: Awaited<ReturnType<typeof dispatchToolCall>>,
): [string, ToolArtifact] {
  if (dispatch.ok) {
    // Ticket creation returns a browsable ticket URL; never expose it to the
    // model, or it offers the customer a "track it here" link.
    const modelResult = key === "create_support_ticket" ? stripUrlKeys(dispatch.result) : dispatch.result;
    const blocks = resultToBlocks(key, dispatch.result);
    return [JSON.stringify(modelResult), { ...(blocks ? { blocks } : {}), status: "success" }];
  }

  if (dispatch.status === "guardrail_blocked") {
    return [JSON.stringify({ blocked: true, reason: dispatch.reason }), { status: "error" }];
  }

  if (dispatch.status === "otp_pending") {
    // Surface an inline OTP challenge: render a code-entry block carrying the
    // otpToken + this tool's args, so the widget can verify the code and then
    // re-run the exact tool. Without a block the customer has no way to submit
    // the code and the action would stall — so OTP must ship WITH its UI.
    let otpToken = "";
    try {
      otpToken = (JSON.parse(dispatch.reason) as { otpToken?: string }).otpToken ?? "";
    } catch {
      /* reason wasn't JSON — leave blank */
    }
    const artifact: ToolArtifact = { halt: true, status: "error" };
    if (otpToken) {
      artifact.blocks = [
        {
          type: "otp",
          otpToken,
          toolKey: key,
          args: JSON.parse(JSON.stringify(args)) as Record<string, unknown>,
          message: "Enter the 6-digit code we emailed you to confirm it's you.",
        },
      ];
    }
    return [
      JSON.stringify({
        otpRequired: true,
        note: "A verification code was emailed to the customer and an inline code-entry form is now shown. STOP and wait for them to enter it — do NOT call the tool again or claim the action is done. Briefly tell them to check their email for the code.",
      }),
      artifact,
    ];
  }

  if (dispatch.status === "error") {
    return [JSON.stringify({ error: dispatch.error }), { status: "error" }];
  }
  return [JSON.stringify({ error: "rate limited" }), { status: "error" }];
}

/** Build the callable LangChain tool for one integration capability. */
export function buildIntegrationTool(
  spec: IntegrationToolSpec,
  ctx: ToolExecutionContext,
): StructuredToolInterface {
  return tool(
    async (input): Promise<[string, ToolArtifact]> => {
      const args = (input ?? {}) as Record<string, unknown>;
      const dispatch = await dispatchWithFallback(spec.key, args, ctx, spec.connectionChain);
      return toToolOutput(spec.key, args, dispatch);
    },
    {
      name: spec.key,
      description: spec.description,
      // Coerced so one malformed operator-authored schema cannot 400 the whole
      // tools array and take every other tool down with it.
      schema: safeToolParameters(spec.schema),
      responseFormat: "content_and_artifact",
    },
  ) as unknown as StructuredToolInterface;
}
