'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Plus, X, Save, Loader2 } from "lucide-react";
import { Button } from "@csb/ui";
import { Input } from "@csb/ui";
import { Textarea } from "@csb/ui";
import { Label } from "@csb/ui";
import { Slider } from "@csb/ui";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@csb/ui";
import { clientApi, ApiError } from "@/lib/api";

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
};

/** Effective env defaults (GET /agents/defaults) used to prepopulate unset fields. */
export type AgentDefaults = {
  model: string;
  temperature: number;
  confidenceThreshold: number;
};

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
}: {
  agent: AgentDoc;
  defaults: AgentDefaults;
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
    <Tabs defaultValue="personality" className="mt-6">
      <TabsList>
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
