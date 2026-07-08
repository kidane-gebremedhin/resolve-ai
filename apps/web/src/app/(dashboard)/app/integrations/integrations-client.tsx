"use client";

import { useState } from "react";
import { Plug, CheckCircle2, AlertCircle, XCircle, ExternalLink } from "lucide-react";
import { API_URL } from "@/lib/app-urls";

async function getAccessToken(): Promise<string | undefined> {
  const res = await fetch("/api/session-token", { cache: "no-store" });
  const data = (await res.json()) as { accessToken?: string };
  return data.accessToken;
}

type ProviderInfo = {
  provider: string;
  cardId?: string;
  tools: { key: string; displayName: string; description: string }[];
  connection: {
    _id: string;
    name: string;
    description?: string;
    status: "active" | "error" | "revoked";
    sandbox: boolean;
    authMode: "oauth" | "api_key" | "webhook";
    hasSandboxCreds?: boolean;
    hasProductionCreds?: boolean;
    rateLimitPerSession?: number;
    rateLimitPerConnection?: number;
    rateLimitWindowMs?: number;
    enabledAgentIds: string[];
    toolDefs?: ToolDef[];
    // Custom-webhook endpoint config for the active environment (auth value is a
    // secret and is never sent — only hasAuthValue). Powers the edit form.
    webhookConfig?: {
      url?: string;
      method?: string;
      authHeader?: string;
      hasAuthValue?: boolean;
      inputSchema?: unknown;
    };
  } | null;
};

type Guardrails = {
  maxAmount?: number;
  maxDaysSincePurchase?: number;
  requireIdentityVerification?: boolean;
  allowedContactEmails?: string[];
  businessHoursStart?: string;
  businessHoursEnd?: string;
  businessDays?: number[];
  businessHoursTz?: string;
  requireNamedAttendee?: boolean;
  upgradeOnly?: boolean;
  requireBillingOwner?: boolean;
};
type ToolDef = {
  _id: string;
  key: string;
  displayName: string;
  description?: string;
  enabledAgentIds?: string[];
  guardrails?: Guardrails;
};
type AgentOption = { _id: string; name: string };

const PROVIDER_LABELS: Record<string, string> = {
  calcom: "Cal.com",
  calendly: "Calendly",
  stripe: "Stripe",
  shopify: "Shopify",
  linear: "Linear",
  jira: "Jira",
  paddle: "Paddle",
  webhook: "Custom Webhook",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <CheckCircle2 className="h-3 w-3" /> Connected
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
        <AlertCircle className="h-3 w-3" /> Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
      <XCircle className="h-3 w-3" /> Revoked
    </span>
  );
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const inputCls =
  "mt-0.5 w-full rounded border border-neutral-300 px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-800";

