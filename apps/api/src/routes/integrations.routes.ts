import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { Agent, Connection, ToolDefinition } from "../models/index.js";
import { getAdapter, listAdapters } from "../services/integrations/adapters/index.js";
import { encrypt, decrypt } from "../services/security/crypto.service.js";
import {
  getOAuthAppCreds,
  saveOAuthApp,
  isOAuthProvider,
  OAUTH_PROVIDERS,
} from "../services/integrations/oauthApp.service.js";
import { OAuthAppConfig } from "../models/index.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";
import {
  verifyPaddleSignature,
  verifyStripeSignature,
  handlePaddleSubscriptionEvent,
  handleStripeSubscriptionEvent,
  type ReceiverConnection,
} from "../services/integrations/webhookReceiver.js";

const router = Router();

// Resolve the credential blob for a connection's ACTIVE environment. Per-connection
// config that differs between sandbox and live — Paddle plan→price-id maps, webhook
// endpoints — is stored in the env-specific slot. Reading the env slot (not the
// last-written `encryptedCredentials` mirror) is what makes the config the operator
// sees, and the config the tools actually run against, the SAME environment. A prior
// bug read the mirror everywhere: configuring plans in sandbox then switching the
// connection to production left the production slot with no planPrices, so every
// upgrade/downgrade failed with "no plans configured" even though the UI still showed
// the sandbox plans.
type ConnCredsShape = {
  sandbox?: boolean;
  encryptedCredentials?: unknown;
  sandboxCredentials?: unknown;
  productionCredentials?: unknown;
};
function activeCredsBlob(conn: ConnCredsShape): Parameters<typeof decrypt>[0] | undefined {
  const slot = conn.sandbox ? conn.sandboxCredentials : conn.productionCredentials;
  return (slot ?? conn.encryptedCredentials) as Parameters<typeof decrypt>[0] | undefined;
}

// A broad, routing-friendly default description for a webhook tool, derived from its
// snake_case key, used when the operator doesn't supply one. The description is AI-facing
// (it drives tool SELECTION), and deliberately broad — narrow phrasing ("Looks up the
// customer's order.") made the model skip the tool for slightly different wording, so a
// tool like `shipment_details` gets "Handles any shipment details related customer
// queries." Mirrors the dashboard's client-side helper.
function webhookToolDefaultDescription(key: string): string {
  const words = String(key ?? "").replace(/[_-]+/g, " ").trim().toLowerCase();
  if (!words) return "";
  return `Handles any ${words} related customer queries.`;
}

// Guardrail defaults seeded when a tool definition is FIRST created. Subscription-CHANGE
// tools start with email-OTP identity verification ON — a self-asserted contact email
// alone isn't proof of account ownership. Operators can turn it off per tool in the
// Guardrails editor (stored as an explicit false, which the dispatcher honours).
const OTP_DEFAULT_ON_KEYS = new Set([
  "upgrade_subscription", "downgrade_subscription", "cancel_subscription", "issue_refund", "refund_payment",
]);
function seededGuardrails(key: string): Record<string, unknown> {
  return OTP_DEFAULT_ON_KEYS.has(key) ? { guardrails: { requireIdentityVerification: true } } : {};
}

// A catalog price row (provider-agnostic) used to pre-fill the plan→price-id mapping.
type CatalogPrice = { priceId: string; name: string; interval: string; productId: string; productName: string };

// Group recurring prices into a suggested plan→price-id map, keyed by the product name
// (falling back to the price name minus a trailing "monthly"/"yearly"). Shared by the
// Paddle and Stripe catalog endpoints.
function suggestPlanPrices(prices: CatalogPrice[]): Record<string, { monthly?: string; yearly?: string }> {
  const suggested: Record<string, { monthly?: string; yearly?: string }> = {};
  for (const p of prices) {
    if (p.interval === "one_time") continue;
    const base = (p.productName || p.name.replace(/\b(monthly|yearly|annual|month|year)\b/gi, "")).trim().toLowerCase();
    if (!base) continue;
    const entry = (suggested[base] ??= {});
    if (p.interval === "year") entry.yearly ??= p.priceId;
    else entry.monthly ??= p.priceId;
  }
  return suggested;
}

// A real JSON Schema is an object with `type:"object"` and a `properties` map.
function isJsonObjectSchema(v: unknown): v is { type: "object"; properties: Record<string, unknown> } {
  return (
    !!v && typeof v === "object" &&
    (v as { type?: unknown }).type === "object" &&
    typeof (v as { properties?: unknown }).properties === "object" &&
    (v as { properties?: unknown }).properties !== null
  );
}

// Operators frequently paste a SAMPLE payload (e.g. {"orderId":"ORD-12345","reason":"lost"})
// where a JSON Schema is expected. Storing that verbatim gives the tool no usable
// `properties`, so no inline form renders and the model dispatches with guessed args.
// Infer a real object schema from the sample instead: each key becomes a required,
// typed property. The result is what the widget's form builder and the webhook adapter's
// validator consume — so the tool's inputs are surfaced and enforced, not hallucinated.
function jsonTypeOf(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  if (typeof v === "boolean") return "boolean";
  if (Array.isArray(v)) return "array";
  if (v && typeof v === "object") return "object";
  return "string";
}
function inferSchemaFromSample(sample: Record<string, unknown>): {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required: string[];
} {
  const properties: Record<string, { type: string; description?: string }> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(sample)) {
    properties[key] = { type: jsonTypeOf(value) };
    required.push(key);
  }
  return { type: "object", properties, required };
}

// Normalise whatever the operator submitted as a webhook tool's input schema into a
// genuine object schema: pass a real schema through, infer one from a non-empty sample
// object, else fall back to an empty (loose-args) schema so a bad definition can never
// 400 the chat request.
function normalizeWebhookInputSchema(input: unknown): Record<string, unknown> {
  if (isJsonObjectSchema(input)) return input as Record<string, unknown>;
  if (input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).length > 0) {
    return inferSchemaFromSample(input as Record<string, unknown>);
  }
  return { type: "object", properties: {}, required: [] };
}

