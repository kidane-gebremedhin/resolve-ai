"use client";

// Triggers management page — lets operators create, edit, enable/disable, and
// delete proactive triggers for their widget. Triggers are evaluated client-side
// in the embed loader; this page manages their definition in the database.

import { useCallback, useEffect, useState } from "react";
import { Zap, Plus, Trash2, ToggleLeft, ToggleRight, Loader2 } from "lucide-react";
import { API_URL } from "@/lib/app-urls";

async function getAccessToken(): Promise<string | undefined> {
  const res = await fetch("/api/session-token", { cache: "no-store" });
  const data = (await res.json()) as { accessToken?: string };
  return data.accessToken;
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

type Agent = { _id: string; name: string };

const CONDITION_LABELS: Record<ConditionType, string> = {
  time_on_page: "Time on page",
  scroll_depth: "Scroll depth",
  exit_intent: "Exit intent",
  url_match: "URL match",
  element_hover: "Element hover",
};

function conditionSummary(c: Condition): string {
  switch (c.type) {
    case "time_on_page":
      return `After ${(c.params.seconds as number) ?? ((c.params.ms as number) ?? 0) / 1000}s`;
    case "scroll_depth":
      return `Scrolled ${c.params.percent ?? 50}%`;
    case "exit_intent":
      return "Exit intent (mouse leave)";
    case "url_match":
      return `URL matches ${c.params.pattern ?? ""}`;
    case "element_hover":
      return `Hover on ${c.params.selector ?? ""}`;
    default:
      return c.type;
  }
}

const DEFAULT_FORM = {
  agentId: "",
  name: "",
  isActive: true,
  conditionType: "time_on_page" as ConditionType,
  conditionParams: { seconds: 10 } as Record<string, unknown>,
  conditionLogic: "AND" as "AND" | "OR",
  message: "",
  delayMs: 0,
  cooldownMs: 86400000,
  maxFires: 1,
};

export default function TriggersPage() {
  const [triggers, setTriggers] = useState<ProactiveTrigger[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const [triggersRes, agentsRes] = await Promise.all([
        fetch(`${API_URL}/triggers`, { headers }),
        fetch(`${API_URL}/agents`, { headers }),
      ]);
      const [triggersData, agentsData] = await Promise.all([
        triggersRes.json() as Promise<{ triggers: ProactiveTrigger[] }>,
        agentsRes.json() as Promise<Agent[]>,
      ]);
      setTriggers(triggersData.triggers ?? []);
      setAgents(Array.isArray(agentsData) ? agentsData : []);
      if (!form.agentId && (agentsData as Agent[]).length > 0) {
        setForm((f) => ({ ...f, agentId: (agentsData as Agent[])[0]._id }));
      }
    } catch {
      setError("Failed to load triggers.");
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  async function saveTrigger() {
    if (!form.agentId || !form.name || !form.message) {
      setError("Agent, name, and message are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const body = {
        agentId: form.agentId,
        name: form.name,
        isActive: form.isActive,
        conditions: [{ type: form.conditionType, params: form.conditionParams }],
        conditionLogic: form.conditionLogic,
        message: form.message,
        delayMs: form.delayMs,
        cooldownMs: form.cooldownMs,
        maxFires: form.maxFires,
      };
      const res = await fetch(`${API_URL}/triggers`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
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

  function updateFormParams(key: string, value: unknown) {
    setForm((f) => ({ ...f, conditionParams: { ...f.conditionParams, [key]: value } }));
  }

  function onConditionTypeChange(type: ConditionType) {
    const defaults: Record<ConditionType, Record<string, unknown>> = {
      time_on_page: { seconds: 10 },
      scroll_depth: { percent: 50 },
      exit_intent: {},
      url_match: { pattern: "" },
      element_hover: { selector: "" },
    };
    setForm((f) => ({ ...f, conditionType: type, conditionParams: defaults[type] }));
  }

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
              Automatically open the widget based on visitor behaviour.
            </p>
          </div>
        </div>
        <button
          onClick={() => { setShowForm(true); setError(null); }}
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
          <h2 className="mb-4 text-sm font-semibold">New trigger</h2>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Agent</label>
                <select
                  value={form.agentId}
                  onChange={(e) => setForm((f) => ({ ...f, agentId: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                >
                  {agents.map((a) => (
                    <option key={a._id} value={a._id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Pricing page nudge"
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Condition</label>
                <select
                  value={form.conditionType}
                  onChange={(e) => onConditionTypeChange(e.target.value as ConditionType)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                >
                  {Object.entries(CONDITION_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                {form.conditionType === "time_on_page" && (
                  <>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Seconds on page</label>
                    <input
                      type="number" min={1}
                      value={(form.conditionParams.seconds as number) ?? 10}
                      onChange={(e) => updateFormParams("seconds", Number(e.target.value))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                    />
                  </>
                )}
                {form.conditionType === "scroll_depth" && (
                  <>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Scroll % (0–100)</label>
                    <input
                      type="number" min={1} max={100}
                      value={(form.conditionParams.percent as number) ?? 50}
                      onChange={(e) => updateFormParams("percent", Number(e.target.value))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                    />
                  </>
                )}
                {form.conditionType === "url_match" && (
                  <>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">URL pattern (regex)</label>
                    <input
                      type="text"
                      value={(form.conditionParams.pattern as string) ?? ""}
                      onChange={(e) => updateFormParams("pattern", e.target.value)}
                      placeholder="/pricing"
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                    />
                  </>
                )}
                {form.conditionType === "element_hover" && (
                  <>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">CSS selector</label>
                    <input
                      type="text"
                      value={(form.conditionParams.selector as string) ?? ""}
                      onChange={(e) => updateFormParams("selector", e.target.value)}
                      placeholder="#pricing-cta"
                      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                    />
                  </>
                )}
                {form.conditionType === "exit_intent" && (
                  <p className="mt-5 text-xs text-muted-foreground">Fires when the visitor moves their mouse toward the browser chrome.</p>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Greeting message</label>
              <textarea
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                rows={2}
                placeholder="Hi! Looks like you're exploring our pricing. Can I help?"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Delay (ms)</label>
                <input
                  type="number" min={0}
                  value={form.delayMs}
                  onChange={(e) => setForm((f) => ({ ...f, delayMs: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Cooldown (ms)</label>
                <input
                  type="number" min={0}
                  value={form.cooldownMs}
                  onChange={(e) => setForm((f) => ({ ...f, cooldownMs: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Max fires</label>
                <input
                  type="number" min={1}
                  value={form.maxFires}
                  onChange={(e) => setForm((f) => ({ ...f, maxFires: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
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
                Save trigger
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
                  {t.conditions.map(conditionSummary).join(` ${t.conditionLogic} `)}{" "}
                  · delay {t.delayMs}ms · cooldown {Math.round(t.cooldownMs / 3_600_000)}h
                </p>
                <p className="mt-1 truncate text-xs text-foreground/70 italic">&ldquo;{t.message}&rdquo;</p>
              </div>
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