function GuardrailRow({ tool, onSaved }: { tool: ToolDef; onSaved?: (g: Guardrails) => void }) {
  const g = tool.guardrails ?? {};
  // Which controls to show depends on what the tool does.
  const isRefund = /refund/i.test(tool.key);
  const isBooking = tool.key === "book_meeting";
  const isSubscription = /^(upgrade|downgrade)_subscription$/.test(tool.key);

  const [maxAmount, setMaxAmount] = useState(g.maxAmount != null ? String(g.maxAmount) : "");
  const [maxDays, setMaxDays] = useState(g.maxDaysSincePurchase != null ? String(g.maxDaysSincePurchase) : "");
  const [requireOtp, setRequireOtp] = useState(g.requireIdentityVerification ?? false);
  const [emails, setEmails] = useState((g.allowedContactEmails ?? []).join(", "));
  const [bhStart, setBhStart] = useState(g.businessHoursStart ?? "");
  const [bhEnd, setBhEnd] = useState(g.businessHoursEnd ?? "");
  const [bhTz, setBhTz] = useState(g.businessHoursTz ?? "");
  const [days, setDays] = useState<number[]>(g.businessDays ?? [1, 2, 3, 4, 5]);
  // Require a real attendee name defaults ON — bookings should capture the
  // customer's real name unless the operator explicitly turns it off.
  const [namedAttendee, setNamedAttendee] = useState(g.requireNamedAttendee ?? true);
  const [upgradeOnly, setUpgradeOnly] = useState(g.upgradeOnly ?? false);
  const [billingOwner, setBillingOwner] = useState(g.requireBillingOwner ?? false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    setSaveError(false);
    try {
      const token = await getAccessToken();
      const payload: Guardrails = {
        maxAmount: maxAmount === "" ? undefined : Number(maxAmount),
        maxDaysSincePurchase: maxDays === "" ? undefined : Number(maxDays),
        requireIdentityVerification: requireOtp,
        allowedContactEmails: emails.split(",").map((e) => e.trim()).filter(Boolean),
        businessHoursStart: bhStart,
        businessHoursEnd: bhEnd,
        businessDays: days,
        businessHoursTz: bhTz,
        requireNamedAttendee: namedAttendee,
        upgradeOnly,
        requireBillingOwner: billingOwner,
      };
      const res = await fetch(`${API_URL}/integrations/tools/${tool._id}/guardrails`, {
        method: "PATCH",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, maxAmount: maxAmount === "" ? null : Number(maxAmount), maxDaysSincePurchase: maxDays === "" ? null : Number(maxDays) }),
      });
      if (res.ok) {
        setSaved(true);
        // Report the saved values up so reopening the modal shows them (the row
        // remounts from server props otherwise → stale values until a refresh).
        onSaved?.(payload);
      } else setSaveError(true);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-neutral-200 p-2.5 dark:border-neutral-700">
      <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{tool.displayName}</p>

      {isRefund && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-[10px] text-neutral-500 dark:text-neutral-400">
            Max amount ($)
            <input type="number" className={inputCls} value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="none" />
          </label>
          <label className="text-[10px] text-neutral-500 dark:text-neutral-400">
            Max days since purchase
            <input type="number" className={inputCls} value={maxDays} onChange={(e) => setMaxDays(e.target.value)} placeholder="none" />
          </label>
        </div>
      )}

      {isBooking && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <label className="text-[10px] text-neutral-500 dark:text-neutral-400">
              Business hours start
              <input type="time" className={inputCls} value={bhStart} onChange={(e) => setBhStart(e.target.value)} />
            </label>
            <label className="text-[10px] text-neutral-500 dark:text-neutral-400">
              End
              <input type="time" className={inputCls} value={bhEnd} onChange={(e) => setBhEnd(e.target.value)} />
            </label>
            <label className="text-[10px] text-neutral-500 dark:text-neutral-400">
              Timezone (IANA)
              <input className={inputCls} value={bhTz} onChange={(e) => setBhTz(e.target.value)} placeholder="America/New_York" />
            </label>
          </div>
          <div className="text-[10px] text-neutral-500 dark:text-neutral-400">
            Business days
            <div className="mt-1 flex flex-wrap gap-1">
              {DAY_LABELS.map((label, d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    days.includes(d)
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-400">
            <input type="checkbox" checked={namedAttendee} onChange={(e) => setNamedAttendee(e.target.checked)} className="h-3 w-3" />
            Require a real attendee name
          </label>
        </div>
      )}

      {isSubscription && (
        <div className="mt-2 space-y-1.5">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-400">
            <input type="checkbox" checked={upgradeOnly} onChange={(e) => setUpgradeOnly(e.target.checked)} className="h-3 w-3" />
            Upgrades only (block downgrades through the AI)
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-400">
            <input type="checkbox" checked={billingOwner} onChange={(e) => setBillingOwner(e.target.checked)} className="h-3 w-3" />
            Require the billing owner (verified account email)
          </label>
        </div>
      )}

      <label className="mt-2 block text-[10px] text-neutral-500 dark:text-neutral-400">
        Allowed contact emails (comma-separated, blank = any)
        <input className={inputCls} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="any" />
      </label>
      <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-400">
        <input type="checkbox" checked={requireOtp} onChange={(e) => setRequireOtp(e.target.checked)} className="h-3 w-3" />
        Require email OTP identity verification
      </label>
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-[10px] text-green-600">Saved</span>}
        {saveError && <span className="text-[10px] text-red-500">Save failed</span>}
      </div>
    </div>
  );
}