// ---- GET /integrations ---- list providers catalog + installed connections
router.get("/", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const orgId = req.orgId;

  const [connections, adapters, agents, toolDefs, oauthApps] = await Promise.all([
    Connection.find({ organizationId: orgId }).lean(),
    Promise.resolve(listAdapters()),
    Agent.find({ organizationId: orgId }, { _id: 1, name: 1 }).lean(),
    ToolDefinition.find(
      { organizationId: orgId },
      { connectionId: 1, enabledAgentIds: 1, key: 1, displayName: 1, description: 1, guardrails: 1 },
    ).lean(),
    OAuthAppConfig.find({ organizationId: orgId }, { provider: 1, sandbox: 1, clientId: 1 }).lean(),
  ]);
  // Which OAuth providers this org has configured an app for, PER environment.
  const oauthAppEnv = new Map<string, { sandbox: boolean; production: boolean }>();
  for (const a of oauthApps) {
    if (!a.clientId) continue;
    const cur = oauthAppEnv.get(a.provider) ?? { sandbox: false, production: false };
    if (a.sandbox) cur.sandbox = true;
    else cur.production = true;
    oauthAppEnv.set(a.provider, cur);
  }

  // Map connectionId → union of enabledAgentIds across its tools
  const enabledByConn = new Map<string, Set<string>>();
  // Map connectionId → its tool definitions (with guardrails + registry fields).
  const toolsByConn = new Map<
    string,
    { _id: string; key: string; displayName: string; description: string; enabledAgentIds: string[]; guardrails: unknown }[]
  >();
  for (const td of toolDefs) {
    const key = String(td.connectionId);
    if (!enabledByConn.has(key)) enabledByConn.set(key, new Set());
    for (const id of td.enabledAgentIds ?? []) enabledByConn.get(key)!.add(String(id));
    if (!toolsByConn.has(key)) toolsByConn.set(key, []);
    toolsByConn.get(key)!.push({
      _id: String(td._id),
      key: td.key as string,
      displayName: td.displayName as string,
      description: (td.description as string) ?? "",
      enabledAgentIds: (td.enabledAgentIds ?? []).map((id) => String(id)),
      guardrails: td.guardrails ?? {},
    });
  }

  // For custom webhooks, surface the active environment's endpoint config so the
  // dashboard can pre-fill the edit form. The auth VALUE is a secret and is never
  // returned — only whether one is set (hasAuthValue) so the UI can show a
  // "leave blank to keep current" hint.
  const webhookConfigOf = (conn: (typeof connections)[number]): {
    url?: string; method?: string; authHeader?: string; hasAuthValue: boolean; inputSchema?: unknown;
  } | undefined => {
    const blob = activeCredsBlob(conn);
    if (conn.provider !== "webhook" || !blob) return undefined;
    try {
      const creds = JSON.parse(
        decrypt(blob),
      ) as { extra?: { url?: string; method?: string; authHeader?: string; authValue?: string; inputSchema?: unknown } };
      const extra = creds.extra ?? {};
      return {
        url: extra.url,
        method: extra.method ?? "POST",
        authHeader: extra.authHeader,
        hasAuthValue: Boolean(extra.authValue),
        inputSchema: extra.inputSchema,
      };
    } catch {
      return undefined;
    }
  };

  // The operator's own Paddle/Stripe plan → price-id mapping for the active env (non-secret;
  // powers the "Configure plans" form). The api key in the same blob is never returned.
  const paddlePlansOf = (conn: (typeof connections)[number]): Record<string, { monthly?: string; yearly?: string }> | undefined => {
    const blob = activeCredsBlob(conn);
    if ((conn.provider !== "paddle" && conn.provider !== "stripe") || !blob) return undefined;
    try {
      const creds = JSON.parse(
        decrypt(blob),
      ) as { extra?: { planPrices?: Record<string, { monthly?: string; yearly?: string }> } };
      return creds.extra?.planPrices ?? {};
    } catch {
      return {};
    }
  };

  // For Paddle/Stripe connections, surface the inbound-webhook callback URL the
  // operator registers in their provider dashboard, and whether a per-connection signing
  // secret is stored (the secret itself is never returned).
  const webhookReceiverOf = (conn: (typeof connections)[number]): { callbackUrl: string; hasWebhookSecret: boolean } | undefined => {
    if (conn.provider !== "paddle" && conn.provider !== "stripe") return undefined;
    let hasWebhookSecret = false;
    const blob = activeCredsBlob(conn);
    if (blob) {
      try {
        const creds = JSON.parse(decrypt(blob)) as { extra?: { webhookSecret?: string } };
        hasWebhookSecret = Boolean(creds.extra?.webhookSecret);
      } catch {
        /* unreadable → treat as unset */
      }
    }
    return {
      callbackUrl: `${env.apiBaseUrl}/api/v1/integrations/${conn.provider}/webhook/${conn._id}`,
      hasWebhookSecret,
    };
  };

  const connCard = (conn: (typeof connections)[number]) => ({
    _id: conn._id,
    name: conn.name,
    description: conn.description ?? "",
    status: conn.status,
    sandbox: conn.sandbox,
    authMode: conn.authMode,
    // Which environments have credentials stored (for the environment switcher).
    hasSandboxCreds: Boolean((conn as { sandboxCredentials?: unknown }).sandboxCredentials),
    hasProductionCreds: Boolean((conn as { productionCredentials?: unknown }).productionCredentials),
    rateLimitPerSession: conn.rateLimitPerSession ?? 10,
    rateLimitPerConnection: conn.rateLimitPerConnection ?? 0,
    rateLimitWindowMs: conn.rateLimitWindowMs ?? 60_000,
    enabledAgentIds: [...(enabledByConn.get(String(conn._id)) ?? [])],
    toolDefs: toolsByConn.get(String(conn._id)) ?? [],
    webhookConfig: webhookConfigOf(conn),
    paddlePlans: paddlePlansOf(conn),
    webhookReceiver: webhookReceiverOf(conn),
  });

  const providers = adapters.flatMap((a) => {
    const staticTools = a.getTools().map((t) => ({ key: t.key, displayName: t.displayName, description: t.description }));
    // Webhook is a multi-instance connector: each connection is its own tool, so
    // emit one card per existing webhook connection plus a blank card to add more.
    // (Other providers are single-connection, keyed by their provider name.)
    if (a.provider === "webhook") {
      const webhookConns = connections.filter((c) => c.provider === "webhook" && c.status !== "revoked");
      const cards: {
        provider: string;
        cardId: string;
        tools: typeof staticTools;
        connection: ReturnType<typeof connCard> | null;
      }[] = webhookConns.map((conn) => ({
        provider: "webhook",
        cardId: String(conn._id),
        tools: staticTools,
        connection: connCard(conn),
      }));
      cards.push({ provider: "webhook", cardId: "webhook-new", tools: staticTools, connection: null });
      return cards;
    }
    const conn = connections.find((c) => c.provider === a.provider && c.status !== "revoked");
    return [{
      provider: a.provider,
      cardId: a.provider,
      tools: staticTools,
      connection: conn ? connCard(conn) : null,
      // OAuth providers need the operator's own app (client_id/secret) configured
      // before they can connect — the UI shows a "Configure OAuth app" step first.
      isOAuth: isOAuthProvider(a.provider),
      // Per-environment: which of sandbox/production have an OAuth app configured.
      oauthAppConfigured: oauthAppEnv.get(a.provider) ?? { sandbox: false, production: false },
    }];
  });

  res.json({
    providers,
    agents: agents.map((a) => ({ _id: String(a._id), name: a.name as string })),
  });
});

// ---- GET /integrations/jira/projects ---- real Jira projects for the pick-list
// Powers the agent editor's project dropdown so operators can only choose a
// project that actually exists (free-text let them save e.g. "PTKA" when only
// "KAN" exists, which failed ticket creation).
router.get("/jira/projects", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const conn = await Connection.findOne({ organizationId: req.orgId, provider: "jira", status: "active" });
  if (!conn) {
    // Jira is only "connected" per-environment; the active env may be the one that
    // has no credentials (the operator selected it deliberately — see 2a).
    res.json({ projects: [], reason: "not_connected" });
    return;
  }
  const adapter = getAdapter("jira") as {
    listProjects?: (creds: unknown) => Promise<{ key: string; name: string }[]>;
    refreshTokens?: (blob: unknown, app?: unknown) => Promise<unknown>;
  } | undefined;
  if (!adapter?.listProjects) {
    res.json({ projects: [] });
    return;
  }

  const appCreds = await getOAuthAppCreds(req.orgId!, "jira", Boolean(conn.sandbox));
  // Read the ACTIVE environment's credential slot (matching the dispatcher and the
  // 2a graceful-fail design), not just the `encryptedCredentials` mirror which can be
  // stale after an environment switch. Fall back to the mirror for legacy connections
  // whose per-env slots were never populated.
  const activeSlotKey = conn.sandbox ? "sandboxCredentials" : "productionCredentials";
  const activeBlob =
    (conn.sandbox ? conn.sandboxCredentials : conn.productionCredentials) ??
    conn.encryptedCredentials;
  // Refresh the access token and persist the new blob to BOTH the active env slot and
  // the mirror; returns the fresh creds or null when refresh isn't possible (no
  // refresh token / no client secret configured).
  const refresh = async (): Promise<{ expiresAt?: number } | null> => {
    if (!adapter.refreshTokens) return null;
    const refreshed = await adapter.refreshTokens(
      activeBlob as Parameters<typeof decrypt>[0],
      appCreds,
    );
    if (!refreshed) return null;
    const enc = encrypt(JSON.stringify(refreshed));
    await Connection.updateOne(
      { _id: conn._id },
      { $set: { encryptedCredentials: enc, [activeSlotKey]: enc } },
    );
    return refreshed as { expiresAt?: number };
  };

  try {
    let creds = JSON.parse(decrypt(activeBlob as Parameters<typeof decrypt>[0])) as {
      expiresAt?: number;
    };
    // Jira OAuth tokens expire (~1h) — proactively refresh if within 5 min of expiry.
    if (creds.expiresAt && creds.expiresAt - Date.now() / 1000 < 300) {
      const r = await refresh();
      if (r) creds = r;
    }
    try {
      const projects = await adapter.listProjects(creds);
      res.json({ projects, ...(projects.length === 0 ? { reason: "empty" } : {}) });
    } catch (inner) {
      const msg = (inner as Error).message;
      // Stale/invalid token — try a single refresh + retry before giving up.
      if (msg === "jira_unauthorized") {
        const r = await refresh();
        if (r) {
          const projects = await adapter.listProjects(r);
          res.json({ projects, ...(projects.length === 0 ? { reason: "empty" } : {}) });
          return;
        }
        res.json({ projects: [], reason: "reconnect_required" });
        return;
      }
      if (msg === "jira_missing_cloud_id") {
        res.json({ projects: [], reason: "reconnect_required" });
        return;
      }
      if (msg === "jira_forbidden") {
        res.json({ projects: [], reason: "missing_permission" });
        return;
      }
      throw inner;
    }
  } catch (err) {
    logger.warn("[integrations] jira project list failed", { err: (err as Error).message });
    res.json({ projects: [], reason: "error" });
  }
});

