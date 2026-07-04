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
    rateLimitPerSession?: number;
    rateLimitPerConnection?: number;
    rateLimitWindowMs?: number;
    enabledAgentIds: string[];
    toolDefs?: ToolDef[];
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

function GuardrailRow({ tool }: { tool: ToolDef }) {
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
  const [namedAttendee, setNamedAttendee] = useState(g.requireNamedAttendee ?? false);
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
      const res = await fetch(`${API_URL}/integrations/tools/${tool._id}/guardrails`, {
        method: "PATCH",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({
          maxAmount: maxAmount === "" ? null : Number(maxAmount),
          maxDaysSincePurchase: maxDays === "" ? null : Number(maxDays),
          requireIdentityVerification: requireOtp,
          allowedContactEmails: emails.split(",").map((e) => e.trim()).filter(Boolean),
          businessHoursStart: bhStart,
          businessHoursEnd: bhEnd,
          businessDays: days,
          businessHoursTz: bhTz,
          requireNamedAttendee: namedAttendee,
          upgradeOnly,
          requireBillingOwner: billingOwner,
        }),
      });
      if (res.ok) setSaved(true);
      else setSaveError(true);
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

function GuardrailsPanel({ tools }: { tools: ToolDef[] }) {
  if (tools.length === 0) {
    return <p className="mt-2 text-xs text-neutral-400">No tools to configure.</p>;
  }
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 dark:border-neutral-700 dark:bg-neutral-800/60">
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
        Server-enforced limits the AI must respect for each tool.
      </p>
      {tools.map((t) => (
        <GuardrailRow key={t._id} tool={t} />
      ))}
    </div>
  );
}