// Reusable centered modal shell — keeps config panels out of the card layout.
function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">✕</button>
        </div>
        {subtitle && <p className="mb-3 text-[11px] text-neutral-500 dark:text-neutral-400">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

// Per-tool registry: rename, custom description (fed to the AI so it calls the
// right tool for the right purpose), and which agents can access it.
function ToolRegistryRow({
  tool,
  agents,
  onSaved,
}: {
  tool: ToolDef;
  agents: AgentOption[];
  onSaved?: (v: { displayName: string; description: string; enabledAgentIds: string[] }) => void;
}) {
  const [name, setName] = useState(tool.displayName ?? tool.key);
  const [desc, setDesc] = useState(tool.description ?? "");
  const [agentIds, setAgentIds] = useState<string[]>(tool.enabledAgentIds ?? []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggleAgent(id: string) {
    setAgentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/integrations/tools/${tool._id}/registry`, {
        method: "PATCH",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name, description: desc, enabledAgentIds: agentIds }),
      });
      if (res.ok) {
        setSaved(true);
        onSaved?.({ displayName: name, description: desc, enabledAgentIds: agentIds });
      }
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 dark:bg-neutral-800">{tool.key}</span>
      </div>
      <label className="mt-2 block text-[10px] text-neutral-500 dark:text-neutral-400">
        Display name
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={tool.key} />
      </label>
      <label className="mt-2 block text-[10px] text-neutral-500 dark:text-neutral-400">
        Description (tells the AI when to use this tool)
        <textarea
          className={`${inputCls} min-h-[46px]`}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="e.g. Use when the customer wants to talk to sales"
        />
      </label>
      <div className="mt-2 text-[10px] text-neutral-500 dark:text-neutral-400">
        Agents with access
        {agents.length === 0 ? (
          <p className="mt-1 text-neutral-400">No agents yet.</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {agents.map((a) => (
              <button
                key={a._id}
                type="button"
                onClick={() => toggleAgent(a._id)}
                className={`rounded px-2 py-0.5 text-[10px] ${
                  agentIds.includes(a._id)
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800"
                }`}
              >
                {a.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-[10px] text-green-600">Saved</span>}
      </div>
    </div>
  );
}

function ToolRegistryModal({
  tools,
  agents,
  onClose,
  onSaved,
}: {
  tools: ToolDef[];
  agents: AgentOption[];
  onClose: () => void;
  onSaved?: (id: string, v: { displayName: string; description: string; enabledAgentIds: string[] }) => void;
}) {
  return (
    <Modal
      title="Tool registry"
      subtitle="Each connection auto-exposes one or more tools to the AI. Rename them, write a custom description the AI reads to call the right tool, and pick which agents can use each."
      onClose={onClose}
    >
      {tools.length === 0 ? (
        <p className="text-xs text-neutral-400">No tools for this connection.</p>
      ) : (
        <div className="space-y-2">
          {tools.map((t) => (
            <ToolRegistryRow key={t._id} tool={t} agents={agents} onSaved={(v) => onSaved?.(t._id, v)} />
          ))}
        </div>
      )}
    </Modal>
  );
}

// Sandbox / Production segmented control. Always visible for providers that have
// environments, so the operator picks which one to work with (and connect) first.
// Each segment shows whether that environment already has stored credentials.
function EnvSegments({
  selected,
  sandboxConnected,
  productionConnected,
  onSelect,
}: {
  selected: boolean; // true = sandbox
  sandboxConnected: boolean;
  productionConnected: boolean;
  onSelect: (sandbox: boolean) => void;
}) {
  const segment = (isSandbox: boolean, label: string, connected: boolean) => {
    const active = selected === isSandbox;
    // The selected segment is clearly highlighted with an accent ring (amber for
    // sandbox, emerald for production) so the operator always knows which
    // environment they're viewing/acting on — even when it isn't connected yet.
    const accentRing = isSandbox
      ? "ring-2 ring-amber-400 dark:ring-amber-500/70"
      : "ring-2 ring-emerald-400 dark:ring-emerald-500/70";
    return (
      <button
        type="button"
        onClick={() => onSelect(isSandbox)}
        aria-pressed={active}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold transition ${
          active
            ? `bg-white text-neutral-900 shadow-sm ${accentRing} dark:bg-neutral-700 dark:text-neutral-100`
            : "font-medium text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
        }`}
      >
        {label}
        <span
          className={
            connected
              ? "text-green-600 dark:text-green-400"
              : "text-neutral-400 dark:text-neutral-600"
          }
          title={connected ? "Connected" : "Not connected"}
        >
          {connected ? "✓" : "○"}
        </span>
      </button>
    );
  };
  return (
    <div>
      <div className="flex gap-1 rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
        {segment(true, "Sandbox", sandboxConnected)}
        {segment(false, "Production", productionConnected)}
      </div>
      <p className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-500">
        <span className="font-medium text-neutral-500 dark:text-neutral-400">Viewing {selected ? "Sandbox" : "Production"}</span>
        {selected ? " — test credentials, no live data" : " — live credentials and data"}
      </p>
    </div>
  );
}