// ---- POST /integrations/:provider/connect ---- start OAuth or store API key
router.post("/:provider/connect", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const orgId = req.orgId;
  const provider = String(req.params.provider);
  const {
    apiKey, name, sandbox = true, webhookUrl, authHeader, authValue,
    webhookMethod, toolKey, toolName, toolDescription, inputSchema,
  } = req.body as {
    apiKey?: string; name?: string; sandbox?: boolean; webhookUrl?: string;
    authHeader?: string; authValue?: string; webhookMethod?: string;
    toolKey?: string; toolName?: string; toolDescription?: string;
    inputSchema?: Record<string, unknown>;
  };

  const adapter = getAdapter(provider);
  if (!adapter) {
    res.status(400).json({ error: `Unknown provider: ${provider}` });
    return;
  }

  // Custom webhook connector: operator pastes an endpoint + auth + JSON schema
  // describing the tool's inputs. We store the endpoint config in credentials and
  // create a ToolDefinition (getTools() is empty for webhooks — tools are dynamic).
  if (provider === "webhook" && webhookUrl) {
    if (!toolKey || !/^[a-z][a-z0-9_]*$/.test(String(toolKey))) {
      res.status(400).json({ error: "A tool key (lowercase snake_case, e.g. lookup_order) is required." });
      return;
    }
    // Accept a genuine JSON Schema as-is; if the operator pasted a sample payload
    // (e.g. {"orderId":"ORD-12345"}) instead, infer a real object schema from it so
    // the inline form still renders and the inputs are validated (not guessed). A
    // truly unusable value falls back to an empty object schema so a bad definition
    // can never 400 the whole tools array at chat time.
    const schema = normalizeWebhookInputSchema(inputSchema);
    const credentials = {
      extra: {
        url: String(webhookUrl),
        method: webhookMethod ? String(webhookMethod).toUpperCase() : "POST",
        authHeader: authHeader ? String(authHeader) : undefined,
        authValue: authValue ? String(authValue) : undefined,
        inputSchema: schema,
      },
    };
    // Webhooks are environment-aware too: the endpoint the operator just entered is
    // stored in its environment's slot so they can add a separate sandbox/production
    // endpoint later and switch between them (see the /webhook-endpoint route).
    const whSandbox = Boolean(sandbox);
    const whEncrypted = encrypt(JSON.stringify(credentials));
    const conn = await Connection.create({
      organizationId: orgId,
      provider,
      name: String(name ?? toolName ?? "Custom Webhook"),
      authMode: "webhook",
      status: "active",
      sandbox: whSandbox,
      encryptedCredentials: whEncrypted,
      ...(whSandbox ? { sandboxCredentials: whEncrypted } : { productionCredentials: whEncrypted }),
      scopes: [],
      createdBy: req.auth!.userId,
    });
    // If this exact webhook (same tool key) was previously connected and then
    // revoked, carry its per-agent enablement onto the new connection so the
    // re-added "exact" connection works immediately instead of silently starting
    // disabled. Only inherit from a now-inactive (revoked) tool def.
    const priorToolDef = await ToolDefinition.findOne(
      { organizationId: orgId, key: String(toolKey), isActive: false },
      { enabledAgentIds: 1 },
    )
      .sort({ updatedAt: -1 })
      .lean();
    // A brand-new webhook tool starts enabled on NO agent — the operator picks which
    // agents may use it (per-agent enablement in the UI), and each agent only sees the
    // tools enabled for it. The one exception is re-adding a previously revoked webhook
    // (same tool key): carry its prior enablement forward so the "exact" re-add works
    // immediately instead of silently starting disabled.
    const inheritedAgentIds = (priorToolDef?.enabledAgentIds ?? []) as unknown[];
    await ToolDefinition.updateOne(
      { connectionId: conn._id, key: String(toolKey) },
      {
        $setOnInsert: {
          connectionId: conn._id,
          organizationId: orgId,
          key: String(toolKey),
          displayName: String(toolName ?? toolKey),
          description: String(toolDescription ?? "").trim() || webhookToolDefaultDescription(String(toolKey)),
          jsonSchema: schema,
          isActive: true,
          enabledAgentIds: inheritedAgentIds,
        },
      },
      { upsert: true },
    );
    res.json({ connection: { _id: conn._id, name: conn.name, status: conn.status } });
    return;
  }

  // API key / webhook auth mode — store immediately
  if (apiKey || webhookUrl) {
    const credentials = apiKey
      ? { apiKey: String(apiKey) }
      : { url: String(webhookUrl), authHeader: authHeader ? String(authHeader) : undefined, authValue: authValue ? String(authValue) : undefined };

    const authMode = apiKey ? "api_key" : "webhook";

    // Verify the API key against the real provider before marking connected, so a
    // wrong/expired key (or a sandbox key on production) surfaces here instead of
    // silently failing on the first customer tool call.
    if (apiKey && typeof (adapter as { verifyCredentials?: unknown }).verifyCredentials === "function") {
      const check = await (adapter as {
        verifyCredentials: (c: unknown, s: boolean) => Promise<{ ok: boolean; error?: string }>;
      }).verifyCredentials(credentials, Boolean(sandbox));
      if (!check.ok) {
        res.status(400).json({ error: check.error ?? "Could not verify the API key with the provider." });
        return;
      }
    }

    const encrypted = encrypt(JSON.stringify(credentials));
    const isSandbox = Boolean(sandbox);

    // Dual-environment: an operator can connect BOTH a sandbox and a production
    // key for the same provider. Store the key in its environment slot; if a
    // connection already exists (e.g. they're now adding the OTHER environment),
    // update that one instead of creating a duplicate, and make the just-entered
    // environment the active one.
    if (apiKey) {
      const existing = await Connection.findOne({ organizationId: orgId, provider });
      if (existing) {
        existing.encryptedCredentials = encrypted;
        if (isSandbox) existing.sandboxCredentials = encrypted as never;
        else existing.productionCredentials = encrypted as never;
        existing.sandbox = isSandbox;
        existing.status = "active";
        if (name) existing.name = String(name);
        await existing.save();
        res.json({
          connection: { _id: existing._id, name: existing.name, status: existing.status },
          environment: isSandbox ? "sandbox" : "production",
        });
        return;
      }
    }

    const conn = await Connection.create({
      organizationId: orgId,
      provider,
      name: String(name ?? provider),
      authMode,
      status: "active",
      sandbox: isSandbox,
      encryptedCredentials: encrypted,
      ...(apiKey ? (isSandbox ? { sandboxCredentials: encrypted } : { productionCredentials: encrypted }) : {}),
      scopes: [],
      createdBy: req.auth!.userId,
    });

    // Seed tool definitions from adapter. Tools start DISABLED for every agent —
    // the operator wires the connection once here, then explicitly toggles it on
    // per-agent in AI agent settings (enabledAgentIds defaults to []).
    const tools = adapter.getTools();
    await Promise.all(
      tools.map((t) =>
        ToolDefinition.updateOne(
          { connectionId: conn._id, key: t.key },
          {
            // isActive lives in $set (not $setOnInsert) so RE-connecting an existing
            // connection reactivates its tools. Disconnecting sets them isActive:false;
            // without this, a reconnect would revive the connection but leave the tools
            // inactive → the AI is never offered them ("I'm unable to file a ticket").
            $set: { isActive: true },
            $setOnInsert: {
              connectionId: conn._id,
              organizationId: orgId,
              ...t,
              enabledAgentIds: [],
              // Subscription-change tools are seeded with OTP verification ON.
              ...seededGuardrails(t.key),
            },
          },
          { upsert: true },
        ),
      ),
    );

    res.json({ connection: { _id: conn._id, name: conn.name, status: conn.status } });
    return;
  }

  // OAuth mode — return redirect URL. The operator must have configured their own
  // OAuth app (client_id/secret) for THIS environment first — there are no platform-wide
  // OAuth credentials in the environment anymore.
  const appCreds = await getOAuthAppCreds(orgId!, provider, Boolean(sandbox));
  if (!appCreds?.clientId) {
    res.status(400).json({
      error: `Configure your ${provider} OAuth app (Client ID + Secret) for ${Boolean(sandbox) ? "sandbox" : "production"} before connecting.`,
      needsOAuthApp: true,
    });
    return;
  }
  // Encode orgId AND the target environment into the state so the callback can
  // identify the org (OAuth redirects carry no JWT) and store the tokens in the
  // right per-environment slot. Format: "<orgId>.<nonce>.<s|p>".
  const nonce = randomBytes(16).toString("hex");
  const envCode = Boolean(sandbox) ? "s" : "p";
  const state = `${String(orgId)}.${nonce}.${envCode}`;
  const authUrl = adapter.buildAuthUrl(String(orgId), state, appCreds);
  if (!authUrl) {
    res.status(400).json({ error: `Provider ${provider} does not support OAuth. Use apiKey instead.` });
    return;
  }

  res.json({ authUrl, state });
});

