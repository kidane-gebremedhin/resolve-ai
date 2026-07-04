import type { Types } from "mongoose";
import { ToolDefinition, ToolCallLog, ContactSession, Agent, Connection, Message } from "../../models/index.js";
import { getAdapter } from "./adapters/index.js";
import { evaluateGuardrails } from "./guardrails.js";
import { checkRateLimit } from "./rateLimit.js";
import { maskPii } from "./piiMask.js";
import { decrypt, encrypt } from "../security/crypto.service.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { MessageBlock, CardBlock, CarouselBlock } from "../../types/messageBlocks.js";

// Convert a tool result into rich message blocks for the widget UI.
// Returns null when the tool has no special display.
export function resultToBlocks(toolKey: string, result: unknown): MessageBlock[] | null {
  try {
    if (toolKey === "list_calendar_slots") {
      // The Cal.com adapter returns { slots: string[], eventTypeId }. Render up to
      // 5 as bookable cards. Embedding the RESOLVED eventTypeId in the book action
      // is essential: without it the model re-guesses the id for book_meeting and
      // often passes the duration/index (e.g. "15"/"1") → booking fails.
      const data = result as { slots?: string[]; eventTypeId?: string; timeZone?: string };
      const slots = (data?.slots ?? []).slice(0, 5);
      if (slots.length === 0) return null;
      const et = data?.eventTypeId ? ` for event type ${data.eventTypeId}` : "";
      const tz = data?.timeZone || undefined; // visitor's IANA zone; undefined → runtime default
      const carousel: CarouselBlock = {
        type: "carousel",
        cards: slots.map((iso) => {
          const start = new Date(iso);
          const valid = !Number.isNaN(start.getTime());
          const title = valid
            ? start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: tz })
            : "Available slot";
          // Show the time WITH its zone abbreviation (e.g. "2:00 PM EST") so the
          // visitor is never guessing which timezone a slot is in.
          const subtitle = valid
            ? start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZone: tz, timeZoneName: "short" })
            : undefined;
          const card: CardBlock = {
            type: "card",
            title,
            subtitle,
            buttons: [
              {
                label: "Book this slot",
                action: "send_message",
                value: `Please book the slot at ${iso}${et}`,
                variant: "primary",
              },
            ],
          };
          return card;
        }),
      };
      return [carousel];
    }

    if (toolKey === "book_meeting") {
      // Adapter returns { ok, bookingUid, start, meetingUrl }. Show a
      // confirmation card so the visitor sees the booked time at a glance.
      const data = result as { ok?: boolean; start?: string; meetingUrl?: string; bookingUid?: string; timeZone?: string };
      if (!data?.ok || !data.start) return null;
      const start = new Date(data.start);
      const valid = !Number.isNaN(start.getTime());
      const tz = data?.timeZone || undefined;
      const card: CardBlock = {
        type: "card",
        title: "Meeting booked ✓",
        subtitle: valid
          ? start.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz, timeZoneName: "short" })
          : undefined,
        buttons: data.meetingUrl
          ? [{ label: "Join meeting", action: "open_url", value: data.meetingUrl, variant: "primary" }]
          : [],
      };
      return [card];
    }

    if (toolKey === "get_subscription") {
      const data = result as {
        plan?: string;
        status?: string;
        nextBillDate?: string;
        currentPeriodEnd?: string;
      };
      if (!data?.plan) return null;
      const renewalDate = data.nextBillDate ?? data.currentPeriodEnd;
      const card: CardBlock = {
        type: "card",
        title: String(data.plan),
        subtitle: data.status ? `Status: ${data.status}` : undefined,
        badge: renewalDate
          ? `Renews ${new Date(renewalDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
          : undefined,
        buttons: [],
      };
      return [card];
    }
  } catch {
    // Never crash the message flow for a display-only conversion error
  }
  return null;
}

export type DispatchContext = {
  organizationId: Types.ObjectId | string;
  agentId: Types.ObjectId | string;
  conversationId: Types.ObjectId | string;
  contactSessionId: Types.ObjectId | string;
  sessionToken?: string;
};

export type DispatchResult =
  | { ok: true; result: unknown }
  | { ok: false; blocked: true; reason: string; status: "guardrail_blocked" | "otp_pending" | "rate_limited" }
  | { ok: false; blocked: false; error: string; status: "error" };

/**
 * Dispatches an integration tool call through the full pipeline:
 * guardrail check → rate limit → OTP identity check → credential decrypt → adapter execute → audit log.
 */
export async function dispatchToolCall(
  toolKey: string,
  args: Record<string, unknown>,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  const startMs = Date.now();

  // Load the tool definition for this tool key + org
  const toolDef = await ToolDefinition.findOne({
    organizationId: ctx.organizationId,
    key: toolKey,
    isActive: true,
  }).populate("connectionId");

  if (!toolDef || !toolDef.connectionId) {
    return { ok: false, blocked: false, error: `Tool '${toolKey}' not found or inactive.`, status: "error" };
  }

  const connection = toolDef.connectionId as unknown as {
    _id: Types.ObjectId;
    provider: string;
    status: string;
    sandbox: boolean;
    rateLimitPerSession?: number;
    rateLimitPerConnection?: number;
    rateLimitWindowMs?: number;
    encryptedCredentials: Parameters<typeof decrypt>[0];
  };

  if (connection.status === "revoked") {
    return { ok: false, blocked: true, reason: "Integration connection has been revoked.", status: "guardrail_blocked" };
  }

  // NOTE: guardrail evaluation runs LATER, after argument enrichment, so
  // per-tool checks (named attendee, business hours, billing-owner email) see the
  // final values the system injects — not the raw, often-incomplete LLM args.

  // OTP identity verification
  if (toolDef.guardrails?.requireIdentityVerification && ctx.sessionToken) {
    const session = await ContactSession.findOne({ token: ctx.sessionToken }).lean();
    const verifiedUntil = (session as unknown as { identityVerifiedUntil?: Date })?.identityVerifiedUntil;
    if (!verifiedUntil || verifiedUntil < new Date()) {
      // Generate and send OTP — handled by the OTP service
      const { sendIdentityOtp } = await import("./otpService.js");
      const otpToken = await sendIdentityOtp(ctx.sessionToken, session);

      await ToolCallLog.create({
        organizationId: ctx.organizationId,
        agentId: ctx.agentId,
        conversationId: ctx.conversationId,
        contactSessionId: ctx.contactSessionId,
        connectionId: connection._id,
        toolKey,
        argsMasked: maskPii(args),
        status: "otp_pending",
        durationMs: Date.now() - startMs,
      });

      return {
        ok: false,
        blocked: true,
        reason: JSON.stringify({ otpRequired: true, otpToken }),
        status: "otp_pending",
      };
    }
  }

  // Rate limit check — using this connection's configured limits.
  const rl = checkRateLimit(connection._id.toString(), ctx.contactSessionId.toString(), {
    perSession: connection.rateLimitPerSession,
    perConnection: connection.rateLimitPerConnection,
    windowMs: connection.rateLimitWindowMs,
  });
  if (!rl.allowed) {
    return {
      ok: false,
      blocked: true,
      reason: "Too many requests to this integration. Please wait before trying again.",
      status: "rate_limited",
    };
  }

  // Decrypt credentials
  let credentials: ReturnType<typeof import("../security/crypto.service.js").decrypt> extends string
    ? Record<string, unknown>
    : never;
  let rawCredentials: import("./providers/types.js").RawCredentials;
  try {
    const plaintext = decrypt(connection.encryptedCredentials as Parameters<typeof decrypt>[0]);
    rawCredentials = JSON.parse(plaintext) as import("./providers/types.js").RawCredentials;
  } catch (err) {
    logger.error("[dispatcher] credential decrypt failed", { toolKey, err: (err as Error).message });
    return { ok: false, blocked: false, error: "Failed to decrypt integration credentials.", status: "error" };
  }

  // Auto-refresh expired OAuth tokens (5-minute buffer before expiry)
  const adapter = getAdapter(connection.provider);
  if (!adapter) {
    return { ok: false, blocked: false, error: `No adapter registered for provider '${connection.provider}'.`, status: "error" };
  }
  if (rawCredentials.expiresAt && rawCredentials.expiresAt - Date.now() / 1000 < 300) {
    try {
      const refreshed = await adapter.refreshTokens(connection.encryptedCredentials);
      if (refreshed) {
        const newEncrypted = encrypt(JSON.stringify(refreshed));
        await Connection.updateOne({ _id: connection._id }, { $set: { encryptedCredentials: newEncrypted } });
        rawCredentials = refreshed;
        logger.info("[dispatcher] OAuth token refreshed", { provider: connection.provider });
      }
    } catch (err) {
      logger.warn("[dispatcher] token refresh failed", { provider: connection.provider, err: (err as Error).message });
    }
  }

  // Support-ticket routing. We deliberately do NOT dump the whole conversation
  // into the ticket — the AI writes a concise, issue-only summary in `description`
  // (see JIRA_TOOL_INSTRUCTIONS). We only override the project key with the agent's
  // operator-configured Jira project (per-agent), so tickets land in the right board.
  let enrichedArgs = args;
  if (toolKey === "create_support_ticket" && ctx.agentId) {
    try {
      const agent = await Agent.findById(ctx.agentId).select("jiraProjectKey").lean();
      const projectKey = (agent as { jiraProjectKey?: string } | null)?.jiraProjectKey?.trim();
      if (projectKey) {
        // Route to the agent's operator-configured Jira project. The adapter
        // honours it when it exists (the editor offers a real-project dropdown),
        // else falls back to a real project so the ticket is still created.
        enrichedArgs = { ...args, projectKey };
      }
      // Attach the full conversation to the ticket (as a file, not in the concise
      // description) so the operator has the exact context the customer provided.
      // PII is masked per line, mirroring how tool-call args are masked.
      if (ctx.conversationId) {
        try {
          const msgs = await Message.find({ conversationId: ctx.conversationId })
            .sort({ createdAt: 1 })
            .select("role content createdAt")
            .lean();
          const transcript = (msgs as { role: string; content?: string; createdAt: Date }[])
            .filter((m) => m.role !== "system" && (m.content ?? "").trim())
            .map((m) => {
              const who = m.role === "customer" ? "Customer" : m.role === "ai" ? "Assistant" : "Operator";
              const ts = new Date(m.createdAt).toISOString();
              return `[${ts}] ${who}: ${maskPii(String(m.content ?? ""))}`;
            })
            .join("\n");
          if (transcript) enrichedArgs = { ...enrichedArgs, _transcript: transcript };
        } catch (err) {
          logger.warn("[dispatcher] transcript build failed", { err: (err as Error).message });
        }
      }
    } catch (err) {
      logger.warn("[dispatcher] agent project-key lookup failed", { err: (err as Error).message });
    }
  }

  // Any tool that needs the customer's REAL email (booking, Paddle subscription
  // lookups/changes) hits the same problem: PII redaction masks emails in the
  // message the LLM sees, so the model passes a placeholder (e.g. "[EMAIL]") that
  // the provider rejects (no customer found / email_validation_error).
  // Authoritatively inject the contact's real email (and name) from the
  // ContactSession, overriding the (masked/omitted) arg.
  const EMAIL_TOOLS = new Set([
    "book_meeting",
    "get_subscription",
    "upgrade_subscription",
    "downgrade_subscription",
    "cancel_subscription",
  ]);
  if (EMAIL_TOOLS.has(toolKey) && ctx.contactSessionId) {
    try {
      const session = await ContactSession.findById(ctx.contactSessionId).lean();
      const realEmail = (session as { email?: string } | null)?.email;
      const realName = (session as { name?: string } | null)?.name;
      const argEmail = String((enrichedArgs as Record<string, unknown>).email ?? "");
      // Only override when the arg isn't a valid-looking email (i.e. it was masked/omitted).
      if (realEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(argEmail)) {
        enrichedArgs = { ...enrichedArgs, email: realEmail };
      }
      if (realName && !String((enrichedArgs as Record<string, unknown>).name ?? "").trim()) {
        enrichedArgs = { ...enrichedArgs, name: realName };
      }
    } catch (err) {
      logger.warn("[dispatcher] contact email inject failed", { err: (err as Error).message });
    }
  }

  // Cal.com: book in — and display slots in — the VISITOR's timezone (captured at
  // widget init, stored on the ContactSession metadata) instead of hardcoded UTC.
  const CALCOM_TZ_TOOLS = new Set(["book_meeting", "list_calendar_slots"]);
  if (CALCOM_TZ_TOOLS.has(toolKey) && ctx.contactSessionId) {
    try {
      const session = await ContactSession.findById(ctx.contactSessionId).select("metadata").lean();
      const tz = (session as { metadata?: { timeZone?: string } } | null)?.metadata?.timeZone;
      if (tz && !String((enrichedArgs as Record<string, unknown>).timeZone ?? "").trim()) {
        enrichedArgs = { ...enrichedArgs, timeZone: tz };
      }
    } catch (err) {
      logger.warn("[dispatcher] contact timezone inject failed", { err: (err as Error).message });
    }
  }

  // Paddle: a customer's email can map to subscriptions across many tenants. Pass
  // the current org so the adapter targets THIS workspace's subscription (matched
  // on custom_data.organizationId), never another org's.
  const PADDLE_SUB_TOOLS = new Set([
    "get_subscription",
    "upgrade_subscription",
    "downgrade_subscription",
    "cancel_subscription",
  ]);
  if (PADDLE_SUB_TOOLS.has(toolKey) && ctx.organizationId) {
    enrichedArgs = { ...enrichedArgs, organizationId: String(ctx.organizationId) };
  }

  // Guardrail evaluation — on the ENRICHED args + toolKey, so per-tool limits
  // (refund caps, business hours, named attendee, upgrade-only, billing owner)
  // are enforced against the final values right before we execute.
  const guardrailResult = evaluateGuardrails(toolDef.guardrails ?? undefined, enrichedArgs, toolKey);
  if (guardrailResult.blocked) {
    await ToolCallLog.create({
      organizationId: ctx.organizationId,
      agentId: ctx.agentId,
      conversationId: ctx.conversationId,
      contactSessionId: ctx.contactSessionId,
      connectionId: connection._id,
      toolKey,
      argsMasked: maskPii(enrichedArgs),
      status: "guardrail_blocked",
      errorMessage: guardrailResult.reason,
      durationMs: Date.now() - startMs,
    });
    return { ok: false, blocked: true, reason: guardrailResult.reason, status: "guardrail_blocked" };
  }

  let result: unknown;
  let execError: string | undefined;
  try {
    result = await adapter.execute(toolKey, enrichedArgs, rawCredentials, connection.sandbox);
  } catch (err) {
    execError = (err as Error).message;
    logger.error("[dispatcher] adapter.execute failed", { toolKey, provider: connection.provider, err: execError });
  }

  const status = execError ? "error" : "success";
  const durationMs = Date.now() - startMs;

  await ToolCallLog.create({
    organizationId: ctx.organizationId,
    agentId: ctx.agentId,
    conversationId: ctx.conversationId,
    contactSessionId: ctx.contactSessionId,
    connectionId: connection._id,
    toolKey,
    argsMasked: maskPii(args),
    resultSummary: result ? JSON.stringify(result).slice(0, 500) : undefined,
    status,
    errorMessage: execError,
    durationMs,
  });

  if (execError) {
    return { ok: false, blocked: false, error: execError, status: "error" };
  }

  // After a widget-driven Paddle plan change, mirror it into our own
  // Subscription/Organization immediately so the dashboard billing page reflects
  // the new plan without waiting for the async Paddle webhook (which may never
  // reach a local/dev host). Best-effort — never fail the tool over a sync error.
  const PADDLE_WRITE_TOOLS = new Set([
    "upgrade_subscription",
    "downgrade_subscription",
    "cancel_subscription",
  ]);
  if (PADDLE_WRITE_TOOLS.has(toolKey)) {
    const subId = (result as { subscriptionId?: string } | null)?.subscriptionId;
    if (subId) {
      try {
        const { syncSubscriptionFromPaddle } = await import("../billing.service.js");
        await syncSubscriptionFromPaddle(subId);
      } catch (err) {
        logger.warn("[dispatcher] paddle billing sync failed", { err: (err as Error).message });
      }
    }
  }

  return { ok: true, result };
}
