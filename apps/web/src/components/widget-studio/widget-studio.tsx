"use client";

// Widget Studio — operator-facing editor that persists BOTH the Agent record
// (persona/behavior) AND the WidgetSettings doc (cosmetic: color, position,
// theme, branding strings) for the org's active agent.
//
// Save flow:
//   1. Compute the partial diff between baseline and draft.
//   2. PATCH /agents/:id with agent-shaped fields.
//   3. PUT /widget-settings/:agentId with widget-shaped fields (upsert).
//   4. On success, fold the response back into baseline so the next diff is
//      empty until the operator edits again.
//
// Live preview: the iframe URL embeds the working draft via query params
// (?primaryColor=...&position=...&theme=...) so the widget app reflects edits
// immediately, even before save. The widget app is responsible for reading
// these query params — we just hand them off.

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  Code2,
  ExternalLink,
  Monitor,
  Palette,
  Pencil,
  Plus,
  Settings2,
  Smartphone,
  Trash2,
  Type as TypeIcon,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Label,
  Slider,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@csb/ui";
import { clientApi, ApiError } from "@/lib/api";

export type Agent = {
  _id: string;
  name: string;
  description?: string;
  welcomeMessage?: string;
  suggestedQuestions?: string[];
  systemPromptOverride?: string;
  model?: string;
  temperature?: number;
  confidenceThreshold?: number;
  isActive?: boolean;
  avatarUrl?: string;
};

export type WidgetSettings = {
  _id?: string;
  organizationId?: string;
  agentId?: string;
  welcomeMessage?: string;
  primaryColor?: string;
  position?: "bottom-right" | "bottom-left" | "centered";
  theme?: "light" | "dark" | "auto";
  showBranding?: boolean;
  avatarUrl?: string;
  offlineMessage?: string;
  requireContactBeforeChat?: boolean;
};

const MODELS = [
  { value: "openai/gpt-4o-mini", label: "OpenAI · gpt-4o-mini" },
  { value: "openai/gpt-4o", label: "OpenAI · gpt-4o" },
  { value: "anthropic/claude-3.5-sonnet", label: "Anthropic · claude-3.5-sonnet" },
] as const;

const POSITIONS = [
  { id: "bottom-right", label: "Bottom right" },
  { id: "bottom-left", label: "Bottom left" },
  { id: "centered", label: "Centered" },
] as const;

const THEMES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "auto", label: "Auto" },
] as const;

const COLORS = [
  "#1e40af",
  "#0a0a0a",
  "#0f766e",
  "#16a34a",
  "#ea580c",
  "#db2777",
  "#7c3aed",
  "#dc2626",
];

type AgentEditable = {
  name: string;
  welcomeMessage: string;
  suggestedQuestions: string[];
  systemPromptOverride: string;
  model: string;
  temperature: number;
  confidenceThreshold: number;
};

type SettingsEditable = {
  primaryColor: string;
  position: "bottom-right" | "bottom-left" | "centered";
  theme: "light" | "dark" | "auto";
  avatarUrl: string;
  showBranding: boolean;
};

export type AgentDefaults = {
  model: string;
  temperature: number;
  confidenceThreshold: number;
};

function toAgentEditable(agent: Agent, defaults: AgentDefaults): AgentEditable {
  return {
    name: agent.name ?? "",
    welcomeMessage: agent.welcomeMessage ?? "",
    suggestedQuestions: agent.suggestedQuestions ?? [],
    systemPromptOverride: agent.systemPromptOverride ?? "",
    // Unset fields fall back to the env-derived effective defaults.
    model: agent.model ?? defaults.model,
    temperature: agent.temperature ?? defaults.temperature,
    confidenceThreshold: agent.confidenceThreshold ?? defaults.confidenceThreshold,
  };
}

function toSettingsEditable(
  s: WidgetSettings | null,
  agentAvatarUrl?: string,
): SettingsEditable {
  return {
    primaryColor: s?.primaryColor ?? COLORS[0],
    position: s?.position ?? "bottom-right",
    theme: s?.theme ?? "light",
    // Pre-fill with the agent's configured avatar (e.g. the favicon captured on
    // website-KB sync) when the widget settings don't override it.
    avatarUrl: s?.avatarUrl || agentAvatarUrl || "",
    showBranding: s?.showBranding ?? true,
  };
}