// ---- GET /integrations/:provider/oauth-app?environment=sandbox|production ----
// Read this org's OAuth app config for one environment. Returns the (public) client_id
// + whether a secret is stored — never the secret. Sandbox and production are separate
// apps, so the modal reads/writes one environment at a time.
router.get("/:provider/oauth-app", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const provider = String(req.params.provider);
  if (!isOAuthProvider(provider)) {
    res.status(400).json({ error: `${provider} is not an OAuth provider.` });
    return;
  }
  const sandbox = req.query.environment === "sandbox";
  const cfg = await OAuthAppConfig.findOne({ organizationId: req.orgId, provider, sandbox }).lean();
  res.json({
    environment: sandbox ? "sandbox" : "production",
    configured: Boolean(cfg?.clientId),
    clientId: cfg?.clientId ?? "",
    hasSecret: Boolean(cfg?.encryptedClientSecret),
    redirectUri: cfg?.redirectUri ?? "",
    extra: (cfg?.extra as Record<string, unknown> | undefined) ?? {},
    // The redirect URI the operator must register with the provider.
    defaultRedirectUri: `${env.apiBaseUrl}/api/v1/integrations/${provider}/callback`,
  });
});

// ---- PUT /integrations/:provider/oauth-app ---- save this org's OAuth app config for
// one environment (`sandbox` in the body). The operator brings their own registered
// OAuth app; the client_secret is encrypted at rest. A blank secret keeps the stored
// one (so they can edit the id/redirect only).
router.put("/:provider/oauth-app", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const provider = String(req.params.provider);
  if (!isOAuthProvider(provider)) {
    res.status(400).json({ error: `${provider} is not an OAuth provider.` });
    return;
  }
  const { clientId, clientSecret, redirectUri, extra, sandbox } = req.body as {
    clientId?: string; clientSecret?: string; redirectUri?: string; extra?: Record<string, unknown>; sandbox?: boolean;
  };
  const isSandbox = Boolean(sandbox);
  if (!clientId || !String(clientId).trim()) {
    res.status(400).json({ error: "A Client ID is required." });
    return;
  }
  // The Client ID is the only required value — a secret is optional (stored + used
  // as the confidential-client secret only when the operator provides one).
  await saveOAuthApp(
    req.orgId!,
    provider,
    isSandbox,
    {
      clientId: String(clientId),
      clientSecret: String(clientSecret ?? ""),
      redirectUri: typeof redirectUri === "string" ? redirectUri : undefined,
      extra: extra && typeof extra === "object" ? extra : undefined,
    },
    req.auth!.userId,
  );
  res.json({ ok: true });
});

// ---- GET /integrations/:provider/callback ---- OAuth code exchange
// This route is called by the OAuth provider as a browser redirect — there is
// no Authorization header. The orgId is extracted from the `state` param that
// was embedded during the connect flow.
router.get("/:provider/callback", async (req: Request, res: Response) => {
  const provider = String(req.params.provider);
  const code = String(req.query.code ?? "");
  const rawState = String(req.query.state ?? "");

  // state format: "<orgId>.<nonce>.<s|p>" (env code optional for legacy states).
  const parts = rawState.split(".");
  const orgId = parts[0] || null;
  // Which environment the operator chose to connect. Legacy states without the
  // env code default to production (matching the old sandbox:false behaviour).
  const isSandbox = parts[2] === "s";

  if (!orgId) {
    res.status(400).send("Invalid OAuth state — missing orgId.");
    return;
  }

  const adapter = getAdapter(provider);
  if (!adapter) {
    res.status(400).send(`Unknown provider: ${provider}`);
    return;
  }

  const appCreds = await getOAuthAppCreds(orgId, provider, isSandbox);
  let rawCreds: import("../services/integrations/providers/types.js").RawCredentials;
  try {
    rawCreds = await adapter.exchangeCode(code, orgId, appCreds);
  } catch (err) {
    logger.error("[integrations] OAuth code exchange failed", { provider, err: (err as Error).message });
    res.status(400).send("OAuth code exchange failed. Please try connecting again.");
    return;
  }

  const encrypted = encrypt(JSON.stringify(rawCreds));
  const expiresAt = rawCreds.expiresAt ? new Date(rawCreds.expiresAt * 1000) : undefined;

  // Store the tokens in the chosen environment's slot AND make that environment
  // active (encryptedCredentials + sandbox flag). A second OAuth connect for the
  // OTHER environment updates the same connection, filling its other slot — so an
  // operator can hold both a sandbox and a production OAuth token and switch.
  const slot = isSandbox ? "sandboxCredentials" : "productionCredentials";
  const conn = await Connection.findOneAndUpdate(
    { organizationId: orgId, provider, authMode: "oauth" },
    {
      $set: {
        encryptedCredentials: encrypted,
        [slot]: encrypted,
        sandbox: isSandbox,
        status: "active",
        ...(expiresAt ? { expiresAt } : {}),
      },
      $setOnInsert: {
        name: provider,
        authMode: "oauth",
        scopes: rawCreds.extra?.scopes ?? [],
      },
    },
    { upsert: true, new: true },
  );

  // Seed tool definitions — disabled for every agent by default. The operator
  // enables them per-agent in AI agent settings (enabledAgentIds defaults to []).
  const tools = adapter.getTools();
  await Promise.all(
    tools.map((t) =>
      ToolDefinition.updateOne(
        { connectionId: conn!._id, key: t.key },
        {
          // isActive in $set so re-connecting (OAuth re-auth) reactivates existing
          // tools — a disconnect set them isActive:false and $setOnInsert alone would
          // never flip them back, leaving the AI without the tool after a reconnect.
          $set: { isActive: true },
          $setOnInsert: {
            connectionId: conn!._id,
            organizationId: orgId,
            ...t,
            enabledAgentIds: [],
            // Subscription-change tools are seeded with OTP verification ON.
            ...seededGuardrails(t.key),
          },
        },
        { upsert: true },
      ),
    ),
  );

  // Redirect back to the integrations page — the same-page OAuth flow means
  // there is no popup to close; the browser simply follows the redirect chain.
  res.redirect(`${env.webBaseUrl}/app/integrations`);
});

// ---- PATCH /integrations/tools/:toolDefId/guardrails ---- set per-tool guardrails
// Operator-defined limits enforced server-side by the dispatcher (see guardrails.ts).
router.patch("/tools/:toolDefId/guardrails", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const orgId = req.orgId;
  const {
    maxAmount, maxDaysSincePurchase, requireIdentityVerification, allowedContactEmails,
    businessHoursStart, businessHoursEnd, businessDays, businessHoursTz,
    requireNamedAttendee,
  } = req.body as Record<string, unknown>;

  const guardrails: Record<string, unknown> = {};
  const num = (v: unknown) => (v !== undefined && v !== null && v !== "" ? Number(v) : undefined);
  if (num(maxAmount) !== undefined) guardrails.maxAmount = num(maxAmount);
  if (num(maxDaysSincePurchase) !== undefined) guardrails.maxDaysSincePurchase = num(maxDaysSincePurchase);
  guardrails.requireIdentityVerification = Boolean(requireIdentityVerification);
  if (Array.isArray(allowedContactEmails)) {
    guardrails.allowedContactEmails = allowedContactEmails
      .map((e) => String(e).trim().toLowerCase())
      .filter(Boolean);
  }
  // Booking window (book_meeting). "HH:MM" 24h in businessHoursTz; days 0=Sun..6=Sat.
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (typeof businessHoursStart === "string" && hhmm.test(businessHoursStart)) guardrails.businessHoursStart = businessHoursStart;
  if (typeof businessHoursEnd === "string" && hhmm.test(businessHoursEnd)) guardrails.businessHoursEnd = businessHoursEnd;
  if (Array.isArray(businessDays)) {
    guardrails.businessDays = businessDays.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6);
  }
  if (typeof businessHoursTz === "string" && businessHoursTz.trim()) guardrails.businessHoursTz = businessHoursTz.trim();
  guardrails.requireNamedAttendee = Boolean(requireNamedAttendee);
  // requireBillingOwner is no longer accepted from the client — it's enforced in code
  // (see guardrails.ts ALWAYS_BILLING_OWNER) for subscription/refund tools.

  const result = await ToolDefinition.updateOne(
    { _id: req.params.toolDefId, organizationId: orgId },
    { $set: { guardrails } },
  );
  if (result.matchedCount === 0) {
    res.status(404).json({ error: "Tool not found." });
    return;
  }
  res.json({ ok: true });
});

