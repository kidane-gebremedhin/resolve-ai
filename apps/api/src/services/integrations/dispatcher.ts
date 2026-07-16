import type { Types } from "mongoose";
import { ToolDefinition, ToolCallLog, ContactSession, Agent, Connection, Message, ExternalSubscription, Organization } from "../../models/index.js";
import { getAdapter } from "./adapters/index.js";
import { evaluateGuardrails } from "./guardrails.js";
import { checkRateLimit } from "./rateLimit.js";
import { maskPii } from "./piiMask.js";
import { decrypt, encrypt } from "../security/crypto.service.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { MessageBlock, CardBlock, CarouselBlock } from "../../types/messageBlocks.js";

// Tool keys where email-OTP identity verification is ON BY DEFAULT — required unless the
// operator explicitly turns the `requireIdentityVerification` flag off. These change a
// subscription or move money (refunds), high-stakes actions where a self-asserted contact
// email isn't proof of ownership, so the customer proves control of the account inbox first.
const OTP_DEFAULT_ON_TOOLKEYS = new Set([
  "upgrade_subscription",
  "downgrade_subscription",
  "cancel_subscription",
  "issue_refund",
  "refund_payment",
]);

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
  // Pin a specific connection for this call — used to route to a chosen PRIMARY tool
  // (and fall back to another connection on error) when several connections expose the
  // same tool key (e.g. Jira + Linear both `create_support_ticket`).
  connectionId?: Types.ObjectId | string,
): Promise<DispatchResult> {
  const startMs = Date.now();

  // Load the tool definition(s) for this tool key + org. A custom webhook can be
  // disconnected (revoked) and re-added, leaving more than one tool def sharing the
  // same key — one pointing at the revoked connection, one at the live one. Prefer
  // the tool def whose connection is still active so a reconnect never routes to the
  // dead connection (which would surface a "connection has been revoked" error).
  const toolDefs = await ToolDefinition.find({
    organizationId: ctx.organizationId,
    key: toolKey,
    isActive: true,
    ...(connectionId ? { connectionId } : {}),
  }).populate("connectionId");

  const toolDef =
    toolDefs.find((td) => (td.connectionId as unknown as { status?: string } | null)?.status === "active") ??
    toolDefs.find((td) => Boolean(td.connectionId)) ??
    toolDefs[0];

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
    sandboxCredentials?: Parameters<typeof decrypt>[0];
    productionCredentials?: Parameters<typeof decrypt>[0];
  };

  if (connection.status === "revoked") {
    return { ok: false, blocked: true, reason: "Integration connection has been revoked.", status: "guardrail_blocked" };
  }

  // Resolve the credentials for the ACTIVE environment. The operator can switch the
  // connection to an environment that isn't connected (to observe how the agent behaves
  // when a tool has no credentials) — in that case the tool call must fail GRACEFULLY
  // rather than silently using the other environment's tokens.
  const activeEnvCreds = connection.sandbox ? connection.sandboxCredentials : connection.productionCredentials;
  const otherEnvCreds = connection.sandbox ? connection.productionCredentials : connection.sandboxCredentials;
  if ((activeEnvCreds || otherEnvCreds) && !activeEnvCreds) {
    return {
      ok: false,
      blocked: true,
      reason: `This integration's ${connection.sandbox ? "sandbox" : "production"} environment isn't connected, so I can't complete that right now.`,
      status: "guardrail_blocked",
    };
  }
  // Env-aware connection → use the active env's slot; legacy connections (no slots) fall
  // back to the mirror `encryptedCredentials`.
  const activeCredsBlob = activeEnvCreds ?? connection.encryptedCredentials;

  // NOTE: guardrail evaluation runs LATER, after argument enrichment, so
  // per-tool checks (named attendee, business hours, billing-owner email) see the
  // final values the system injects — not the raw, often-incomplete LLM args.

  // OTP identity verification. Subscription-change tools require it BY DEFAULT (unless the
  // operator explicitly turned the flag off); other tools require it only when the flag is
  // on. Changing/cancelling a plan is high-stakes and a self-asserted contact email alone
  // isn't proof of ownership — the emailed code is.
  //
  // NOTE: keyed off `contactSessionId`, NOT `ctx.sessionToken` — the AI tool-loop caller
  // (agent.service) has the session id but not the raw token, so gating on sessionToken
  // meant OTP NEVER fired from the assistant path and high-stakes actions ran unverified.
  const otpFlag = toolDef.guardrails?.requireIdentityVerification;
  const otpRequired = OTP_DEFAULT_ON_TOOLKEYS.has(toolKey) ? otpFlag !== false : otpFlag === true;
  if (otpRequired && ctx.contactSessionId) {
    const session = await ContactSession.findById(ctx.contactSessionId).lean();
    const sessionToken = (session as { token?: string } | null)?.token;
    const verifiedUntil = (session as { identityVerifiedUntil?: Date } | null)?.identityVerifiedUntil;
    if (sessionToken && (!verifiedUntil || verifiedUntil < new Date())) {
      // Generate and send OTP — branded with the operator's organization name so the
      // customer recognises who the code is from.
      const { sendIdentityOtp } = await import("./otpService.js");
      const org = await Organization.findById(ctx.organizationId).select("name").lean();
      const brand = (org as { name?: string } | null)?.name;
      const otpToken = await sendIdentityOtp(sessionToken, session, brand);

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

      // Carry the toolKey so the widget can re-run this exact tool once the code is
      // verified (identityVerifiedUntil is then set, so the retry passes this gate).
      return {
        ok: false,
        blocked: true,
        reason: JSON.stringify({ otpRequired: true, otpToken, toolKey }),
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
    const plaintext = decrypt(activeCredsBlob as Parameters<typeof decrypt>[0]);
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
      const { getOAuthAppCreds } = await import("./oauthApp.service.js");
      const appCreds = await getOAuthAppCreds(ctx.organizationId, connection.provider, Boolean(connection.sandbox));
      const refreshed = await adapter.refreshTokens(connection.encryptedCredentials, appCreds);
      if (refreshed) {
        const newEncrypted = encrypt(JSON.stringify(refreshed));
        // Persist into the active environment's slot too (not just the mirror), so a
        // later env switch can't restore a stale, already-rotated refresh token and
        // break the connection. See refreshOAuthTokens.ts for the same reasoning.
        const activeSlot = connection.sandbox ? "sandboxCredentials" : "productionCredentials";
        await Connection.updateOne(
          { _id: connection._id },
          { $set: { encryptedCredentials: newEncrypted, [activeSlot]: newEncrypted } },
        );
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

  // Paddle: the subscription tools act on the OPERATOR's OWN Paddle (their customer's
  // subscription), resolved by the customer's email — NOT this platform's Paddle. So we
  // do NOT inject this platform's organizationId (that org tag only exists in the
  // platform's own billing Paddle, never in the operator's account). The adapter picks
  // the customer's active subscription by email.

  // Guardrail evaluation — on the ENRICHED args + toolKey, so per-tool limits
  // (refund caps, business hours, named attendee, billing owner)
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
    // Resilience: a subscription LOOKUP that failed because the provider API was
    // unreachable can be answered from the last snapshot the webhook receiver stored
    // for this customer. Read-only tools only (never mutations), and only when the
    // adapter threw (a definite not-found returns a normal result, not an error) —
    // so we never contradict a live "no subscription" with a stale snapshot.
    if (toolKey === "get_subscription" && (connection.provider === "paddle" || connection.provider === "stripe")) {
      const email = String((enrichedArgs as Record<string, unknown>).email ?? "").trim().toLowerCase();
      if (email) {
        const snap = await ExternalSubscription.findOne({ connectionId: connection._id, customerEmail: email })
          .sort({ updatedAt: -1 })
          .lean();
        if (snap) {
          logger.info("[dispatcher] get_subscription served from webhook snapshot", { connectionId: String(connection._id) });
          return {
            ok: true,
            result: {
              found: true,
              hasSubscription: true,
              plan: snap.plan ?? "current plan",
              status: snap.status,
              subscriptionId: snap.externalSubscriptionId,
              nextBillDate: snap.currentPeriodEnd,
              fromCache: true,
            },
          };
        }
      }
    }
    return { ok: false, blocked: false, error: execError, status: "error" };
  }

  // After a widget-driven Paddle plan change, keep our subscription snapshot in sync
  // immediately so the assistant reflects the new plan without waiting for the async
  // provider webhook (which may never reach a local/dev host). Best-effort — never
  // fail the tool over a sync error.
  const PADDLE_WRITE_TOOLS = new Set([
    "upgrade_subscription",
    "downgrade_subscription",
    "cancel_subscription",
  ]);
  if (PADDLE_WRITE_TOOLS.has(toolKey) && (connection.provider === "paddle" || connection.provider === "stripe")) {
    const r = result as { subscriptionId?: string; plan?: string; status?: string; billingInterval?: string } | null;
    const subId = r?.subscriptionId;
    if (subId) {
      const email = String((enrichedArgs as Record<string, unknown>).email ?? "").trim().toLowerCase();
      ExternalSubscription.updateOne(
        { connectionId: connection._id, externalSubscriptionId: subId },
        {
          $set: {
            organizationId: ctx.organizationId,
            connectionId: connection._id,
            provider: connection.provider,
            ...(email ? { customerEmail: email } : {}),
            ...(r?.plan ? { plan: r.plan } : {}),
            ...(r?.status ? { status: r.status } : {}),
            ...(r?.billingInterval ? { billingInterval: r.billingInterval === "yearly" ? "year" : "month" } : {}),
          },
        },
        { upsert: true },
      ).catch((err) => logger.warn("[dispatcher] subscription snapshot sync failed", { err: (err as Error).message }));

      // When the operator's integration Paddle IS the platform's own Paddle (the common
      // dogfood case — the widget is embedded on the SaaS's own site), also reconcile the
      // change into the platform's Subscription/Organization so the operator's billing
      // portal reflects the new plan immediately instead of waiting on the async webhook.
      // Best-effort and safely a no-op for a separate operator account: the subscription
      // id won't resolve against the platform's Paddle, so it just logs and moves on.
      if (connection.provider === "paddle") {
        void (async () => {
          try {
            const { syncSubscriptionFromPaddle } = await import("../billing.service.js");
            await syncSubscriptionFromPaddle(subId);
          } catch (err) {
            logger.warn("[dispatcher] paddle billing-portal sync skipped", { err: (err as Error).message });
          }
        })();
      }
    }
  }

  return { ok: true, result };
}