// Full editor for an existing custom webhook. Every connection detail is editable
// here: endpoint URL, method, auth header, auth value, the input JSON schema, and
// the tool's name/description. The auth value is a secret the server never returns,
// so it starts blank — leaving it blank keeps the stored one. Single Save button →
// closes on success (per the modal-close convention).
function WebhookEditModal({ info, onClose }: { info: ProviderInfo; onClose: () => void }) {
  const conn = info.connection!;
  const cfg = conn.webhookConfig ?? {};
  const tool = (conn.toolDefs ?? [])[0];
  const [url, setUrl] = useState(cfg.url ?? "");
  const [method, setMethod] = useState((cfg.method ?? "POST").toUpperCase());
  const [authHeader, setAuthHeader] = useState(cfg.authHeader ?? "");
  const [authValue, setAuthValue] = useState("");
  const [toolName, setToolName] = useState(tool?.displayName ?? "");
  const [toolDescription, setToolDescription] = useState(tool?.description ?? "");
  const [schemaText, setSchemaText] = useState(
    cfg.inputSchema ? JSON.stringify(cfg.inputSchema, null, 2) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const envLabel = conn.sandbox ? "sandbox" : "production";

  async function save() {
    setError(null);
    let parsedSchema: unknown = undefined;
    if (schemaText.trim()) {
      try {
        parsedSchema = JSON.parse(schemaText);
      } catch {
        setError("Input schema must be valid JSON.");
        return;
      }
    }
    if (!url.trim()) {
      setError("A webhook URL is required.");
      return;
    }
    setSaving(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/integrations/${conn._id}/webhook-config`, {
        method: "PATCH",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: url.trim(),
          webhookMethod: method,
          authHeader,
          // Only send a value when the operator typed a new one, so a blank field
          // keeps the stored secret.
          ...(authValue ? { authValue } : {}),
          inputSchema: parsedSchema,
          toolName,
          toolDescription,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "Couldn't save — please try again.");
        setSaving(false);
        return;
      }
      // Reload to reflect the updated endpoint/schema/tool everywhere (also closes
      // this single-save modal).
      window.location.reload();
    } catch {
      setError("Couldn't save — please try again.");
      setSaving(false);
    }
  }

  const fieldCls =
    "mt-0.5 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800";
  return (
    <Modal
      title="Edit webhook"
      subtitle={`Editing the ${envLabel} endpoint. All connection details are editable — the AI sees the tool name, description and input schema below.`}
      onClose={onClose}
    >
      <div className="space-y-2">
        {tool?.key && (
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            Tool key <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600 dark:bg-neutral-800">{tool.key}</span>
          </p>
        )}
        <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
          Display name
          <input className={fieldCls} value={toolName} onChange={(e) => setToolName(e.target.value)} placeholder="Look up order" />
        </label>
        <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
          Description <span className="font-normal text-neutral-400">— when should the AI use this?</span>
          <textarea className={`${fieldCls} min-h-[46px]`} value={toolDescription} onChange={(e) => setToolDescription(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
            Method
            <select className={fieldCls} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option>POST</option>
              <option>GET</option>
              <option>PUT</option>
              <option>PATCH</option>
            </select>
          </label>
          <label className="block min-w-0 flex-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
            Endpoint URL
            <input className={fieldCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.yourservice.com/endpoint" required />
          </label>
        </div>
        <div className="flex gap-2">
          <label className="block min-w-0 flex-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
            Auth header
            <input className={fieldCls} value={authHeader} onChange={(e) => setAuthHeader(e.target.value)} placeholder="Authorization" />
          </label>
          <label className="block min-w-0 flex-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
            Auth value
            <input
              className={fieldCls}
              value={authValue}
              onChange={(e) => setAuthValue(e.target.value)}
              placeholder={cfg.hasAuthValue ? "•••••• (leave blank to keep)" : "Bearer xxx"}
            />
          </label>
        </div>
        <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
          Input JSON schema
          <textarea
            className={`${fieldCls} min-h-[90px] font-mono text-[11px]`}
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            placeholder={'{"type":"object","properties":{"orderId":{"type":"string"}},"required":["orderId"]}'}
          />
        </label>
        {error && <p className="text-[11px] text-red-500">{error}</p>}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={onClose} className="text-xs text-neutral-500 hover:underline">
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ConnectorCard({ info, agents = [] }: { info: ProviderInfo; agents?: AgentOption[] }) {
  const [connecting, setConnecting] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(info.connection?.name ?? "");
  const [descDraft, setDescDraft] = useState(info.connection?.description ?? "");
  const [savingMeta, setSavingMeta] = useState(false);
  const label = PROVIDER_LABELS[info.provider] ?? info.provider;
  const isOAuth = ["calendly", "stripe", "linear", "jira"].includes(info.provider);

  const [metaError, setMetaError] = useState<string | null>(null);
  async function saveMeta() {
    if (!info.connection) return;
    setSavingMeta(true);
    setMetaError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/integrations/${info.connection._id}`, {
        method: "PATCH",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameDraft.trim() || label, description: descDraft.trim() }),
      });
      if (res.ok) {
        window.location.reload();
      } else {
        setMetaError("Couldn't save — please try again.");
        setSavingMeta(false);
      }
    } catch {
      setMetaError("Couldn't save — please try again.");
      setSavingMeta(false);
    }
  }

  const [showGuardrails, setShowGuardrails] = useState(false);
  const [showRegistry, setShowRegistry] = useState(false);
  const [showWebhookEdit, setShowWebhookEdit] = useState(false);
  // Client-side echoes of what was just saved in the multi-save modals, so that
  // reopening a modal shows the new values instead of the stale server props (the
  // rows remount on reopen). Keyed by toolDef id.
  const [guardrailOverrides, setGuardrailOverrides] = useState<Record<string, Guardrails>>({});
  const [registryOverrides, setRegistryOverrides] = useState<
    Record<string, { displayName: string; description: string; enabledAgentIds: string[] }>
  >({});
  // Which environment is selected/in-view. The active environment lives in the DB
  // (Connection.sandbox) — that's the single source of truth the dispatcher routes
  // every tool call to — so the card opens on it. A fresh card defaults to Sandbox.
  const [sandbox, setSandbox] = useState(info.connection?.sandbox ?? true);
  // Which env the pending API-key form is connecting (null = fresh connect).
  const [pendingEnvSandbox, setPendingEnvSandbox] = useState<boolean | null>(null);
  const [keyFormMsg, setKeyFormMsg] = useState<string | null>(null);
  // Pick an environment in the segmented control. Selecting an already-connected
  // environment switches the active credentials to it (server swap). Selecting an
  // environment that isn't connected just brings it into view — the "connect this
  // environment" prompt then lets the operator add it. On a brand-new card (no
  // connection yet) it simply chooses which environment to connect first.
  async function selectEnv(wantSandbox: boolean) {
    if (wantSandbox === sandbox) return;
    setVerifyResult(null);
    closeKeyForm();
    setSandbox(wantSandbox);
    if (!info.connection) return; // fresh card — just choosing which env to connect
    const targetConnected = wantSandbox ? sandboxConnected : productionConnected;
    if (!targetConnected) return; // in view only; the connect prompt handles it
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/integrations/${info.connection._id}`, {
        method: "PATCH",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ sandbox: wantSandbox }),
      });
      // Should already be connected, but if the server says it needs setup, keep the
      // selection so the connect prompt shows rather than snapping the view back.
      if (!res.ok) setSandbox(!wantSandbox); // revert only on a hard failure
    } catch {
      setSandbox(!wantSandbox);
    }
  }

  // ---- Per-connection rate limits ----
  const [showRateLimits, setShowRateLimits] = useState(false);
  const [rlPerSession, setRlPerSession] = useState(String(info.connection?.rateLimitPerSession ?? 10));
  const [rlPerConn, setRlPerConn] = useState(String(info.connection?.rateLimitPerConnection ?? 0));
  const [rlWindowSec, setRlWindowSec] = useState(String(Math.round((info.connection?.rateLimitWindowMs ?? 60000) / 1000)));
  const [savingRl, setSavingRl] = useState(false);
  const [savedRl, setSavedRl] = useState(false);
  async function saveRateLimits() {
    if (!info.connection) return;
    setSavingRl(true);
    setSavedRl(false);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/integrations/${info.connection._id}`, {
        method: "PATCH",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({
          rateLimitPerSession: rlPerSession,
          rateLimitPerConnection: rlPerConn,
          rateLimitWindowMs: String(Math.max(1, Number(rlWindowSec) || 60) * 1000),
        }),
      });
      if (res.ok) {
        setSavedRl(true);
        // Single-save modal — confirm briefly, then close so the operator isn't
        // left to dismiss it manually. (Multi-save modals like Guardrails / Tool
        // registry stay open so several rows can be saved in one sitting.)
        setTimeout(() => setShowRateLimits(false), 600);
      }
    } catch {
      /* ignore */
    } finally {
      setSavingRl(false);
    }
  }

  // Re-check a live connection against the real provider (same check api-key
  // connects run, now available for OAuth too and re-runnable any time).
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; error?: string } | null>(null);
  async function testConnection() {
    if (!info.connection) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/integrations/${info.connection._id}/verify`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: unknown };
      // Guard against a non-string error shape (e.g. an upstream {code,message}
      // object) so we never render "[object Object]" to the operator.
      const error = typeof data.error === "string" ? data.error : undefined;
      setVerifyResult({ ok: Boolean(data.ok), error });
    } catch {
      setVerifyResult({ ok: false, error: "Couldn't reach the server." });
    } finally {
      setVerifying(false);
    }
  }

  // Connect the given environment. OAuth kicks off the provider redirect carrying
  // the chosen environment (so its tokens land in that env's slot); api-key/webhook
  // open the inline form scoped to that environment.
  async function handleConnect(envSandbox: boolean) {
    if (isWebhook) {
      // Scope the (full or compact) webhook form to this environment.
      setPendingEnvSandbox(envSandbox);
      setShowKeyForm(true);
      return;
    }
    if (isOAuth) {
      setConnecting(true);
      try {
        const token = await getAccessToken();
        const res = await fetch(`${API_URL}/integrations/${info.provider}/connect`, {
          method: "POST",
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
          body: JSON.stringify({ sandbox: envSandbox }),
        });
        const data = (await res.json()) as { authUrl?: string };
        if (data.authUrl) {
          window.location.href = data.authUrl;
        }
      } catch {
        setConnecting(false);
      }
    } else {
      setPendingEnvSandbox(envSandbox);
      setKeyFormMsg(`Add your ${envSandbox ? "sandbox" : "production"} API key.`);
      setShowKeyForm(true);
    }
  }

  // Connect whichever environment the operator currently has selected.
  function connectSelectedEnv() {
    setVerifyResult(null);
    void handleConnect(sandbox);
  }

  // The "this environment isn't connected — connect it" affordance. Doubles as the
  // way to reopen the form after Cancel, and as the initial connect action.
  function renderConnectPrompt() {
    const envLabel = sandbox ? "Sandbox" : "Production";
    return (
      <div className="rounded-md border border-dashed border-neutral-300 px-3 py-3 text-center dark:border-neutral-700">
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{envLabel} isn’t connected yet.</p>
        <button
          onClick={connectSelectedEnv}
          disabled={connecting}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {isOAuth ? (
            <>
              <ExternalLink className="h-3.5 w-3.5" />
              {connecting ? "Redirecting…" : `Connect ${envLabel} via OAuth`}
            </>
          ) : isWebhook ? (
            connectionExists
              ? `Add ${sandbox ? "sandbox" : "production"} endpoint`
              : `Create ${sandbox ? "sandbox" : "production"} webhook`
          ) : (
            `Add ${sandbox ? "sandbox" : "production"} key`
          )}
        </button>
      </div>
    );
  }

  // Add/replace just the endpoint (URL + method + auth) for the selected environment
  // of an EXISTING webhook — the tool definition is shared across environments.
  async function handleEndpointSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!info.connection) return;
    setWhError(null);
    setConnecting(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/integrations/${info.connection._id}/webhook-endpoint`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({
          sandbox: pendingEnvSandbox ?? sandbox,
          webhookUrl: wh.url,
          webhookMethod: wh.method,
          authHeader: wh.authHeader || undefined,
          authValue: wh.authValue || undefined,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setWhError(d.error ?? "Failed to add endpoint.");
        setConnecting(false);
        return;
      }
      window.location.reload();
    } catch {
      setWhError("Failed to add endpoint.");
      setConnecting(false);
    }
  }

  async function handleKeySubmit(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    try {
      const token = await getAccessToken();
      // Connect for the environment being set up (production when the operator is
      // adding it via the toggle prompt), else default to sandbox for a fresh key.
      const sandboxForConnect = pendingEnvSandbox ?? true;
      const res = await fetch(`${API_URL}/integrations/${info.provider}/connect`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, sandbox: sandboxForConnect }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setKeyFormMsg(data.error ?? "Could not connect — check the key.");
        setConnecting(false);
        return;
      }
      window.location.reload();
    } finally {
      setConnecting(false);
    }
  }

  // Close the API-key form and clear anything the operator half-typed so the next
  // open starts fresh (no stale error banner, key, or pending-environment target).
  function closeKeyForm() {
    setShowKeyForm(false);
    setApiKey("");
    setKeyFormMsg(null);
    setPendingEnvSandbox(null);
    setConnecting(false);
  }

  async function handleRevoke() {
    if (!info.connection) return;
    if (!confirm(`Disconnect ${label}? This will disable all related tools.`)) return;
    const token = await getAccessToken();
    await fetch(`${API_URL}/integrations/${info.connection._id}`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    window.location.reload();
  }

  // Custom webhook connector form state
  const [wh, setWh] = useState({
    toolKey: "", toolName: "", toolDescription: "", url: "",
    method: "POST", authHeader: "", authValue: "", inputSchema: "",
  });
  const [whError, setWhError] = useState<string | null>(null);
  async function handleWebhookSubmit(e: React.FormEvent) {
    e.preventDefault();
    setWhError(null);
    let parsedSchema: unknown = undefined;
    if (wh.inputSchema.trim()) {
      try {
        parsedSchema = JSON.parse(wh.inputSchema);
      } catch {
        setWhError("Input schema must be valid JSON.");
        return;
      }
    }
    setConnecting(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/integrations/webhook/connect`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({
          name: wh.toolName || "Custom Webhook",
          sandbox: pendingEnvSandbox ?? sandbox,
          webhookUrl: wh.url,
          webhookMethod: wh.method,
          authHeader: wh.authHeader || undefined,
          authValue: wh.authValue || undefined,
          toolKey: wh.toolKey,
          toolName: wh.toolName,
          toolDescription: wh.toolDescription,
          inputSchema: parsedSchema,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setWhError(d.error ?? "Failed to connect webhook.");
        setConnecting(false);
        return;
      }
      window.location.reload();
    } catch {
      setWhError("Failed to connect webhook.");
      setConnecting(false);
    }
  }

  const isWebhook = info.provider === "webhook";
  const connectionExists = Boolean(info.connection) && info.connection!.status !== "revoked";
  // Every provider — including custom webhooks — is environment-aware: a webhook can
  // hold a separate sandbox and production endpoint and switch between them.
  const supportsEnvironments = true;
  // Adding an environment to an EXISTING webhook only needs its endpoint (URL/auth),
  // not the whole tool definition, so that case uses a compact form.
  const webhookEndpointMode = isWebhook && connectionExists;

  // The environment the stored `encryptedCredentials` belong to (server-persisted,
  // not the optimistic client selection). That env is always credentialed; the
  // other env is only connected once its own slot is filled. Both api-key AND
  // OAuth connections now store per-environment credentials.
  const activeEnvIsSandbox = info.connection?.sandbox ?? false;
  const sandboxConnected = info.connection
    ? Boolean(info.connection.hasSandboxCreds) || activeEnvIsSandbox
    : false;
  const productionConnected = info.connection
    ? Boolean(info.connection.hasProductionCreds) || !activeEnvIsSandbox
    : false;
  // Is the environment the operator is currently viewing actually connected? A
  // sandbox-only connection must NOT read as "Connected" while production is in
  // view — they have to connect production first.
  const selectedEnvConnected =
    !connectionExists || info.connection!.status !== "active"
      ? false
      : !supportsEnvironments
        ? true
        : sandbox
          ? sandboxConnected
          : productionConnected;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-neutral-500" />
          <div>
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{label}</h3>
            {connectionExists && info.connection!.name && info.connection!.name !== info.provider && (
              <p className="text-[11px] text-neutral-400 dark:text-neutral-500">{info.connection!.name}</p>
            )}
            {connectionExists && info.connection!.description ? (
              <p className="mt-0.5 text-[11px] italic text-neutral-400 dark:text-neutral-500">{info.connection!.description}</p>
            ) : null}
          </div>
        </div>
        {info.connection && info.connection.status !== "revoked" ? (
          info.connection.status === "active" && !selectedEnvConnected ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              <AlertCircle className="h-3 w-3" /> {sandbox ? "Sandbox" : "Production"} not connected
            </span>
          ) : (
            <StatusBadge status={info.connection.status} />
          )
        ) : null}
      </div>

      {(() => {
        // Webhook tools are dynamic (not in the adapter template), so fall back to
        // the connection's actual tool definitions for the count/label.
        const displayTools = info.tools.length > 0
          ? info.tools.map((t) => t.displayName)
          : (info.connection?.toolDefs ?? []).map((t) => t.displayName);
        return (
          <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
            {displayTools.length} tool{displayTools.length !== 1 ? "s" : ""}
            {displayTools.length > 0 ? `: ${displayTools.join(", ")}` : ""}
          </p>
        );
      })()}

      {showKeyForm && webhookEndpointMode ? (
        <form onSubmit={handleEndpointSubmit} className="flex flex-col gap-2">
          <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            Add the {(pendingEnvSandbox ?? sandbox) ? "sandbox" : "production"} endpoint for this webhook. The tool and its
            input schema are shared — only the URL and auth differ per environment.
          </p>
          <div className="flex gap-2">
            <select
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              value={wh.method}
              onChange={(e) => setWh({ ...wh, method: e.target.value })}
            >
              <option>POST</option>
              <option>GET</option>
              <option>PUT</option>
              <option>PATCH</option>
            </select>
            <input
              className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              placeholder="https://api.yourservice.com/endpoint"
              value={wh.url}
              onChange={(e) => setWh({ ...wh, url: e.target.value })}
              required
            />
          </div>
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              placeholder="Auth header (e.g. Authorization)"
              value={wh.authHeader}
              onChange={(e) => setWh({ ...wh, authHeader: e.target.value })}
            />
            <input
              className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              placeholder="Auth value (e.g. Bearer xxx)"
              value={wh.authValue}
              onChange={(e) => setWh({ ...wh, authValue: e.target.value })}
            />
          </div>
          {whError && <p className="text-[11px] text-red-500">{whError}</p>}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={connecting}
              className="rounded-md bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {connecting ? "Saving…" : "Save endpoint"}
            </button>
            <button type="button" onClick={closeKeyForm} className="rounded-md px-3 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300">
              Cancel
            </button>
          </div>
        </form>
      ) : showKeyForm && isWebhook ? (
        <form onSubmit={handleWebhookSubmit} className="flex flex-col gap-2">
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
            Point the AI at any HTTP endpoint. Define the tool the AI sees + the JSON schema for its inputs.
            {" "}This is the {(pendingEnvSandbox ?? sandbox) ? "sandbox" : "production"} endpoint.
          </p>
          <input
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            placeholder="Tool key (e.g. lookup_order)"
            value={wh.toolKey}
            onChange={(e) => setWh({ ...wh, toolKey: e.target.value })}
            required
          />
          <input
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            placeholder="Display name (e.g. Look up order)"
            value={wh.toolName}
            onChange={(e) => setWh({ ...wh, toolName: e.target.value })}
          />
          <input
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            placeholder="Description — when should the AI use this?"
            value={wh.toolDescription}
            onChange={(e) => setWh({ ...wh, toolDescription: e.target.value })}
          />
          <div className="flex gap-2">
            <select
              className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              value={wh.method}
              onChange={(e) => setWh({ ...wh, method: e.target.value })}
            >
              <option>POST</option>
              <option>GET</option>
              <option>PUT</option>
              <option>PATCH</option>
            </select>
            <input
              className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              placeholder="https://api.yourservice.com/endpoint"
              value={wh.url}
              onChange={(e) => setWh({ ...wh, url: e.target.value })}
              required
            />
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              placeholder="Auth header (e.g. Authorization)"
              value={wh.authHeader}
              onChange={(e) => setWh({ ...wh, authHeader: e.target.value })}
            />
            <input
              className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              placeholder="Auth value (e.g. Bearer xxx)"
              value={wh.authValue}
              onChange={(e) => setWh({ ...wh, authValue: e.target.value })}
            />
          </div>
          <textarea
            className="min-h-[70px] rounded-md border border-neutral-300 px-2 py-1 font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-800"
            placeholder={'Input JSON schema, e.g. {"type":"object","properties":{"orderId":{"type":"string"}},"required":["orderId"]}'}
            value={wh.inputSchema}
            onChange={(e) => setWh({ ...wh, inputSchema: e.target.value })}
          />
          {whError && <p className="text-[11px] text-red-500">{whError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={connecting}
              className="rounded-md bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {connecting ? "Connecting…" : "Add webhook tool"}
            </button>
            <button type="button" onClick={closeKeyForm} className="text-xs text-neutral-500 hover:underline">
              Cancel
            </button>
          </div>
        </form>
      ) : showKeyForm ? (
        <form onSubmit={handleKeySubmit} className="flex flex-col gap-2">
          {keyFormMsg && (
            <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              {keyFormMsg}
              {pendingEnvSandbox !== null && (
                <span className="font-medium"> ({pendingEnvSandbox ? "sandbox" : "production"} key)</span>
              )}
            </p>
          )}
          <input
            className="w-full min-w-0 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            placeholder={info.provider === "calcom" ? "cal_live_xxxx…" : "API key"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={connecting}
              className="rounded-md bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {connecting ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={closeKeyForm}
              className="rounded-md px-3 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : connectionExists ? (
        <div className="space-y-2.5">
          {supportsEnvironments && (
            <EnvSegments
              selected={sandbox}
              sandboxConnected={sandboxConnected}
              productionConnected={productionConnected}
              onSelect={selectEnv}
            />
          )}
          {!selectedEnvConnected && renderConnectPrompt()}
          {/* Management actions (incl. Disconnect) belong to the environment the
              operator is viewing — hide them entirely when it isn't connected. */}
          {selectedEnvConnected && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Toggle per-agent in{" "}
              <a href="/app/ai" className="underline hover:text-neutral-600 dark:hover:text-neutral-300">
                AI agent settings
              </a>
            </p>
            <button onClick={() => setEditing(true)} className="text-xs text-neutral-500 hover:underline">
              Rename
            </button>
            {isWebhook && (
              <button onClick={() => setShowWebhookEdit(true)} className="text-xs text-neutral-500 hover:underline">
                Edit webhook
              </button>
            )}
            <button onClick={() => setShowGuardrails(true)} className="text-xs text-neutral-500 hover:underline">
              Guardrails
            </button>
            <button onClick={() => setShowRateLimits(true)} className="text-xs text-neutral-500 hover:underline">
              Rate limits
            </button>
            <button onClick={() => setShowRegistry(true)} className="text-xs text-neutral-500 hover:underline">
              Tool registry
            </button>
            <button onClick={testConnection} disabled={verifying} className="text-xs text-neutral-500 hover:underline disabled:opacity-50">
              {verifying ? "Testing…" : "Test connection"}
            </button>
            <button onClick={handleRevoke} className="text-xs text-red-500 hover:underline ml-auto">
              Disconnect
            </button>
          </div>
          )}
          {verifyResult && (
            <p className={`text-[11px] ${verifyResult.ok ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
              {verifyResult.ok ? "✓ Connection is live and authenticated." : `✗ ${verifyResult.error ?? "Connection check failed."}`}
            </p>
          )}
          {showRegistry && (
            <ToolRegistryModal
              tools={(info.connection!.toolDefs ?? []).map((t) =>
                registryOverrides[t._id] ? { ...t, ...registryOverrides[t._id] } : t,
              )}
              agents={agents}
              onClose={() => setShowRegistry(false)}
              onSaved={(id, v) => setRegistryOverrides((p) => ({ ...p, [id]: v }))}
            />
          )}
          {showWebhookEdit && <WebhookEditModal info={info} onClose={() => setShowWebhookEdit(false)} />}
          {editing && (
            <Modal title="Rename connection" onClose={() => setEditing(false)}>
              <label className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">Connection name</label>
              <input
                className="mt-0.5 w-full rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                placeholder={label}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
              />
              <label className="mt-2 block text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                Description <span className="font-normal text-neutral-400">— tells the AI when to use it</span>
              </label>
              <textarea
                className="mt-0.5 min-h-[48px] w-full rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                placeholder="e.g. Use when the customer wants to talk to sales"
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
              />
              <div className="mt-3 flex gap-2">
                <button
                  onClick={saveMeta}
                  disabled={savingMeta}
                  className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
                >
                  {savingMeta ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setEditing(false)} className="text-xs text-neutral-500 hover:underline">
                  Cancel
                </button>
                {metaError && <span className="self-center text-[11px] text-red-500">{metaError}</span>}
              </div>
            </Modal>
          )}
          {showGuardrails && (
            <Modal
              title="Guardrails"
              subtitle="Server-enforced limits the AI must respect for each tool."
              onClose={() => setShowGuardrails(false)}
            >
              {(info.connection!.toolDefs ?? []).length === 0 ? (
                <p className="text-xs text-neutral-400">No tools to configure.</p>
              ) : (
                <div className="space-y-2">
                  {(info.connection!.toolDefs ?? []).map((t) => (
                    <GuardrailRow
                      key={t._id}
                      tool={guardrailOverrides[t._id] ? { ...t, guardrails: guardrailOverrides[t._id] } : t}
                      onSaved={(g) => setGuardrailOverrides((p) => ({ ...p, [t._id]: g }))}
                    />
                  ))}
                </div>
              )}
            </Modal>
          )}
          {showRateLimits && (
            <Modal
              title="Rate limits"
              subtitle="Caps AI tool calls in a sliding window. Over the limit, the AI gets a graceful “couldn’t do that right now” turn instead of erroring."
              onClose={() => setShowRateLimits(false)}
            >
              <div className="grid grid-cols-3 gap-2">
                <label className="text-[10px] text-neutral-500 dark:text-neutral-400">
                  Per visitor / window
                  <input type="number" min={1} className={inputCls} value={rlPerSession} onChange={(e) => setRlPerSession(e.target.value)} />
                </label>
                <label className="text-[10px] text-neutral-500 dark:text-neutral-400">
                  All visitors / window (0 = off)
                  <input type="number" min={0} className={inputCls} value={rlPerConn} onChange={(e) => setRlPerConn(e.target.value)} />
                </label>
                <label className="text-[10px] text-neutral-500 dark:text-neutral-400">
                  Window (seconds)
                  <input type="number" min={1} className={inputCls} value={rlWindowSec} onChange={(e) => setRlWindowSec(e.target.value)} />
                </label>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={saveRateLimits}
                  disabled={savingRl}
                  className="rounded bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
                >
                  {savingRl ? "Saving…" : "Save"}
                </button>
                {savedRl && <span className="text-[10px] text-green-600">Saved</span>}
              </div>
            </Modal>
          )}
        </div>
      ) : (
        // No connection yet — pick an environment, then connect it.
        <div className="space-y-2.5">
          <EnvSegments
            selected={sandbox}
            sandboxConnected={false}
            productionConnected={false}
            onSelect={selectEnv}
          />
          {renderConnectPrompt()}
        </div>
      )}
    </div>
  );
}

export function IntegrationsClient({
  providers,
  agents = [],
}: {
  providers: ProviderInfo[];
  agents?: AgentOption[];
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Integrations</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Connect third-party services once, then enable them per-agent in AI agent settings.
        </p>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800/50 dark:text-neutral-400">
          <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span>
            Credentials are encrypted at rest with <strong>AES-256-GCM</strong> and stored in the credentials vault.
            The encryption key is set via the <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-700">CREDENTIALS_ENCRYPTION_KEY</code> environment variable.
          </span>
        </div>
      </div>

      {providers.length === 0 ? (
        <p className="text-sm text-neutral-500">No integrations available. Check your API configuration.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((p) => (
            <ConnectorCard key={p.cardId ?? p.provider} info={p} agents={agents} />
          ))}
        </div>
      )}
    </div>
  );
}