// ---- PATCH /integrations/tools/:toolDefId/registry ---- rename a tool, give it a
// custom description (fed to the AI so it calls the right tool), and choose which
// agents can access it.
router.patch("/tools/:toolDefId/registry", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const { displayName, description, enabledAgentIds } = req.body as Record<string, unknown>;
  const $set: Record<string, unknown> = {};
  if (typeof displayName === "string" && displayName.trim()) $set.displayName = displayName.trim().slice(0, 100);
  if (typeof description === "string" && description.trim()) $set.description = description.trim().slice(0, 500);
  if (Array.isArray(enabledAgentIds)) {
    $set.enabledAgentIds = enabledAgentIds
      .filter((id) => typeof id === "string" && /^[a-f0-9]{24}$/i.test(id));
  }
  if (Object.keys($set).length === 0) {
    res.status(400).json({ error: "Nothing to update." });
    return;
  }
  const result = await ToolDefinition.updateOne(
    { _id: req.params.toolDefId, organizationId: req.orgId },
    { $set },
  );
  if (result.matchedCount === 0) {
    res.status(404).json({ error: "Tool not found." });
    return;
  }
  res.json({ ok: true });
});

// ---- PATCH /integrations/:connectionId ---- update name/sandbox/enabledAgentIds
router.patch("/:connectionId", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const orgId = req.orgId;
  const { name, description, sandbox, enabledAgentIds, rateLimitPerSession, rateLimitPerConnection, rateLimitWindowMs } =
    req.body as Record<string, unknown>;

  const $set: Record<string, unknown> = {};
  if (name !== undefined) $set.name = String(name);
  if (description !== undefined) $set.description = String(description);

  // Environment switch: flipping the sandbox flag swaps in that environment's
  // stored credentials. If the target environment was never connected, tell the
  // UI so it can prompt the operator to add that key (needsSetup) — this avoids
  // the classic failure of running a sandbox key against production (or vice-versa).
  if (sandbox !== undefined) {
    const wantSandbox = Boolean(sandbox);
    const conn = await Connection.findOne({ _id: req.params.connectionId, organizationId: orgId }).lean();
    if (!conn) {
      res.status(404).json({ error: "Connection not found." });
      return;
    }
    // api-key, OAuth AND webhook connections all store per-environment credentials
    // now, so switching environments swaps the active slot for any of them.
    if (conn.authMode === "api_key" || conn.authMode === "oauth" || conn.authMode === "webhook") {
      const c = conn as { sandbox?: boolean; encryptedCredentials?: unknown; sandboxCredentials?: unknown; productionCredentials?: unknown };
      // Backfill the CURRENT environment's slot from the active credentials — for
      // connections created before per-environment storage existed, so switching
      // back later works.
      const curKey = c.sandbox ? "sandboxCredentials" : "productionCredentials";
      if (!c[curKey] && c.encryptedCredentials) {
        $set[curKey] = c.encryptedCredentials;
        c[curKey] = c.encryptedCredentials;
      }
      const targetCreds = wantSandbox ? c.sandboxCredentials : c.productionCredentials;
      if (targetCreds) {
        $set.encryptedCredentials = targetCreds;
      }
      // If the target environment isn't connected we STILL switch to it (persist the
      // choice) so the operator can observe the agent with a disconnected tool — the
      // dispatcher reads the active env's slot, finds it empty, and fails gracefully.
      // We leave `encryptedCredentials` as the (stale) mirror; the dispatcher ignores
      // it when the active env slot is empty.
      if (!targetCreds) {
        const result = await Connection.updateOne(
          { _id: req.params.connectionId, organizationId: orgId },
          { $set: { ...$set, sandbox: wantSandbox } },
        );
        if (result.matchedCount === 0) {
          res.status(404).json({ error: "Connection not found." });
          return;
        }
        res.json({
          ok: true,
          environment: wantSandbox ? "sandbox" : "production",
          connected: false,
          authMode: conn.authMode,
          message: `Switched to ${wantSandbox ? "sandbox" : "production"} — not connected yet, so its tools will report they're unavailable until you connect it.`,
        });
        return;
      }
    }
    $set.sandbox = wantSandbox;
  }
  // Per-connection rate limits (0 / blank = keep default). Clamp to sane bounds.
  const clampInt = (v: unknown, min: number, max: number) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
  };
  if (rateLimitPerSession !== undefined && rateLimitPerSession !== "") {
    const n = clampInt(rateLimitPerSession, 1, 1000);
    if (n !== undefined) $set.rateLimitPerSession = n;
  }
  if (rateLimitPerConnection !== undefined && rateLimitPerConnection !== "") {
    const n = clampInt(rateLimitPerConnection, 0, 100000);
    if (n !== undefined) $set.rateLimitPerConnection = n;
  }
  if (rateLimitWindowMs !== undefined && rateLimitWindowMs !== "") {
    const n = clampInt(rateLimitWindowMs, 1000, 3600000);
    if (n !== undefined) $set.rateLimitWindowMs = n;
  }

  // Use updateOne to avoid Mongoose save-time validation on fields not being modified
  const result = await Connection.updateOne(
    { _id: req.params.connectionId, organizationId: orgId },
    { $set },
  );
  if (result.matchedCount === 0) {
    res.status(404).json({ error: "Connection not found." });
    return;
  }

  if (Array.isArray(enabledAgentIds)) {
    await ToolDefinition.updateMany(
      { connectionId: req.params.connectionId },
      { $set: { enabledAgentIds } },
    );
  }

  // For a custom webhook, the connection name/description ARE the tool's display name and
  // AI-facing description (one tool per webhook). Sync them onto the ToolDefinition so
  // "Rename" and "Edit webhook" stay a single value — and so a rename that improves the
  // description also improves the routing signal the model uses.
  if (name !== undefined || description !== undefined) {
    const conn = await Connection.findOne({ _id: req.params.connectionId, organizationId: orgId })
      .select("provider")
      .lean();
    if ((conn as { provider?: string } | null)?.provider === "webhook") {
      const toolSync: Record<string, unknown> = {};
      if (name !== undefined) toolSync.displayName = String(name).slice(0, 100);
      if (description !== undefined) toolSync.description = String(description).slice(0, 500);
      await ToolDefinition.updateMany(
        { connectionId: req.params.connectionId, organizationId: orgId },
        { $set: toolSync },
      );
    }
  }

  res.json({ ok: true });
});

