import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { Agent, Connection, ToolDefinition } from "../models/index.js";
import { getAdapter, listAdapters } from "../services/integrations/adapters/index.js";
import { encrypt, decrypt } from "../services/security/crypto.service.js";
import { logger } from "../config/logger.js";
import { env } from "../config/env.js";

const router = Router();

// ---- GET /integrations ---- list providers catalog + installed connections
router.get("/", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const orgId = req.orgId;

  const [connections, adapters, agents, toolDefs] = await Promise.all([
    Connection.find({ organizationId: orgId }).lean(),
    Promise.resolve(listAdapters()),
    Agent.find({ organizationId: orgId }, { _id: 1, name: 1 }).lean(),
    ToolDefinition.find(
      { organizationId: orgId },
      { connectionId: 1, enabledAgentIds: 1, key: 1, displayName: 1, description: 1, guardrails: 1 },
    ).lean(),
  ]);

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

  const connCard = (conn: (typeof connections)[number]) => ({
    _id: conn._id,
    name: conn.name,
    description: conn.description ?? "",
    status: conn.status,
    sandbox: conn.sandbox,
    authMode: conn.authMode,
    rateLimitPerSession: conn.rateLimitPerSession ?? 10,
    rateLimitPerConnection: conn.rateLimitPerConnection ?? 0,
    rateLimitWindowMs: conn.rateLimitWindowMs ?? 60_000,
    enabledAgentIds: [...(enabledByConn.get(String(conn._id)) ?? [])],
    toolDefs: toolsByConn.get(String(conn._id)) ?? [],
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
    res.json({ projects: [] });
    return;
  }
  const adapter = getAdapter("jira") as {
    listProjects?: (creds: unknown) => Promise<{ key: string; name: string }[]>;
    refreshTokens?: (blob: unknown) => Promise<unknown>;
  } | undefined;
  if (!adapter?.listProjects) {
    res.json({ projects: [] });
    return;
  }
  try {
    let creds = JSON.parse(decrypt(conn.encryptedCredentials as Parameters<typeof decrypt>[0])) as {
      expiresAt?: number;
    };
    // Jira OAuth tokens expire (~1h) — refresh if within 5 min of expiry.
    if (creds.expiresAt && creds.expiresAt - Date.now() / 1000 < 300 && adapter.refreshTokens) {
      const refreshed = await adapter.refreshTokens(conn.encryptedCredentials);
      if (refreshed) {
        await Connection.updateOne(
          { _id: conn._id },
          { $set: { encryptedCredentials: encrypt(JSON.stringify(refreshed)) } },
        );
        creds = refreshed as typeof creds;
      }
    }
    const projects = await adapter.listProjects(creds);
    res.json({ projects });
  } catch (err) {
    logger.warn("[integrations] jira project list failed", { err: (err as Error).message });
    res.json({ projects: [] });
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
    // Only accept a genuine JSON Schema (an object with type:"object" and a
    // properties map). Operators sometimes paste a sample RESPONSE instead
    // (e.g. {"orderId":"ORD-12345"}) — that's an object but not a schema, and
    // storing it makes OpenAI 400 the whole tools array at chat time. Fall back
    // to an empty object schema so the tool still works (accepts loose args).
    const looksLikeSchema =
      inputSchema && typeof inputSchema === "object" &&
      (inputSchema as { type?: unknown }).type === "object" &&
      typeof (inputSchema as { properties?: unknown }).properties === "object";
    const schema = looksLikeSchema
      ? inputSchema
      : { type: "object", properties: {}, required: [] };
    const credentials = {
      extra: {
        url: String(webhookUrl),
        method: webhookMethod ? String(webhookMethod).toUpperCase() : "POST",
        authHeader: authHeader ? String(authHeader) : undefined,
        authValue: authValue ? String(authValue) : undefined,
        inputSchema: schema,
      },
    };
    const conn = await Connection.create({
      organizationId: orgId,
      provider,
      name: String(name ?? toolName ?? "Custom Webhook"),
      authMode: "webhook",
      status: "active",
      sandbox: Boolean(sandbox),
      encryptedCredentials: encrypt(JSON.stringify(credentials)),
      scopes: [],
      createdBy: req.auth!.userId,
    });
    await ToolDefinition.updateOne(
      { connectionId: conn._id, key: String(toolKey) },
      {
        $setOnInsert: {
          connectionId: conn._id,
          organizationId: orgId,
          key: String(toolKey),
          displayName: String(toolName ?? toolKey),
          description: String(toolDescription ?? `Custom webhook tool: ${toolKey}`),
          jsonSchema: schema,
          isActive: true,
          enabledAgentIds: [],
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
    const encrypted = encrypt(JSON.stringify(credentials));

    const conn = await Connection.create({
      organizationId: orgId,
      provider,
      name: String(name ?? provider),
      authMode,
      status: "active",
      sandbox: Boolean(sandbox),
      encryptedCredentials: encrypted,
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
            $setOnInsert: {
              connectionId: conn._id,
              organizationId: orgId,
              ...t,
              isActive: true,
              enabledAgentIds: [],
            },
          },
          { upsert: true },
        ),
      ),
    );

    res.json({ connection: { _id: conn._id, name: conn.name, status: conn.status } });
    return;
  }

  // OAuth mode — return redirect URL.
  // Encode orgId into the state so the callback can identify the org without
  // requiring an Authorization header (OAuth redirects carry no JWT).
  const nonce = randomBytes(16).toString("hex");
  const state = `${String(orgId)}.${nonce}`;
  const authUrl = adapter.buildAuthUrl(String(orgId), state);
  if (!authUrl) {
    res.status(400).json({ error: `Provider ${provider} does not support OAuth. Use apiKey instead.` });
    return;
  }

  res.json({ authUrl, state });
});

// ---- GET /integrations/:provider/callback ---- OAuth code exchange
// This route is called by the OAuth provider as a browser redirect — there is
// no Authorization header. The orgId is extracted from the `state` param that
// was embedded during the connect flow.
router.get("/:provider/callback", async (req: Request, res: Response) => {
  const provider = String(req.params.provider);
  const code = String(req.query.code ?? "");
  const rawState = String(req.query.state ?? "");

  // state format: "<orgId>.<nonce>"
  const dotIdx = rawState.indexOf(".");
  const orgId = dotIdx > 0 ? rawState.slice(0, dotIdx) : null;

  if (!orgId) {
    res.status(400).send("Invalid OAuth state — missing orgId.");
    return;
  }

  const adapter = getAdapter(provider);
  if (!adapter) {
    res.status(400).send(`Unknown provider: ${provider}`);
    return;
  }

  let rawCreds: import("../services/integrations/providers/types.js").RawCredentials;
  try {
    rawCreds = await adapter.exchangeCode(code, orgId);
  } catch (err) {
    logger.error("[integrations] OAuth code exchange failed", { provider, err: (err as Error).message });
    res.status(400).send("OAuth code exchange failed. Please try connecting again.");
    return;
  }

  const encrypted = encrypt(JSON.stringify(rawCreds));
  const expiresAt = rawCreds.expiresAt ? new Date(rawCreds.expiresAt * 1000) : undefined;

  const conn = await Connection.findOneAndUpdate(
    { organizationId: orgId, provider, authMode: "oauth" },
    {
      $set: {
        encryptedCredentials: encrypted,
        status: "active",
        ...(expiresAt ? { expiresAt } : {}),
      },
      $setOnInsert: {
        name: provider,
        authMode: "oauth",
        sandbox: false,
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
          $setOnInsert: {
            connectionId: conn!._id,
            organizationId: orgId,
            ...t,
            isActive: true,
            enabledAgentIds: [],
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
    requireNamedAttendee, upgradeOnly, requireBillingOwner,
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
  guardrails.upgradeOnly = Boolean(upgradeOnly);
  guardrails.requireBillingOwner = Boolean(requireBillingOwner);

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
  if (sandbox !== undefined) $set.sandbox = Boolean(sandbox);
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

  res.json({ ok: true });
});

// ---- DELETE /integrations/:connectionId ---- soft-revoke
router.delete("/:connectionId", requireAuth, requireOrg, async (req: Request, res: Response) => {
  const orgId = req.orgId;
  // Use updateOne to avoid Mongoose save-time validation on fields not being modified
  const result = await Connection.updateOne(
    { _id: req.params.connectionId, organizationId: orgId },
    { $set: { status: "revoked" } },
  );
  if (result.matchedCount === 0) {
    res.status(404).json({ error: "Connection not found." });
    return;
  }
  res.json({ ok: true });
});

export default router;
