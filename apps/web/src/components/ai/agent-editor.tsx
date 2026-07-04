'use client';

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Plus, X, Save, Loader2, Wrench } from "lucide-react";
import { Button } from "@csb/ui";
import { Input } from "@csb/ui";
import { Textarea } from "@csb/ui";
import { Label } from "@csb/ui";
import { Slider } from "@csb/ui";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@csb/ui";
import { clientApi, ApiError } from "@/lib/api";
import { API_URL } from "@/lib/app-urls";

export type AgentDoc = {
  _id: string;
  name: string;
  description?: string;
  welcomeMessage?: string;
  suggestedQuestions?: string[];
  systemPromptOverride?: string;
  model?: string;
  temperature?: number;
  confidenceThreshold?: number;
  jiraProjectKey?: string;
};

/** Effective env defaults (GET /agents/defaults) used to prepopulate unset fields. */
export type AgentDefaults = {
  model: string;
  temperature: number;
  confidenceThreshold: number;
};

export type ConnectedTool = {
  connectionId: string;
  connectionName: string;
  provider: string;
  enabledAgentIds: string[];
};

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

async function getAccessToken(): Promise<string | undefined> {
  const res = await fetch("/api/session-token", { cache: "no-store" });
  const data = (await res.json()) as { accessToken?: string };
  return data.accessToken;
}