// ---- DELETE /integrations/:connectionId ---- disconnect a connection.
// `?environment=sandbox|production` disconnects JUST that environment (clearing its
// stored credentials and, if it was the active env, promoting the other) so an
// operator can drop e.g. a test account while keeping production live. Without the
// query param — or when only one environment is connected — the whole connection is
// soft-revoked and its tools deactivated.
router.delete("/:connectionId", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const orgId = req.orgId;
  const conn = await Connection.findOne({ _id: req.params.connectionId, organizationId: orgId }).lean();
  if (!conn) {
    res.status(404).json({ error: "Connection not found." });
    return;
  }

  const env = String(req.query.environment ?? "");
  const perEnv = env === "sandbox" || env === "production";
  const isSandbox = env === "sandbox";
  const c = conn as {
    sandbox?: boolean;
    encryptedCredentials?: Parameters<typeof decrypt>[0];
    sandboxCredentials?: Parameters<typeof decrypt>[0];
    productionCredentials?: Parameters<typeof decrypt>[0];
  };
  const otherSlotVal = isSandbox ? c.productionCredentials : c.sandboxCredentials;

  // Per-environment disconnect — only when the OTHER environment is still connected,
  // otherwise dropping this one leaves nothing and we fall through to a full revoke.
  if (perEnv && otherSlotVal) {
    const slot = isSandbox ? "sandboxCredentials" : "productionCredentials";
    const $set: Record<string, unknown> = {};
    if (Boolean(c.sandbox) === isSandbox) {
      // The environment being disconnected is the active one — promote the other so
      // tool calls keep working against the remaining account.
      $set.encryptedCredentials = otherSlotVal;
      $set.sandbox = !isSandbox;
      try {
        const creds = JSON.parse(decrypt(otherSlotVal)) as { expiresAt?: number };
        if (creds.expiresAt) $set.expiresAt = new Date(creds.expiresAt * 1000);
      } catch {
        /* leave expiresAt; the dispatcher refreshes on demand */
      }
    }
    await Connection.updateOne(
      { _id: conn._id },
      { $unset: { [slot]: "" }, ...(Object.keys($set).length ? { $set } : {}) },
    );
    res.json({ ok: true, disconnected: env, remaining: isSandbox ? "production" : "sandbox" });
    return;
  }

  // Full revoke (both environments, or the last remaining one).
  await Connection.updateOne({ _id: conn._id }, { $set: { status: "revoked" } });
  // Deactivate this connection's tool definitions so they are no longer offered to
  // the AI or picked up by the dispatcher. Without this, a re-added "exact" webhook
  // (same tool key, new connection) can still resolve to the revoked connection and
  // fail with "the integration connection has been revoked".
  await ToolDefinition.updateMany(
    { connectionId: conn._id, organizationId: orgId },
    { $set: { isActive: false } },
  );
  res.json({ ok: true });
});

// ---- POST /integrations/:connectionId/webhook-endpoint ---- add/replace the
// endpoint for ONE environment of an existing custom webhook. The tool definition
// (key/name/schema) is shared across environments; only the URL + method + auth
// differ, so this stores just those into the target environment's slot. Adding the
// missing environment is what lets a webhook be switched sandbox<->production.
router.post("/:connectionId/webhook-endpoint", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const { sandbox, webhookUrl, webhookMethod, authHeader, authValue } = req.body as {
    sandbox?: boolean; webhookUrl?: string; webhookMethod?: string; authHeader?: string; authValue?: string;
  };
  if (!webhookUrl) {
    res.status(400).json({ error: "A webhook URL is required." });
    return;
  }
  const conn = await Connection.findOne({
    _id: req.params.connectionId,
    organizationId: req.orgId,
    provider: "webhook",
  });
  if (!conn) {
    res.status(404).json({ error: "Webhook connection not found." });
    return;
  }
  // Preserve the shared input schema from whichever slot already has one.
  let inputSchema: unknown = { type: "object", properties: {}, required: [] };
  try {
    const active = JSON.parse(
      decrypt(conn.encryptedCredentials as Parameters<typeof decrypt>[0]),
    ) as { extra?: { inputSchema?: unknown } };
    if (active.extra?.inputSchema) inputSchema = active.extra.inputSchema;
  } catch {
    /* fall back to the empty schema */
  }
  const credentials = {
    extra: {
      url: String(webhookUrl),
      method: webhookMethod ? String(webhookMethod).toUpperCase() : "POST",
      authHeader: authHeader ? String(authHeader) : undefined,
      authValue: authValue ? String(authValue) : undefined,
      inputSchema,
    },
  };
  const isSandbox = Boolean(sandbox);
  const encrypted = encrypt(JSON.stringify(credentials));
  const slot = isSandbox ? "sandboxCredentials" : "productionCredentials";
  // Store into the target slot AND make it the active environment (the operator is
  // connecting this environment, so switch to it).
  await Connection.updateOne(
    { _id: conn._id },
    { $set: { [slot]: encrypted, encryptedCredentials: encrypted, sandbox: isSandbox, status: "active" } },
  );
  res.json({ ok: true, environment: isSandbox ? "sandbox" : "production" });
});

// ---- PATCH /integrations/:connectionId/webhook-config ---- edit an existing
// custom webhook. Every connection detail is editable here: URL, method, auth
// header/value, the input JSON schema, and the tool's display name/description.
// Applies to the CURRENTLY-active environment. The auth value is a secret — omit
// it (or send blank) to keep the stored one; send a new value to replace it.
router.patch("/:connectionId/webhook-config", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const {
    webhookUrl, webhookMethod, authHeader, authValue, inputSchema, toolName, toolDescription,
  } = req.body as {
    webhookUrl?: string; webhookMethod?: string; authHeader?: string; authValue?: string;
    inputSchema?: Record<string, unknown>; toolName?: string; toolDescription?: string;
  };
  const conn = await Connection.findOne({
    _id: req.params.connectionId,
    organizationId: req.orgId,
    provider: "webhook",
  });
  if (!conn) {
    res.status(404).json({ error: "Webhook connection not found." });
    return;
  }
  if (!webhookUrl || !String(webhookUrl).trim()) {
    res.status(400).json({ error: "A webhook URL is required." });
    return;
  }

  // Read the existing ACTIVE-environment credentials so we can preserve the stored auth
  // value (a secret the client never sees) and the input schema when not being changed.
  // (Reads the env slot, not the `encryptedCredentials` mirror — the mirror can hold the
  // OTHER environment's endpoint after an env switch.)
  let existing: { url?: string; method?: string; authHeader?: string; authValue?: string; inputSchema?: unknown } = {};
  try {
    const parsed = JSON.parse(decrypt(activeCredsBlob(conn)!)) as { extra?: typeof existing };
    existing = parsed.extra ?? {};
  } catch {
    /* start from empty if the current blob can't be read */
  }

  // Same schema handling as the CONNECT route: a genuine JSON Schema passes through, a
  // pasted SAMPLE payload gets a schema inferred from it (so the inline form still
  // renders), and anything unusable keeps the existing schema.
  const schema = isJsonObjectSchema(inputSchema)
    ? inputSchema
    : inputSchema && typeof inputSchema === "object" && !Array.isArray(inputSchema) && Object.keys(inputSchema).length > 0
      ? inferSchemaFromSample(inputSchema as Record<string, unknown>)
      : existing.inputSchema ?? { type: "object", properties: {}, required: [] };

  const credentials = {
    extra: {
      url: String(webhookUrl),
      method: webhookMethod ? String(webhookMethod).toUpperCase() : existing.method ?? "POST",
      // A provided header replaces; an explicitly-blank header clears it.
      authHeader: authHeader !== undefined ? String(authHeader) || undefined : existing.authHeader,
      // A non-empty value replaces the secret; blank/omitted keeps the stored one.
      authValue: authValue ? String(authValue) : existing.authValue,
      inputSchema: schema,
    },
  };
  const isSandbox = Boolean(conn.sandbox);
  const encrypted = encrypt(JSON.stringify(credentials));
  const slot = isSandbox ? "sandboxCredentials" : "productionCredentials";
  const connSet: Record<string, unknown> = { [slot]: encrypted, encryptedCredentials: encrypted };

  // Keep the tool definition in sync: the input schema drives the tool the AI sees,
  // and name/description are how the AI decides when to call it. The webhook's tool
  // def is the (single) one attached to this connection.
  const toolSet: Record<string, unknown> = { jsonSchema: schema };
  if (typeof toolName === "string" && toolName.trim()) {
    const nm = toolName.trim().slice(0, 100);
    toolSet.displayName = nm;
    // Mirror onto the connection name so "Rename" and "Edit webhook" show one value.
    connSet.name = nm;
  }
  if (typeof toolDescription === "string" && toolDescription.trim()) {
    const desc = toolDescription.trim().slice(0, 500);
    toolSet.description = desc;
    connSet.description = desc;
  }
  await Connection.updateOne({ _id: conn._id }, { $set: connSet });
  await ToolDefinition.updateMany(
    { connectionId: conn._id, organizationId: req.orgId },
    { $set: toolSet },
  );

  res.json({ ok: true });
});