function diffAgent(a: AgentEditable, b: AgentEditable): Partial<AgentEditable> {
  const out: Partial<AgentEditable> = {};
  if (a.name !== b.name) out.name = b.name;
  if (a.welcomeMessage !== b.welcomeMessage) out.welcomeMessage = b.welcomeMessage;
  if (a.systemPromptOverride !== b.systemPromptOverride)
    out.systemPromptOverride = b.systemPromptOverride;
  if (a.model !== b.model) out.model = b.model;
  if (a.temperature !== b.temperature) out.temperature = b.temperature;
  if (a.confidenceThreshold !== b.confidenceThreshold)
    out.confidenceThreshold = b.confidenceThreshold;
  if (
    a.suggestedQuestions.length !== b.suggestedQuestions.length ||
    a.suggestedQuestions.some((q, i) => q !== b.suggestedQuestions[i])
  ) {
    out.suggestedQuestions = b.suggestedQuestions;
  }
  return out;
}

function diffSettings(
  a: SettingsEditable,
  b: SettingsEditable,
): Partial<SettingsEditable> {
  const out: Partial<SettingsEditable> = {};
  (Object.keys(b) as (keyof SettingsEditable)[]).forEach((k) => {
    if (a[k] !== b[k]) (out as Record<string, unknown>)[k] = b[k];
  });
  return out;
}