const MODELS = [
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", note: "Fast, default" },
  { id: "gpt-4o-mini", name: "GPT-4o mini", note: "Balanced reasoning" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", note: "Fast, low latency" },
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", note: "Highest quality" },
] as const;

/**
 * First-run agent creation. Renders inside /app/ai when the org has no agent
 * yet. Posts to `POST /agents` with a minimal payload (rest is editable after
 * creation), then revalidates the server component so the editor renders.
 */
export function CreateAgentForm({ websiteId }: { websiteId: string }): React.ReactElement {
  const router = useRouter();
  const [name, setName] = useState("Support agent");
  const [welcomeMessage, setWelcomeMessage] = useState(
    "Hi 👋 How can I help today?",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give your agent a name.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await clientApi.post("/agents", {
        websiteId,
        name: trimmed,
        welcomeMessage: welcomeMessage.trim() || undefined,
        suggestedQuestions: [],
        isActive: true,
      });
      // Re-fetch the server component so the editor takes over.
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create agent.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-6 rounded-xl border border-border bg-card p-6"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-foreground text-background">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold tracking-tight">
            Create your first AI agent
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Set a name and an opening message. You can refine personality,
            model, and fallback behavior after creating it.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <Label htmlFor="agent-name" className="text-xs">
            Agent name
          </Label>
          <Input
            id="agent-name"
            className="mt-1.5"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={submitting}
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="agent-welcome" className="text-xs">
            Welcome message
          </Label>
          <Textarea
            id="agent-welcome"
            className="mt-1.5 min-h-20"
            value={welcomeMessage}
            onChange={(e) => setWelcomeMessage(e.target.value)}
            placeholder="Hi 👋 How can I help today?"
            disabled={submitting}
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center justify-end gap-3">
        <Button type="submit" disabled={submitting} className="gap-1.5">
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          {submitting ? "Creating…" : "Create agent"}
        </Button>
      </div>
    </form>
  );
}

export function AgentEditor({
  agent,
  defaults,
  connections = [],
}: {
  agent: AgentDoc;
  defaults: AgentDefaults;
  connections?: ConnectedTool[];
}): React.ReactElement {
  const [description, setDescription] = useState(agent.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPromptOverride ?? "");
  const [welcomeMessage, setWelcomeMessage] = useState(agent.welcomeMessage ?? "");
  // Unset fields fall back to the env-derived effective defaults, so the form
  // shows what's actually running (and a save then persists/overrides it).
  const [model, setModel] = useState(agent.model ?? defaults.model);
  const [temperature, setTemperature] = useState<number>(agent.temperature ?? defaults.temperature);
  const [confidence, setConfidence] = useState<number>(
    agent.confidenceThreshold ?? defaults.confidenceThreshold,
  );
  const [suggested, setSuggested] = useState<string[]>(agent.suggestedQuestions ?? []);
  const [newSuggestion, setNewSuggestion] = useState("");

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jiraProjectKey, setJiraProjectKey] = useState(agent.jiraProjectKey ?? "");
  // Real Jira projects for the pick-list (so operators can't save a key that
  // doesn't exist). Falls back to a free-text field if the list can't load.
  const [jiraProjects, setJiraProjects] = useState<{ key: string; name: string }[] | null>(null);
  const hasJira = connections.some((c) => c.provider === "jira");
  useEffect(() => {
    if (!hasJira) return;
    let cancelled = false;
    clientApi
      .get<{ projects: { key: string; name: string }[] }>("/integrations/jira/projects")
      .then((r) => {
        if (!cancelled) setJiraProjects(r.projects ?? []);
      })
      .catch(() => {
        if (!cancelled) setJiraProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [hasJira]);

  // Per-connection enabled state for this agent's tools
  const [toolEnabled, setToolEnabled] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of connections) {
      init[c.connectionId] = c.enabledAgentIds.includes(agent._id);
    }
    return init;
  });
  const [toolSaving, setToolSaving] = useState<Record<string, boolean>>({});

  async function toggleTool(connectionId: string, enable: boolean) {
    setToolEnabled((prev) => ({ ...prev, [connectionId]: enable }));
    setToolSaving((prev) => ({ ...prev, [connectionId]: true }));
    try {
      const conn = connections.find((c) => c.connectionId === connectionId);
      if (!conn) return;
      const currentIds = new Set(conn.enabledAgentIds);
      if (enable) currentIds.add(agent._id);
      else currentIds.delete(agent._id);
      const token = await getAccessToken();
      await fetch(`${API_URL}/integrations/${connectionId}`, {
        method: "PATCH",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabledAgentIds: [...currentIds] }),
      });
      // Update local copy so subsequent toggles see correct state
      conn.enabledAgentIds = [...currentIds];
    } catch {
      // Revert on error
      setToolEnabled((prev) => ({ ...prev, [connectionId]: !enable }));
    } finally {
      setToolSaving((prev) => ({ ...prev, [connectionId]: false }));
    }
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await clientApi.patch<AgentDoc>(`/agents/${agent._id}`, {
        description,
        systemPromptOverride: systemPrompt,
        welcomeMessage,
        model,
        temperature,
        confidenceThreshold: confidence,
        suggestedQuestions: suggested,
        jiraProjectKey: jiraProjectKey.trim(),
      });
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  function addSuggestion(): void {
    const trimmed = newSuggestion.trim();
    if (!trimmed) return;
    setSuggested((prev) => [...prev, trimmed]);
    setNewSuggestion("");
  }

  function removeSuggestion(idx: number): void {
    setSuggested((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <Tabs defaultValue="tools" className="mt-6">
      <TabsList>
        <TabsTrigger value="tools" className="flex items-center gap-1.5">
          <Wrench className="h-3.5 w-3.5" /> Tools
        </TabsTrigger>
        <TabsTrigger value="personality">Personality</TabsTrigger>
        <TabsTrigger value="model">Model</TabsTrigger>
        <TabsTrigger value="suggestions">Suggested questions</TabsTrigger>
        <TabsTrigger value="fallback">Fallback</TabsTrigger>
      </TabsList>

      <TabsContent value="personality" className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-border bg-card p-5">
            <Label htmlFor="tone" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tone & personality
            </Label>
            <Textarea
              id="tone"
              rows={3}
              className="mt-3"
              placeholder="Describe how the agent should sound (e.g. friendly, concise, professional)."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <Label htmlFor="instr" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Custom instructions (system prompt override)
            </Label>
            <Textarea
              id="instr"
              rows={8}
              className="mt-3 font-mono text-xs"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Confidence threshold
            </div>
            <div className="mt-4">
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[confidence]}
                onValueChange={(v) => setConfidence(v[0] ?? 0.7)}
              />
              <div className="mt-2 text-xs text-muted-foreground">
                {(confidence * 100).toFixed(0)}% — below this, the agent escalates instead of guessing.
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 text-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" /> Live values
            </div>
            <dl className="mt-3 space-y-1.5 text-xs text-muted-foreground">
              <div className="flex justify-between"><dt>Model</dt><dd className="text-foreground">{model}</dd></div>
              <div className="flex justify-between"><dt>Temperature</dt><dd className="text-foreground">{temperature.toFixed(2)}</dd></div>
              <div className="flex justify-between"><dt>Confidence</dt><dd className="text-foreground">{(confidence * 100).toFixed(0)}%</dd></div>
            </dl>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="model" className="mt-6 space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setModel(m.id)}
              className={`rounded-xl border p-4 text-left transition ${
                model === m.id
                  ? "border-foreground bg-card ring-1 ring-foreground"
                  : "border-border bg-card hover:bg-surface"
              }`}
            >
              <div className="font-display text-sm font-semibold">{m.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{m.note}</div>
              <div className="mt-2 font-mono text-[10px] text-muted-foreground">{m.id}</div>
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Temperature</div>
          <div className="mt-4">
            <Slider
              min={0}
              max={2}
              step={0.05}
              value={[temperature]}
              onValueChange={(v) => setTemperature(v[0] ?? 0.7)}
            />
            <div className="mt-2 text-xs text-muted-foreground">
              {temperature.toFixed(2)} — lower is more deterministic, higher is more creative.
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="suggestions" className="mt-6">
        <div className="rounded-xl border border-border bg-card p-5">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Suggested questions
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Chips visitors see in the widget before they start typing.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {suggested.map((q, i) => (
              <span
                key={`${q}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs"
              >
                {q}
                <button
                  type="button"
                  onClick={() => removeSuggestion(i)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${q}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {suggested.length === 0 && (
              <span className="text-xs text-muted-foreground">No suggestions yet.</span>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <Input
              placeholder="e.g. How do I cancel my subscription?"
              value={newSuggestion}
              onChange={(e) => setNewSuggestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSuggestion();
                }
              }}
            />
            <Button type="button" size="sm" onClick={addSuggestion} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="fallback" className="mt-6">
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Greeting / fallback message
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Shown when the conversation starts and reused as a generic fallback when the agent
              is unsure.
              {/* TODO: separate fallback from welcome once the API exposes a dedicated field. */}
            </p>
            <Textarea
              className="mt-2"
              rows={4}
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              placeholder="Hi there! I'm here to help — ask me anything about our product."
            />
          </div>
        </div>
      </TabsContent>

      <TabsContent value="tools" className="mt-6">
        <div className="rounded-xl border border-border bg-card p-5">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Enabled tools
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Toggle which connected integrations this agent can use. Connect services first in{" "}
            <a href="/app/integrations" className="underline hover:text-foreground">Integrations</a>.
          </p>
          {connections.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No integrations connected yet.{" "}
              <a href="/app/integrations" className="underline hover:text-foreground">Connect one now.</a>
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {connections.map((conn) => (
                <div
                  key={conn.connectionId}
                  className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {PROVIDER_LABELS[conn.provider] ?? conn.provider}
                    </p>
                    {conn.connectionName && conn.connectionName !== conn.provider && (
                      <p className="text-xs text-muted-foreground">{conn.connectionName}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={toolEnabled[conn.connectionId] ?? false}
                    disabled={toolSaving[conn.connectionId]}
                    onClick={() => toggleTool(conn.connectionId, !(toolEnabled[conn.connectionId] ?? false))}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none disabled:opacity-50 ${
                      (toolEnabled[conn.connectionId] ?? false)
                        ? "bg-foreground"
                        : "bg-muted"
                    }`}
                  >
                    <span
                      className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg transition-transform ${
                        (toolEnabled[conn.connectionId] ?? false) ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          )}
          {hasJira && (
            <div className="mt-4 rounded-lg border border-border px-4 py-3">
              <Label htmlFor="jira-project" className="text-xs font-medium text-foreground">
                Jira project
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Tickets this agent files go to this project. Leave as “Auto-pick” to
                let the system choose.
              </p>
              {jiraProjects && jiraProjects.length > 0 ? (
                <select
                  id="jira-project"
                  className="mt-2 block w-full max-w-[280px] rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={jiraProjectKey}
                  onChange={(e) => setJiraProjectKey(e.target.value)}
                >
                  <option value="">Auto-pick a project</option>
                  {jiraProjects.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name} ({p.key})
                    </option>
                  ))}
                  {/* Surface a previously-saved key that no longer exists in Jira
                      (e.g. a typo like "PTKA") so it's visible, not silently blank. */}
                  {jiraProjectKey && !jiraProjects.some((p) => p.key === jiraProjectKey) && (
                    <option value={jiraProjectKey}>{jiraProjectKey} — not found in Jira</option>
                  )}
                </select>
              ) : (
                // Fallback: projects couldn't be loaded — keep free-text entry.
                <Input
                  id="jira-project"
                  className="mt-2 max-w-[200px] font-mono"
                  placeholder="SUPPORT"
                  value={jiraProjectKey}
                  onChange={(e) => setJiraProjectKey(e.target.value.toUpperCase())}
                />
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">Saved with “Save changes” below.</p>
            </div>
          )}
        </div>
      </TabsContent>

      <div className="mt-6 flex items-center justify-end gap-3">
        {error && <span className="text-xs text-destructive">{error}</span>}
        {savedAt && !error && (
          <span className="text-xs text-success">Saved.</span>
        )}
        <Button onClick={save} disabled={saving} className="gap-1.5">
          <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </Tabs>
  );
}