// ---- PUT /integrations/:connectionId/paddle-plans ---- the operator's own plan →
// price-id mapping for their Paddle connection (per environment, since sandbox and
// live have different price ids). The integration subscription tools use THIS mapping,
// never the platform's PADDLE_PRICE_* env — those bill operators for this SaaS, whereas
// these tools act on the operator's OWN customers' subscriptions. Stored in the active
// environment's encrypted credential blob; also updates the plan tools' targetPlan enum
// so the AI offers the operator's actual plan names.
// ---- GET /integrations/:connectionId/paddle-catalog ---- read-only list of the
// operator's OWN Paddle/Stripe products/prices for the active environment, plus a suggested
// plan→price-id mapping (grouped by product, monthly/yearly). The "Configure plans" step
// pre-fills from this so operators map their EXISTING plans instead of hand-typing price
// ids — which is what prevents the "no plans configured" failure. Price/product ids are
// integration config, not secrets (they appear in client-side checkout). The path keeps its
// legacy `paddle-catalog` name but serves BOTH billing providers.
router.get("/:connectionId/paddle-catalog", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const conn = await Connection.findOne({
    _id: req.params.connectionId,
    organizationId: req.orgId,
    provider: { $in: ["paddle", "stripe"] },
  }).lean();
  if (!conn) {
    res.status(404).json({ error: "Billing connection not found." });
    return;
  }
  let key = "";
  try {
    const creds = JSON.parse(decrypt(activeCredsBlob(conn)!)) as { apiKey?: string; accessToken?: string };
    key = creds.apiKey ?? creds.accessToken ?? "";
  } catch {
    /* fall through to the no-key error below */
  }
  if (!key) {
    res.status(400).json({ error: "This connection's active environment has no API key." });
    return;
  }
  const label = conn.provider === "stripe" ? "Stripe" : "Paddle";
  try {
    let prices: CatalogPrice[];
    if (conn.provider === "stripe") {
      // Stripe: one call to /prices with the product expanded gives name + interval.
      const headers = { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` };
      const pricesRes = await fetch("https://api.stripe.com/v1/prices?limit=100&active=true&expand[]=data.product", { headers });
      if (!pricesRes.ok) {
        res.status(502).json({ error: `Stripe returned HTTP ${pricesRes.status} listing prices.` });
        return;
      }
      const pricesJson = (await pricesRes.json()) as { data?: Array<Record<string, unknown>> };
      prices = (pricesJson.data ?? []).map((p) => {
        const interval = (p.recurring as { interval?: string } | null | undefined)?.interval;
        const product = p.product as { id?: string; name?: string } | string | undefined;
        const productObj = product && typeof product === "object" ? product : undefined;
        return {
          priceId: String(p.id ?? ""),
          name: String(p.nickname ?? productObj?.name ?? ""),
          interval: interval === "year" ? "year" : interval === "month" ? "month" : "one_time",
          productId: productObj?.id ?? (typeof product === "string" ? product : ""),
          productName: productObj?.name ?? "",
        };
      });
    } else {
      // Paddle: prices + products (two calls; price carries product_id + billing_cycle).
      const baseUrl = conn.sandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
      const headers = { Authorization: `Bearer ${key}` };
      const [pricesRes, productsRes] = await Promise.all([
        fetch(`${baseUrl}/prices?per_page=100&status=active`, { headers }),
        fetch(`${baseUrl}/products?per_page=100&status=active`, { headers }),
      ]);
      if (!pricesRes.ok) {
        res.status(502).json({ error: `Paddle returned HTTP ${pricesRes.status} listing prices.` });
        return;
      }
      const pricesJson = (await pricesRes.json()) as { data?: Array<Record<string, unknown>> };
      const productsJson = (await productsRes.json().catch(() => ({}))) as { data?: Array<{ id?: string; name?: string }> };
      const productName = new Map<string, string>();
      for (const p of productsJson.data ?? []) if (p.id) productName.set(p.id, p.name ?? "");
      prices = (pricesJson.data ?? []).map((p) => {
        const cycle = (p.billing_cycle as { interval?: string } | null | undefined)?.interval;
        const productId = String(p.product_id ?? "");
        return {
          priceId: String(p.id ?? ""),
          name: String(p.name ?? ""),
          interval: cycle === "year" ? "year" : cycle === "month" ? "month" : "one_time",
          productId,
          productName: productName.get(productId) ?? "",
        };
      });
    }
    res.json({ prices, suggested: suggestPlanPrices(prices) });
  } catch (err) {
    res.status(502).json({ error: `Couldn't reach ${label}: ${(err as Error).message}` });
  }
});

router.put("/:connectionId/paddle-plans", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const conn = await Connection.findOne({
    _id: req.params.connectionId,
    organizationId: req.orgId,
    provider: { $in: ["paddle", "stripe"] },
  });
  if (!conn) {
    res.status(404).json({ error: "Billing connection not found." });
    return;
  }
  const raw = (req.body as { planPrices?: Record<string, { monthly?: string; yearly?: string }> }).planPrices;
  if (!raw || typeof raw !== "object") {
    res.status(400).json({ error: "planPrices object is required." });
    return;
  }
  // Normalise: keep only plans with at least one price id; trim values.
  const planPrices: Record<string, { monthly?: string; yearly?: string }> = {};
  for (const [name, ids] of Object.entries(raw)) {
    const plan = String(name).trim().toLowerCase();
    const monthly = typeof ids?.monthly === "string" ? ids.monthly.trim() : "";
    const yearly = typeof ids?.yearly === "string" ? ids.yearly.trim() : "";
    if (!plan || (!monthly && !yearly)) continue;
    planPrices[plan] = { ...(monthly ? { monthly } : {}), ...(yearly ? { yearly } : {}) };
  }

  // Merge into the ACTIVE environment's credential blob (preserves the api key).
  // Read the env-specific slot as the base — NOT the `encryptedCredentials` mirror,
  // which may hold the OTHER environment's api key/config after an env switch. Using
  // the mirror would write planPrices onto the wrong environment's key.
  let creds: { apiKey?: string; extra?: Record<string, unknown> } = {};
  try {
    creds = JSON.parse(decrypt(activeCredsBlob(conn)!));
  } catch {
    /* start from empty if unreadable */
  }
  creds.extra = { ...(creds.extra ?? {}), planPrices };
  const encrypted = encrypt(JSON.stringify(creds));
  const slot = conn.sandbox ? "sandboxCredentials" : "productionCredentials";
  await Connection.updateOne(
    { _id: conn._id },
    { $set: { [slot]: encrypted, encryptedCredentials: encrypted } },
  );

  // Update the upgrade/downgrade tools' targetPlan enum to the operator's plan names.
  const planNames = Object.keys(planPrices);
  if (planNames.length > 0) {
    const defs = await ToolDefinition.find({
      connectionId: conn._id,
      organizationId: req.orgId,
      key: { $in: ["upgrade_subscription", "downgrade_subscription"] },
    });
    for (const def of defs) {
      const schema = (def.jsonSchema as { properties?: { targetPlan?: { enum?: unknown } } }) ?? {};
      if (schema.properties?.targetPlan) {
        schema.properties.targetPlan.enum = planNames;
        def.jsonSchema = schema as typeof def.jsonSchema;
        def.markModified("jsonSchema");
        await def.save();
      }
    }
  }

  res.json({ ok: true, plans: planNames });
});

