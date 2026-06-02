'use client';

// Widget Studio — operator-facing editor for the AI agent's persona/behavior +
// a live iframe preview of the embed app.
//
// Persistence: we PATCH the Agent record (name, welcomeMessage, suggestedQuestions,
// systemPromptOverride, model, temperature, confidenceThreshold). The cosmetic
// fields (primaryColor, position) belong to the WidgetSettings doc — there is no
// operator-facing PATCH for those yet, so they're TODO and stored in the local
// preview only. The preview iframe loads the widget app verbatim — it will fetch
// its own settings via /widget/init.

import { useMemo, useState } from "react";
import {
  Check,
  Code2,
  Monitor,
  Palette,
  Plus,
  Settings2,
  Smartphone,
  Type as TypeIcon,
  X,
  AlertCircle,
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
};

const MODELS = [
  { value: "openai/gpt-4o-mini", label: "OpenAI · gpt-4o-mini" },
  { value: "openai/gpt-4o", label: "OpenAI · gpt-4o" },
  { value: "anthropic/claude-3.5-sonnet", label: "Anthropic · claude-3.5-sonnet" },
] as const;

const POSITIONS = [
  { id: "bottom-right", label: "Bottom right" },
  { id: "bottom-left", label: "Bottom left" },
] as const;

const COLORS = [
  "#0a0a0a",
  "#1e40af",
  "#0f766e",
  "#16a34a",
  "#ea580c",
  "#db2777",
  "#7c3aed",
  "#dc2626",
];

type Editable = {
  name: string;
  welcomeMessage: string;
  suggestedQuestions: string[];
  systemPromptOverride: string;
  model: string;
  temperature: number;
  confidenceThreshold: number;
};

function toEditable(agent: Agent): Editable {
  return {
    name: agent.name ?? "",
    welcomeMessage: agent.welcomeMessage ?? "",
    suggestedQuestions: agent.suggestedQuestions ?? [],
    systemPromptOverride: agent.systemPromptOverride ?? "",
    model: agent.model ?? "openai/gpt-4o-mini",
    temperature: agent.temperature ?? 0.7,
    confidenceThreshold: agent.confidenceThreshold ?? 0.7,
  };
}

// Produce a partial that only contains the keys that actually changed. We keep
// arrays as full replacements (the API doesn't do diff-merging) but omit them
// when content matches.
function diff(a: Editable, b: Editable): Partial<Editable> {
  const out: Partial<Editable> = {};
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

export function WidgetStudioClient({
  initialAgent,
  widgetUrl,
}: {
  initialAgent: Agent | null;
  widgetUrl: string;
}) {
  const [agent, setAgent] = useState<Agent | null>(initialAgent);
  const baseline = useMemo(
    () => (agent ? toEditable(agent) : null),
    [agent],
  );
  const [draft, setDraft] = useState<Editable | null>(baseline);
  // Preview-only cosmetic fields. TODO: persist via WidgetSettings once an
  // operator PATCH endpoint exists.
  const [previewColor, setPreviewColor] = useState(COLORS[0]);
  const [previewPosition, setPreviewPosition] = useState<(typeof POSITIONS)[number]["id"]>(
    "bottom-right",
  );
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  if (!agent || !draft || !baseline) {
    return <NoAgentState />;
  }

  const dirty = Object.keys(diff(baseline, draft)).length > 0;

  function update<K extends keyof Editable>(key: K, value: Editable[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function save() {
    if (!agent || !baseline || !draft) return;
    const patch = diff(baseline, draft);
    if (Object.keys(patch).length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const next = await clientApi.patch<Agent>(`/agents/${agent._id}`, patch);
      setAgent(next);
      setDraft(toEditable(next));
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDraft(baseline);
    setError(null);
  }

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Widget studio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Edit your AI agent&apos;s persona and behavior. Changes save to the agent and apply
            to every embed.
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
          <Button size="sm" onClick={save} disabled={!dirty || busy}>
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
                    value={draft.name}
                    onChange={(e) => update("name", e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Welcome message</Label>
                  <Textarea
                    className="mt-1.5 min-h-20"
                    value={draft.welcomeMessage}
                    onChange={(e) => update("welcomeMessage", e.target.value)}
                    placeholder="Hi 👋 How can I help today?"
                  />
                </div>
                <SuggestedQuestionsEditor
                  questions={draft.suggestedQuestions}
                  onChange={(q) => update("suggestedQuestions", q)}
                />
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Accent color</Label>
                  <Badge variant="secondary" className="text-[10px]">Preview only</Badge>
                </div>
                <div className="mt-2.5 grid grid-cols-8 gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setPreviewColor(c)}
                      className={`relative aspect-square rounded-md transition ${
                        previewColor === c
                          ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                          : "hover:scale-105"
                      }`}
                      style={{ backgroundColor: c }}
                      aria-label={c}
                    >
                      {previewColor === c && (
                        <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white mix-blend-difference" />
                      )}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  TODO: persist via WidgetSettings — no operator PATCH endpoint yet.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Launcher position</Label>
                  <Badge variant="secondary" className="text-[10px]">Preview only</Badge>
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  {POSITIONS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPreviewPosition(p.id)}
                      className={`rounded-md border px-3 py-2 text-xs font-medium transition ${
                        previewPosition === p.id
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-background hover:bg-muted"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="content" className="mt-4 space-y-4">
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div>
                  <Label className="text-xs">System prompt override</Label>
                  <Textarea
                    className="mt-1.5 min-h-44 font-mono text-[12px]"
                    value={draft.systemPromptOverride}
                    onChange={(e) => update("systemPromptOverride", e.target.value)}
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
                    {draft.confidenceThreshold.toFixed(2)}
                  </span>
                </div>
                <Slider
                  value={[draft.confidenceThreshold]}
                  onValueChange={([v]) => update("confidenceThreshold", v)}
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
                    {draft.temperature.toFixed(1)}
                  </span>
                </div>
                <Slider
                  value={[draft.temperature]}
                  onValueChange={([v]) => update("temperature", v)}
                  min={0}
                  max={1}
                  step={0.1}
                  className="mt-3"
                />
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <Label className="text-xs">Model</Label>
                <select
                  value={draft.model}
                  onChange={(e) => update("model", e.target.value)}
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
                  The preview iframe loads the actual widget app — it will pick up your
                  changes after you save.
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
                  className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs ${
                    device === "desktop"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Monitor className="h-3.5 w-3.5" /> Desktop
                </button>
                <button
                  onClick={() => setDevice("mobile")}
                  className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs ${
                    device === "mobile"
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
                  {widgetUrl}
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
                  className={`mx-auto h-full ${device === "mobile" ? "max-w-[380px]" : ""}`}
                  style={{ height: "100%" }}
                >
                  <iframe
                    key={`${device}-${agent._id}`}
                    src={widgetUrl}
                    title="Widget preview"
                    className="h-full w-full border-0"
                  />
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-[11px] text-muted-foreground">
              <div>
                <span className="font-mono">color</span>: {previewColor}
              </div>
              <div className="text-right">
                <span className="font-mono">pos</span>: {previewPosition}
              </div>
            </div>
          </div>
        </div>
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
