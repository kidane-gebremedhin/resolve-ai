"use client";

// Triggers management page — lets operators create, edit, enable/disable, and
// delete proactive triggers for their widget. Triggers are evaluated client-side
// in the embed loader; this page manages their definition in the database.
//
// There is exactly one agent per website, so this page does NOT ask the operator
// to pick an agent — it resolves the agent for the workspace's active website
// automatically and scopes triggers to it. Each trigger can combine multiple
// conditions (AND/ANY), and existing triggers are editable.

import { useCallback, useEffect, useState } from "react";
import { Zap, Plus, Trash2, ToggleLeft, ToggleRight, Loader2, Pencil, X } from "lucide-react";
import { API_URL } from "@/lib/app-urls";

async function getAccessToken(): Promise<string | undefined> {
  const res = await fetch("/api/session-token", { cache: "no-store" });
  const data = (await res.json()) as { accessToken?: string };
  return data.accessToken;
}

// The dashboard's active website is stored in the `csb_website` cookie (set by the
// workspace switcher). We resolve the single agent for that website below.
function getActiveWebsiteId(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.cookie.match(/(?:^|;\s*)csb_website=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : undefined;
}

type ConditionType =
  | "time_on_page"
  | "scroll_depth"
  | "exit_intent"
  | "url_match"
  | "element_hover";

type Condition = {
  type: ConditionType;
  params: Record<string, unknown>;
};

type ProactiveTrigger = {
  _id: string;
  agentId: string;
  name: string;
  isActive: boolean;
  conditions: Condition[];
  conditionLogic: "AND" | "OR";
  message: string;
  delayMs: number;
  cooldownMs: number;
  maxFires: number;
};

const CONDITION_LABELS: Record<ConditionType, string> = {
  time_on_page: "Time on page",
  scroll_depth: "Scroll depth",
  exit_intent: "Exit intent",
  url_match: "URL match",
  element_hover: "Element hover",
};

const CONDITION_DEFAULTS: Record<ConditionType, Record<string, unknown>> = {
  time_on_page: { seconds: 10 },
  scroll_depth: { percent: 50 },
  exit_intent: {},
  url_match: { pattern: "" },
  element_hover: { selector: "" },
};

function conditionSummary(c: Condition): string {
  switch (c.type) {
    case "time_on_page":
      return `on page ${(c.params.seconds as number) ?? ((c.params.ms as number) ?? 0) / 1000}s`;
    case "scroll_depth":
      return `scrolled ${c.params.percent ?? 50}%`;
    case "exit_intent":
      return "exit intent";
    case "url_match":
      return `URL ~ ${c.params.pattern ?? ""}`;
    case "element_hover":
      return `hover ${c.params.selector ?? ""}`;
    default:
      return c.type;
  }
}

type FormState = {
  _id?: string; // set when editing an existing trigger
  name: string;
  isActive: boolean;
  conditions: Condition[];
  conditionLogic: "AND" | "OR";
  message: string;
  delayMs: number;
  cooldownMs: number;
  maxFires: number;
};

const DEFAULT_FORM: FormState = {
  name: "",
  isActive: true,
  conditions: [{ type: "time_on_page", params: { seconds: 10 } }],
  conditionLogic: "AND",
  message: "",
  delayMs: 0,
  cooldownMs: 86400000,
  maxFires: 1,
};

export default function TriggersPage() {
  const [triggers, setTriggers] = useState<ProactiveTrigger[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      // Resolve the single agent for the active website first, then scope triggers
      // to it — no agent picker needed. If the website scope is "All websites" or the
      // cookie is stale (points at a website with no agent), fall back to the org's
      // first agent so the page still works.
      const websiteId = getActiveWebsiteId();
      const fetchAgents = async (url: string) => {
        const r = await fetch(url, { headers });
        const d = (await r.json()) as { _id: string }[];
        return Array.isArray(d) ? d : [];
      };
      let agentsData = websiteId
        ? await fetchAgents(`${API_URL}/agents?websiteId=${encodeURIComponent(websiteId)}`)
        : [];
      if (agentsData.length === 0) agentsData = await fetchAgents(`${API_URL}/agents`);
      const resolvedAgentId = agentsData[0]?._id ?? null;
      setAgentId(resolvedAgentId);
      const triggersRes = await fetch(
        `${API_URL}/triggers${resolvedAgentId ? `?agentId=${resolvedAgentId}` : ""}`,
        { headers },
      );
      const triggersData = (await triggersRes.json()) as { triggers: ProactiveTrigger[] };
      setTriggers(triggersData.triggers ?? []);
    } catch {
      setError("Failed to load triggers.");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setForm(DEFAULT_FORM);
    setShowForm(true);
    setError(null);
  }

  function openEdit(t: ProactiveTrigger) {
    setForm({
      _id: t._id,
      name: t.name,
      isActive: t.isActive,
      conditions: t.conditions.length > 0 ? t.conditions : DEFAULT_FORM.conditions,
      conditionLogic: t.conditionLogic ?? "AND",
      message: t.message,
      delayMs: t.delayMs,
      cooldownMs: t.cooldownMs,
      maxFires: t.maxFires,
    });
    setShowForm(true);
    setError(null);
  }

  async function saveTrigger() {
    if (!form.name.trim() || !form.message.trim()) {
      setError("Name and message are required.");
      return;
    }
    if (!form._id && !agentId) {
      setError("No agent found for this website. Create an agent first.");
      return;
    }
    if (form.conditions.length === 0) {
      setError("Add at least one condition.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const common = {
        name: form.name,
        isActive: form.isActive,
        conditions: form.conditions,
        conditionLogic: form.conditionLogic,
        message: form.message,
        delayMs: form.delayMs,
        cooldownMs: form.cooldownMs,
        maxFires: form.maxFires,
      };
      // Edit → PATCH (agentId is immutable); Create → POST with the resolved agent.
      const res = form._id
        ? await fetch(`${API_URL}/triggers/${form._id}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify(common),
          })
        : await fetch(`${API_URL}/triggers`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...common, agentId }),
          });
      if (!res.ok) {
        const e = (await res.json()) as { error?: string };
        throw new Error(e.error ?? "Failed to save.");
      }
      setShowForm(false);
      setForm(DEFAULT_FORM);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleTrigger(id: string, isActive: boolean) {
    const token = await getAccessToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    await fetch(`${API_URL}/triggers/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ isActive }),
    });
    setTriggers((ts) => ts.map((t) => (t._id === id ? { ...t, isActive } : t)));
  }

  async function deleteTrigger(id: string) {
    if (!confirm("Delete this trigger?")) return;
    const token = await getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    await fetch(`${API_URL}/triggers/${id}`, { method: "DELETE", headers });
    setTriggers((ts) => ts.filter((t) => t._id !== id));
  }

  // ---- Condition list editing ----
  function addCondition() {
    setForm((f) => ({
      ...f,
      conditions: [...f.conditions, { type: "url_match", params: { ...CONDITION_DEFAULTS.url_match } }],
    }));
  }
  function removeCondition(idx: number) {
    setForm((f) => ({ ...f, conditions: f.conditions.filter((_, i) => i !== idx) }));
  }
  function setConditionType(idx: number, type: ConditionType) {
    setForm((f) => ({
      ...f,
      conditions: f.conditions.map((c, i) => (i === idx ? { type, params: { ...CONDITION_DEFAULTS[type] } } : c)),
    }));
  }
  function setConditionParam(idx: number, key: string, value: unknown) {
    setForm((f) => ({
      ...f,
      conditions: f.conditions.map((c, i) => (i === idx ? { ...c, params: { ...c.params, [key]: value } } : c)),
    }));
  }

  const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm";

  return (
    <div className="container-page max-w-3xl py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-foreground text-background">
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight">Proactive Triggers</h1>
            <p className="text-xs text-muted-foreground">
              Open the widget with a contextual nudge based on what the visitor is doing. Combine
              conditions (e.g. on /pricing for 30s <em>and</em> exit intent) for precise targeting.
            </p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background transition hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" />
          Add trigger
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {showForm && (
        <div className="mb-6 rounded-xl border border-border bg-surface/60 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{form._id ? "Edit trigger" : "New trigger"}</h2>
            <button
              onClick={() => { setShowForm(false); setForm(DEFAULT_FORM); setError(null); }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Pricing page nudge"
                className={inputCls}
              />
            </div>

            {/* ---- Conditions (combinable) ---- */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Conditions</label>
                {form.conditions.length > 1 && (
                  <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <span>Fire when</span>
                    <select
                      value={form.conditionLogic}
                      onChange={(e) => setForm((f) => ({ ...f, conditionLogic: e.target.value as "AND" | "OR" }))}
                      className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs font-medium"
                    >
                      <option value="AND">ALL match</option>
                      <option value="OR">ANY matches</option>
                    </select>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {form.conditions.map((c, idx) => (
                  <div key={idx} className="flex items-start gap-2 rounded-lg border border-border bg-background/50 p-2">
                    <select
                      value={c.type}
                      onChange={(e) => setConditionType(idx, e.target.value as ConditionType)}
                      className="w-40 shrink-0 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                    >
                      {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                    <div className="min-w-0 flex-1">
                      {c.type === "time_on_page" && (
                        <input
                          type="number" min={1}
                          value={(c.params.seconds as number) ?? 10}
                          onChange={(e) => setConditionParam(idx, "seconds", Number(e.target.value))}
                          placeholder="Seconds on page"
                          className={inputCls}
                        />
                      )}
                      {c.type === "scroll_depth" && (
                        <input
                          type="number" min={1} max={100}
                          value={(c.params.percent as number) ?? 50}
                          onChange={(e) => setConditionParam(idx, "percent", Number(e.target.value))}
                          placeholder="Scroll % (0–100)"
                          className={inputCls}
                        />
                      )}
                      {c.type === "url_match" && (
                        <input
                          type="text"
                          value={(c.params.pattern as string) ?? ""}
                          onChange={(e) => setConditionParam(idx, "pattern", e.target.value)}
                          placeholder="URL pattern e.g. /pricing"
                          className={inputCls}
                        />
                      )}
                      {c.type === "element_hover" && (
                        <input
                          type="text"
                          value={(c.params.selector as string) ?? ""}
                          onChange={(e) => setConditionParam(idx, "selector", e.target.value)}
                          placeholder="CSS selector e.g. #pricing-cta"
                          className={inputCls}
                        />
                      )}
                      {c.type === "exit_intent" && (
                        <p className="px-1 py-1.5 text-xs text-muted-foreground">Fires when the visitor moves the mouse toward the browser chrome.</p>
                      )}
                    </div>
                    {form.conditions.length > 1 && (
                      <button
                        onClick={() => removeCondition(idx)}
                        className="mt-1.5 shrink-0 text-muted-foreground transition hover:text-red-600"
                        aria-label="Remove condition"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={addCondition}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" /> Add condition
              </button>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Greeting message</label>
              <textarea
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                rows={2}
                placeholder="Hi! Looks like you're exploring our pricing. Can I help?"
                className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Delay (ms)</label>
                <input
                  type="number" min={0}
                  value={form.delayMs}
                  onChange={(e) => setForm((f) => ({ ...f, delayMs: Number(e.target.value) }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Cooldown (ms)</label>
                <input
                  type="number" min={0}
                  value={form.cooldownMs}
                  onChange={(e) => setForm((f) => ({ ...f, cooldownMs: Number(e.target.value) }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Max fires</label>
                <input
                  type="number" min={1}
                  value={form.maxFires}
                  onChange={(e) => setForm((f) => ({ ...f, maxFires: Number(e.target.value) }))}
                  className={inputCls}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => { setShowForm(false); setForm(DEFAULT_FORM); setError(null); }}
                className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveTrigger()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {form._id ? "Save changes" : "Save trigger"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : triggers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface/40 p-10 text-center">
          <Zap className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">No triggers yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add your first trigger to start proactively engaging visitors.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {triggers.map((t) => (
            <div key={t._id} className="flex items-start gap-3 p-4">
              <button
                onClick={() => void toggleTrigger(t._id, !t.isActive)}
                aria-label={t.isActive ? "Disable trigger" : "Enable trigger"}
                className="mt-0.5 shrink-0 text-muted-foreground transition hover:text-foreground"
              >
                {t.isActive ? (
                  <ToggleRight className="h-5 w-5 text-green-600" />
                ) : (
                  <ToggleLeft className="h-5 w-5" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t.conditions.map(conditionSummary).join(t.conditionLogic === "OR" ? " OR " : " AND ")}{" "}
                  · delay {t.delayMs}ms · cooldown {Math.round(t.cooldownMs / 3_600_000)}h
                </p>
                <p className="mt-1 truncate text-xs italic text-foreground/70">&ldquo;{t.message}&rdquo;</p>
              </div>
              <button
                onClick={() => openEdit(t)}
                aria-label="Edit trigger"
                className="shrink-0 text-muted-foreground transition hover:text-foreground"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => void deleteTrigger(t._id)}
                aria-label="Delete trigger"
                className="shrink-0 text-muted-foreground transition hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