// ---- POST /integrations/:connectionId/verify ---- re-check a live connection
// Runs the provider's real-connection check against the CURRENTLY stored
// credentials (refreshing an OAuth token first if it's near expiry). This gives
// OAuth connections the same "is this actually working?" check that api-key
// connections get at connect time, and lets an operator re-test any connection.
router.post("/:connectionId/verify", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const conn = await Connection.findOne({ _id: req.params.connectionId, organizationId: req.orgId });
  if (!conn) {
    res.status(404).json({ error: "Connection not found." });
    return;
  }
  const adapter = getAdapter(conn.provider) as {
    verifyCredentials?: (c: unknown, s: boolean) => Promise<{ ok: boolean; error?: string }>;
    refreshTokens?: (
      blob: unknown,
      app?: import("../services/integrations/providers/types.js").OAuthAppCreds | null,
    ) => Promise<import("../services/integrations/providers/types.js").RawCredentials | null>;
  } | undefined;
  if (!adapter?.verifyCredentials) {
    // Nothing to check (e.g. custom webhook) — treat as verified so the UI can
    // still show a consistent "Connected" state.
    res.json({ ok: true, unsupported: true });
    return;
  }
  // Test the environment the operator is VIEWING (sent in the body), not the stale
  // `encryptedCredentials` mirror — otherwise testing production would silently check
  // the active env's (e.g. sandbox's) creds and report a false success. Default to the
  // active env when the body doesn't specify one.
  const bodySandbox = (req.body as { sandbox?: unknown } | undefined)?.sandbox;
  const wantSandbox = typeof bodySandbox === "boolean" ? bodySandbox : Boolean(conn.sandbox);
  const envLabel = wantSandbox ? "sandbox" : "production";
  const c = conn as unknown as {
    sandbox?: boolean;
    encryptedCredentials?: Parameters<typeof decrypt>[0];
    sandboxCredentials?: Parameters<typeof decrypt>[0];
    productionCredentials?: Parameters<typeof decrypt>[0];
  };
  // Read that environment's OWN slot. Fall back to the mirror only for legacy
  // connections whose per-env slots were never populated (both empty).
  const slotBlob = wantSandbox ? c.sandboxCredentials : c.productionCredentials;
  const bothSlotsEmpty = !c.sandboxCredentials && !c.productionCredentials;
  const blob = slotBlob ?? (bothSlotsEmpty ? c.encryptedCredentials : undefined);
  if (!blob) {
    // The selected environment has no stored credentials — it isn't connected, so
    // there's nothing valid to verify (this is what makes a not-connected env report
    // as such instead of borrowing the other env's creds).
    res.json({ ok: false, error: `The ${envLabel} environment isn't connected.`, environment: envLabel });
    return;
  }
  try {
    let creds = JSON.parse(decrypt(blob)) as { expiresAt?: number };
    // Refresh an OAuth token within 5 min of expiry so verification (and the AI)
    // don't fail on a token that's technically still stored but stale.
    if (creds.expiresAt && creds.expiresAt - Date.now() / 1000 < 300 && adapter.refreshTokens) {
      const appCreds = await getOAuthAppCreds(req.orgId!, conn.provider, wantSandbox);
      const refreshed = await adapter.refreshTokens(blob, appCreds);
      if (refreshed) {
        const encrypted = encrypt(JSON.stringify(refreshed));
        const slotKey = wantSandbox ? "sandboxCredentials" : "productionCredentials";
        // Persist to that env's slot, and keep the mirror in sync only when we're
        // testing the currently-active environment.
        const upd: Record<string, unknown> = { [slotKey]: encrypted };
        if (Boolean(conn.sandbox) === wantSandbox) upd.encryptedCredentials = encrypted;
        await Connection.updateOne({ _id: conn._id }, { $set: upd });
        creds = refreshed as typeof creds;
      }
    }
    const check = await adapter.verifyCredentials(creds, wantSandbox);
    // Report the live result inline only — a manual test must NOT mutate persisted
    // status (a transient network blip shouldn't demote a working connection and
    // hide its config behind a "Connect" button).
    res.json({ ok: check.ok, error: check.error, environment: envLabel });
  } catch (err) {
    logger.warn("[integrations] verify failed", { err: (err as Error).message });
    res.status(500).json({ ok: false, error: "Verification failed — please try again." });
  }
});

// ---- Inbound subscription webhook receiver ---------------------------------
// Per-connection callback endpoints an operator registers in their OWN Paddle/Stripe
// dashboard. They are PUBLIC (no dashboard auth) but authenticated by the provider's
// HMAC signature, verified against the per-connection webhook secret. Verified events
// update an ExternalSubscription snapshot so the assistant reflects out-of-band plan
// changes. See services/integrations/webhookReceiver.ts.

// Load a connection + its active-env secret/api key for the receiver. Returns null
// (→ 404) when the connection doesn't exist so we never leak which ids are valid.
async function loadReceiverConnection(
  connectionId: string,
  provider: string,
): Promise<{ conn: ReceiverConnection; webhookSecret?: string } | null> {
  let doc;
  try {
    doc = await Connection.findOne({ _id: connectionId, provider }).lean();
  } catch {
    return null; // malformed ObjectId
  }
  if (!doc) return null;
  let extra: { webhookSecret?: string; planPrices?: Record<string, { monthly?: string; yearly?: string }> } = {};
  let apiKey: string | undefined;
  const blob = activeCredsBlob(doc);
  if (blob) {
    try {
      const creds = JSON.parse(decrypt(blob)) as {
        apiKey?: string;
        accessToken?: string;
        extra?: typeof extra;
      };
      apiKey = creds.apiKey ?? creds.accessToken;
      extra = creds.extra ?? {};
    } catch {
      /* unreadable creds → no secret, verification will fail closed */
    }
  }
  return {
    conn: {
      _id: doc._id,
      organizationId: doc.organizationId,
      provider,
      sandbox: doc.sandbox,
      apiKey,
      planPrices: extra.planPrices,
    },
    // Per-connection signing secret, configured by the operator in the integrations page.
    // (Platform-wide env secrets like PADDLE_WEBHOOK_SECRET are ONLY for the platform's own
    // billing webhook — operator integration callbacks are always per-connection.)
    webhookSecret: extra.webhookSecret,
  };
}

router.post("/paddle/webhook/:connectionId", async (req: Request, res: Response) => {
  const loaded = await loadReceiverConnection(String(req.params.connectionId), "paddle");
  if (!loaded) {
    res.status(404).json({ error: { code: "not_found", message: "Unknown connection." } });
    return;
  }
  const raw = (req as unknown as { rawBody?: string }).rawBody ?? "";
  const sig = req.headers["paddle-signature"] as string | undefined;
  if (!verifyPaddleSignature(raw, sig, loaded.webhookSecret)) {
    res.status(401).json({ error: { code: "invalid_signature", message: "Bad signature." } });
    return;
  }
  try {
    await handlePaddleSubscriptionEvent(loaded.conn, JSON.parse(raw));
    res.status(204).send();
  } catch (err) {
    logger.error("[integrations] paddle receiver failed", { err: (err as Error).message });
    res.status(500).json({ error: { code: "webhook_error", message: "Failed to process event." } });
  }
});

router.post("/stripe/webhook/:connectionId", async (req: Request, res: Response) => {
  const loaded = await loadReceiverConnection(String(req.params.connectionId), "stripe");
  if (!loaded) {
    res.status(404).json({ error: { code: "not_found", message: "Unknown connection." } });
    return;
  }
  const raw = (req as unknown as { rawBody?: string }).rawBody ?? "";
  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!verifyStripeSignature(raw, sig, loaded.webhookSecret)) {
    res.status(401).json({ error: { code: "invalid_signature", message: "Bad signature." } });
    return;
  }
  try {
    await handleStripeSubscriptionEvent(loaded.conn, JSON.parse(raw));
    res.status(204).send();
  } catch (err) {
    logger.error("[integrations] stripe receiver failed", { err: (err as Error).message });
    res.status(500).json({ error: { code: "webhook_error", message: "Failed to process event." } });
  }
});

// ---- PUT /integrations/:connectionId/webhook-secret ---- store the signing secret
// the operator copies from their Paddle/Stripe notification-destination setup, into
// the ACTIVE environment's credential blob. Returns the callback URL to register.
router.put("/:connectionId/webhook-secret", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const conn = await Connection.findOne({
    _id: req.params.connectionId,
    organizationId: req.orgId,
    provider: { $in: ["paddle", "stripe"] },
  });
  if (!conn) {
    res.status(404).json({ error: "Paddle/Stripe connection not found." });
    return;
  }
  const secret = String((req.body as { webhookSecret?: unknown }).webhookSecret ?? "").trim();
  let creds: { apiKey?: string; accessToken?: string; extra?: Record<string, unknown> } = {};
  try {
    creds = JSON.parse(decrypt(activeCredsBlob(conn)!));
  } catch {
    /* start from empty if unreadable */
  }
  creds.extra = { ...(creds.extra ?? {}), webhookSecret: secret || undefined };
  const encrypted = encrypt(JSON.stringify(creds));
  const slot = conn.sandbox ? "sandboxCredentials" : "productionCredentials";
  await Connection.updateOne(
    { _id: conn._id },
    { $set: { [slot]: encrypted, encryptedCredentials: encrypted } },
  );
  res.json({
    ok: true,
    hasWebhookSecret: Boolean(secret),
    callbackUrl: `${env.apiBaseUrl}/api/v1/integrations/${conn.provider}/webhook/${conn._id}`,
  });
});

export default router;