// Per-tool registry: rename, custom description (fed to the AI so it calls the
// right tool for the right purpose), and which agents can access it.
function ToolRegistryRow({ tool, agents }: { tool: ToolDef; agents: AgentOption[] }) {
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
      if (res.ok) setSaved(true);
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
}: {
  tools: ToolDef[];
  agents: AgentOption[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Tool registry</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600">✕</button>
        </div>
        <p className="mb-3 text-[11px] text-neutral-500 dark:text-neutral-400">
          Each connection auto-exposes one or more tools to the AI. Rename them, write a custom
          description the AI reads to call the right tool, and pick which agents can use each.
        </p>
        {tools.length === 0 ? (
          <p className="text-xs text-neutral-400">No tools for this connection.</p>
        ) : (
          <div className="space-y-2">
            {tools.map((t) => (
              <ToolRegistryRow key={t._id} tool={t} agents={agents} />
            ))}
          </div>
        )}
      </div>
    </div>
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
  const [sandbox, setSandbox] = useState(info.connection?.sandbox ?? false);
  async function toggleSandbox() {
    if (!info.connection) return;
    const next = !sandbox;
    setSandbox(next);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/integrations/${info.connection._id}`, {
        method: "PATCH",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ sandbox: next }),
      });
      if (!res.ok) setSandbox(!next); // revert on non-2xx
    } catch {
      setSandbox(!next); // revert on network failure
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
      if (res.ok) setSavedRl(true);
    } catch {
      /* ignore */
    } finally {
      setSavingRl(false);
    }
  }

  async function handleConnect() {
    if (isOAuth) {
      setConnecting(true);
      try {
        const token = await getAccessToken();
        const res = await fetch(`${API_URL}/integrations/${info.provider}/connect`, {
          method: "POST",
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const data = (await res.json()) as { authUrl?: string };
        if (data.authUrl) {
          window.location.href = data.authUrl;
        }
      } catch {
        setConnecting(false);
      }
    } else {
      setShowKeyForm(true);
    }
  }

  async function handleKeySubmit(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    try {
      const token = await getAccessToken();
      await fetch(`${API_URL}/integrations/${info.provider}/connect`, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      window.location.reload();
    } finally {
      setConnecting(false);
    }
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

  const isConnected = info.connection?.status === "active";
  const isWebhook = info.provider === "webhook";

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-neutral-500" />
          <div>
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{label}</h3>
            {isConnected && info.connection!.name && info.connection!.name !== info.provider && (
              <p className="text-[11px] text-neutral-400 dark:text-neutral-500">{info.connection!.name}</p>
            )}
            {isConnected && info.connection!.description ? (
              <p className="mt-0.5 text-[11px] italic text-neutral-400 dark:text-neutral-500">{info.connection!.description}</p>
            ) : null}
          </div>
        </div>
        {info.connection && info.connection.status !== "revoked" ? (
          <StatusBadge status={info.connection.status} />
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

      {showKeyForm && isWebhook ? (
        <form onSubmit={handleWebhookSubmit} className="flex flex-col gap-2">
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
            Point the AI at any HTTP endpoint. Define the tool the AI sees + the JSON schema for its inputs.
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
            <button type="button" onClick={() => setShowKeyForm(false)} className="text-xs text-neutral-500 hover:underline">
              Cancel
            </button>
          </div>
        </form>
      ) : showKeyForm ? (
        <form onSubmit={handleKeySubmit} className="flex flex-col gap-2">
          {info.provider === "calcom" && (
            <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
              Get your API key at{" "}
              <a
                href="https://app.cal.com/settings/developer/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-neutral-600 dark:hover:text-neutral-300"
              >
                app.cal.com → Settings → API Keys
              </a>
            </p>
          )}
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
              placeholder={info.provider === "calcom" ? "cal_live_xxxx…" : "API key"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
            />
            <button
              type="submit"
              disabled={connecting}
              className="rounded-md bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              Save
            </button>
          </div>
        </form>
      ) : isConnected && editing ? (
        <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/60">
          <label className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">Connection name</label>
          <input
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            placeholder={label}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
          />
          <label className="mt-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
            Description <span className="font-normal text-neutral-400">— tells the AI when to use it</span>
          </label>
          <textarea
            className="min-h-[48px] rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            placeholder="e.g. Use when the customer wants to talk to sales"
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
          />
          <div className="mt-1 flex gap-2">
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
        </div>
      ) : isConnected ? (
        <div className="space-y-2">
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
            <button onClick={() => setShowGuardrails((v) => !v)} className="text-xs text-neutral-500 hover:underline">
              Guardrails
            </button>
            <button onClick={() => setShowRateLimits((v) => !v)} className="text-xs text-neutral-500 hover:underline">
              Rate limits
            </button>
            <button onClick={() => setShowRegistry(true)} className="text-xs text-neutral-500 hover:underline">
              Tool registry
            </button>
            <button onClick={handleRevoke} className="text-xs text-red-500 hover:underline ml-auto">
              Disconnect
            </button>
          </div>
          {showRegistry && (
            <ToolRegistryModal
              tools={info.connection!.toolDefs ?? []}
              agents={agents}
              onClose={() => setShowRegistry(false)}
            />
          )}
          {showGuardrails && <GuardrailsPanel tools={info.connection!.toolDefs ?? []} />}
          {showRateLimits && (
            <div className="rounded-md border border-neutral-200 p-2.5 dark:border-neutral-700">
              <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Rate limits</p>
              <p className="mt-0.5 text-[10px] text-neutral-500 dark:text-neutral-400">
                Caps AI tool calls in a sliding window. Over the limit, the AI gets a graceful
                &ldquo;couldn&rsquo;t do that right now&rdquo; turn instead of erroring.
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2">
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
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={saveRateLimits}
                  disabled={savingRl}
                  className="rounded bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
                >
                  {savingRl ? "Saving…" : "Save"}
                </button>
                {savedRl && <span className="text-[10px] text-green-600">Saved</span>}
              </div>
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={sandbox}
              onClick={toggleSandbox}
              className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                sandbox ? "bg-amber-500" : "bg-neutral-300 dark:bg-neutral-700"
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  sandbox ? "translate-x-3.5" : "translate-x-0.5"
                }`}
              />
            </button>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              Test mode {sandbox ? "— sandbox (no live data)" : "— off (production / live data)"}
            </span>
          </label>
        </div>
      ) : (
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {isOAuth ? (
            <>
              <ExternalLink className="h-3.5 w-3.5" />
              {connecting ? "Redirecting…" : "Connect via OAuth"}
            </>
          ) : (
            "Connect"
          )}
        </button>
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