export function WidgetStudio({
  initialAgent,
  initialSettings,
  widgetUrl,
  agentDefaults,
}: {
  initialAgent: Agent | null;
  initialSettings: WidgetSettings | null;
  widgetUrl: string;
  agentDefaults: AgentDefaults;
}) {
  const [agent, setAgent] = useState<Agent | null>(initialAgent);
  const [savedSettings, setSavedSettings] = useState<WidgetSettings | null>(
    initialSettings,
  );

  const agentBaseline = useMemo(
    () => (agent ? toAgentEditable(agent, agentDefaults) : null),
    [agent, agentDefaults],
  );
  const settingsBaseline = useMemo(
    () => toSettingsEditable(savedSettings, agent?.avatarUrl),
    [savedSettings, agent?.avatarUrl],
  );

  const [agentDraft, setAgentDraft] = useState<AgentEditable | null>(agentBaseline);
  const [settingsDraft, setSettingsDraft] = useState<SettingsEditable>(settingsBaseline);

  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  if (!agent || !agentDraft || !agentBaseline) {
    return <NoAgentState />;
  }

  const agentPatch = diffAgent(agentBaseline, agentDraft);
  const settingsPatch = diffSettings(settingsBaseline, settingsDraft);
  const dirty =
    Object.keys(agentPatch).length > 0 || Object.keys(settingsPatch).length > 0;

  function updateAgent<K extends keyof AgentEditable>(key: K, value: AgentEditable[K]) {
    setAgentDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }
  function updateSettings<K extends keyof SettingsEditable>(
    key: K,
    value: SettingsEditable[K],
  ) {
    setSettingsDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (!agent || !agentBaseline || !agentDraft) return;
    setBusy(true);
    setError(null);
    try {
      // Agent first, then widget settings. Both are idempotent so a partial
      // failure leaves the system in a consistent (if mixed) state.
      if (Object.keys(agentPatch).length > 0) {
        const next = await clientApi.patch<Agent>(`/agents/${agent._id}`, agentPatch);
        setAgent(next);
      }
      // Always PUT the full settings so the WidgetSettings document is created
      // (upsert) even on the first save with defaults. Without this the
      // appearance endpoint falls back to hard-coded defaults and config
      // like position never takes effect.
      const next = await clientApi.put<WidgetSettings>(
        `/widget-settings/${agent._id}`,
        settingsDraft,
      );
      setSavedSettings(next);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setAgentDraft(agentBaseline);
    setSettingsDraft(settingsBaseline);
    setError(null);
  }

  // Build the live-preview iframe URL with the working draft so the widget app
  // can paint the operator's WIP cosmetics without a save.
  const previewSrc = (() => {
    const u = new URL(widgetUrl);
    // Pass this org's agentId so the preview resolves to THIS organization —
    // it uses this org's knowledge base and any conversations land in this
    // org's inbox. Without it the widget falls back to the default domain
    // (the seed demo org).
    if (agent?._id) u.searchParams.set("agentId", agent._id);
    u.searchParams.set("primaryColor", settingsDraft.primaryColor);
    u.searchParams.set("position", settingsDraft.position);
    u.searchParams.set("theme", settingsDraft.theme);
    return u.toString();
  })();

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Widget studio
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Edit your AI agent&apos;s persona, behavior, and embed appearance. Saves to
            agent and widget-settings together.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-success" /> {agent.name}
          </Badge>
          {dirty && (
            <Button size="sm" variant="outline" onClick={reset} disabled={busy}>
              Discard
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {savedAt && !dirty && !error && (
        <div className="mt-4 inline-flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-1.5 text-xs text-success">
          <Check className="h-3.5 w-3.5" /> Saved
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Tabs defaultValue="design">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="design" className="gap-1.5">
                <Palette className="h-3.5 w-3.5" /> Design
              </TabsTrigger>
              <TabsTrigger value="content" className="gap-1.5">
                <TypeIcon className="h-3.5 w-3.5" /> Content
              </TabsTrigger>
              <TabsTrigger value="behavior" className="gap-1.5">
                <Settings2 className="h-3.5 w-3.5" /> Behavior
              </TabsTrigger>
            </TabsList>

            <TabsContent value="design" className="mt-4 space-y-4">
              <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div>
                  <Label className="text-xs">Agent name</Label>
                  <Input
                    className="mt-1.5"
                    value={agentDraft.name}
                    onChange={(e) => updateAgent("name", e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Welcome message</Label>
                  <Textarea
                    className="mt-1.5 min-h-20"
                    value={agentDraft.welcomeMessage}
                    onChange={(e) => updateAgent("welcomeMessage", e.target.value)}
                    placeholder="Hi! How can I help today?"
                  />
                </div>
                <SuggestedQuestionsEditor
                  questions={agentDraft.suggestedQuestions}
                  onChange={(q) => updateAgent("suggestedQuestions", q)}
                />
              </div>

              <SectionsManager agentId={agent._id} />

              <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div>
                  <Label className="text-xs">Avatar URL</Label>
                  <Input
                    className="mt-1.5"
                    value={settingsDraft.avatarUrl}
                    onChange={(e) => updateSettings("avatarUrl", e.target.value)}
                    placeholder="https://…/avatar.png"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Defaults to the website&apos;s icon captured during knowledge-base sync.
                  </p>
                </div>
              </div>

              <ColorPickerCard
                value={settingsDraft.primaryColor}
                onChange={(c) => updateSettings("primaryColor", c)}
              />

              <RadioCard
                label="Launcher position"
                options={POSITIONS}
                value={settingsDraft.position}
                onChange={(v) => updateSettings("position", v)}
              />

              <RadioCard
                label="Theme"
                options={THEMES}
                value={settingsDraft.theme}
                onChange={(v) => updateSettings("theme", v)}
              />
            </TabsContent>

            <TabsContent value="content" className="mt-4 space-y-4">
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div>
                  <Label className="text-xs">System prompt override</Label>
                  <Textarea
                    className="mt-1.5 min-h-44 font-mono text-[12px]"
                    value={agentDraft.systemPromptOverride}
                    onChange={(e) =>
                      updateAgent("systemPromptOverride", e.target.value)
                    }
                    placeholder="You are a helpful support agent for…"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Leave blank to use the platform default system prompt.
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="behavior" className="mt-4 space-y-4">
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Confidence threshold</Label>
                  <span className="font-mono text-xs text-muted-foreground">
                    {agentDraft.confidenceThreshold.toFixed(2)}
                  </span>
                </div>
                <Slider
                  value={[agentDraft.confidenceThreshold]}
                  onValueChange={([v]) => updateAgent("confidenceThreshold", v)}
                  min={0}
                  max={1}
                  step={0.05}
                  className="mt-3"
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Below this score the AI hands off to a human.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Temperature</Label>
                  <span className="font-mono text-xs text-muted-foreground">
                    {agentDraft.temperature.toFixed(1)}
                  </span>
                </div>
                <Slider
                  value={[agentDraft.temperature]}
                  onValueChange={([v]) => updateAgent("temperature", v)}
                  min={0}
                  max={1}
                  step={0.1}
                  className="mt-3"
                />
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <Label className="text-xs">Model</Label>
                <select
                  value={agentDraft.model}
                  onChange={(e) => updateAgent("model", e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {MODELS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <div className="font-display text-sm font-semibold flex items-center gap-2">
                  <Code2 className="h-4 w-4" /> Live preview
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Edits show in the preview immediately via URL params. Hit save to
                  persist.
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* PREVIEW */}
        <div>
          <div className="sticky top-20">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">Live preview</div>
              <div className="inline-flex rounded-md border border-border bg-card p-0.5">
                <button
                  onClick={() => setDevice("desktop")}
                  className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs ${device === "desktop"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  <Monitor className="h-3.5 w-3.5" /> Desktop
                </button>
                <button
                  onClick={() => setDevice("mobile")}
                  className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs ${device === "mobile"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                  <Smartphone className="h-3.5 w-3.5" /> Mobile
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
                </div>
                <div className="ml-2 flex-1 truncate rounded-md bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
                  {previewSrc}
                </div>
              </div>

              <div
                className="relative bg-background"
                style={{
                  height: device === "mobile" ? 640 : 600,
                  width: "100%",
                }}
              >
                <div
                  className={`mx-auto h-full ${device === "mobile" ? "max-w-[380px]" : ""
                    }`}
                  style={{ height: "100%" }}
                >
                  <iframe
                    key={`${device}-${agent._id}-${settingsDraft.primaryColor}-${settingsDraft.position}-${settingsDraft.theme}`}
                    src={previewSrc}
                    title="Widget preview"
                    className="h-full w-full border-0"
                  />
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-3 text-[11px] text-muted-foreground">
              <div>
                <span className="font-mono">color</span>: {settingsDraft.primaryColor}
              </div>
              <div className="text-center">
                <span className="font-mono">pos</span>: {settingsDraft.position}
              </div>
              <div className="text-right">
                <span className="font-mono">theme</span>: {settingsDraft.theme}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ColorPickerCard({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <Label className="text-xs font-medium">Accent color</Label>
      <div className="mt-2.5 grid grid-cols-8 gap-2">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onChange(c)}
            className={`relative aspect-square rounded-md transition ${value === c
              ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
              : "hover:scale-105"
              }`}
            style={{ backgroundColor: c }}
            aria-label={c}
          >
            {value === c && (
              <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white mix-blend-difference" />
            )}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <Label className="text-[11px] text-muted-foreground">Custom hex</Label>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 h-8 font-mono text-xs"
        />
      </div>
    </div>
  );
}

function RadioCard<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <Label className="text-xs font-medium">{label}</Label>
      <div className={`mt-2.5 grid gap-2`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`rounded-md border px-3 py-2 text-xs font-medium transition ${value === opt.id
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-background hover:bg-muted"
              }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SuggestedQuestionsEditor({
  questions,
  onChange,
}: {
  questions: string[];
  onChange: (q: string[]) => void;
}) {
  const [pending, setPending] = useState("");
  function add() {
    const v = pending.trim();
    if (!v) return;
    onChange([...questions, v]);
    setPending("");
  }
  function remove(idx: number) {
    onChange(questions.filter((_, i) => i !== idx));
  }
  return (
    <div>
      <Label className="text-xs">Suggested questions</Label>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {questions.length === 0 && (
          <span className="text-[11px] italic text-muted-foreground">
            None yet — these appear as quick-reply chips in the widget.
          </span>
        )}
        {questions.map((q, i) => (
          <span
            key={`${i}-${q}`}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px]"
          >
            {q}
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-muted-foreground hover:text-destructive"
              aria-label={`Remove ${q}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Input
          value={pending}
          onChange={(e) => setPending(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a suggested question…"
          className="h-9"
        />
        <Button size="sm" variant="outline" onClick={add} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
    </div>
  );
}

type SectionItem = {
  _id: string;
  title: string;
  description?: string;
  icon?: string;
  url?: string;
  order?: number;
};

type SectionDraft = { title: string; icon: string; url: string };

const EMPTY_SECTION: SectionDraft = { title: "", icon: "", url: "" };

// Sections manager — the help-center "Sections" tab content. Each section has a
// title + link; in the widget, tapping it renders that link inline (iframe).
// Unlike the agent/settings panels, sections persist immediately via the
// /sections/:agentId CRUD API (no dependency on the page's Save button).
function SectionsManager({ agentId }: { agentId: string }) {
  const [sections, setSections] = useState<SectionItem[] | null>(null);
  const [draft, setDraft] = useState<SectionDraft>(EMPTY_SECTION);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    clientApi
      .get<SectionItem[]>(`/sections/${agentId}`)
      .then((rows) => {
        if (!cancelled) setSections(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load sections.");
          setSections([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  function resetForm() {
    setDraft(EMPTY_SECTION);
    setEditingId(null);
  }

  // Build the API body, dropping empty optionals so server-side validation
  // (url must be a valid URL when present) doesn't reject empty strings.
  function toBody(d: SectionDraft, order?: number) {
    return {
      title: d.title.trim(),
      icon: d.icon.trim() || undefined,
      url: d.url.trim() || undefined,
      ...(order !== undefined ? { order } : {}),
    };
  }

  async function submit() {
    const title = draft.title.trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        const updated = await clientApi.patch<SectionItem>(
          `/sections/${editingId}`,
          toBody(draft),
        );
        setSections((prev) =>
          (prev ?? []).map((s) => (s._id === editingId ? updated : s)),
        );
      } else {
        const created = await clientApi.post<SectionItem>(
          `/sections/${agentId}`,
          toBody(draft, sections?.length ?? 0),
        );
        setSections((prev) => [...(prev ?? []), created]);
      }
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed (check the URL is valid).");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await clientApi.delete(`/sections/${id}`);
      setSections((prev) => (prev ?? []).filter((s) => s._id !== id));
      if (editingId === id) resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  async function move(idx: number, dir: -1 | 1) {
    const list = sections ?? [];
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[idx], next[j]] = [next[j], next[idx]];
    setSections(next);
    setBusy(true);
    setError(null);
    try {
      // Persist the two swapped items' new positions (order = new index).
      await clientApi.patch(`/sections/${next[idx]._id}`, { order: idx });
      await clientApi.patch(`/sections/${next[j]._id}`, { order: j });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reorder failed.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(s: SectionItem) {
    setEditingId(s._id);
    setDraft({
      title: s.title ?? "",
      icon: s.icon ?? "",
      url: s.url ?? "",
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <div>
        <Label className="text-xs font-medium">Sections (help center)</Label>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Topics shown in the widget&apos;s <span className="font-medium">Sections</span> tab.
          Tapping one opens its link inline inside the widget. Saved instantly.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-2">
        {sections === null ? (
          <p className="text-[11px] italic text-muted-foreground">Loading…</p>
        ) : sections.length === 0 ? (
          <p className="text-[11px] italic text-muted-foreground">
            No sections yet — add one below.
          </p>
        ) : (
          sections.map((s, i) => (
            <div
              key={s._id}
              className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2"
            >
              <span className="text-sm">{s.icon || "•"}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{s.title}</div>
                {s.url ? (
                  <div className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                    <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{s.url}</span>
                  </div>
                ) : (
                  <div className="text-[10px] italic text-warning">No link set</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <IconBtn label="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn
                  label="Move down"
                  disabled={busy || i === sections.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn label="Edit" disabled={busy} onClick={() => startEdit(s)}>
                  <Pencil className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn label="Delete" disabled={busy} onClick={() => remove(s._id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </IconBtn>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add / edit form */}
      <div className="space-y-2 rounded-md border border-dashed border-border p-3">
        <div className="text-[11px] font-medium text-muted-foreground">
          {editingId ? "Edit section" : "Add section"}
        </div>
        <div className="flex gap-2">
          <Input
            value={draft.icon}
            onChange={(e) => setDraft((d) => ({ ...d, icon: e.target.value }))}
            placeholder="🔖"
            className="h-9 w-14 text-center"
            aria-label="Icon (emoji)"
          />
          <Input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Section title (e.g. Sign-up)"
            className="h-9 flex-1"
          />
        </div>
        <Input
          value={draft.url}
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
          placeholder="https://help.example.com/sign-up"
          className="h-9"
        />
        <div className="flex justify-end gap-2">
          {editingId && (
            <Button size="sm" variant="outline" onClick={resetForm} disabled={busy}>
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            onClick={submit}
            disabled={busy || !draft.title.trim()}
            className="gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            {editingId ? "Save section" : "Add section"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function NoAgentState() {
  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Widget studio</h1>
      <div className="mt-6 rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
        <div className="font-display text-base font-semibold">No agent configured yet</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Create an agent from the Settings page first, then come back to design your widget.
        </p>
      </div>
    </div>
  );
}
