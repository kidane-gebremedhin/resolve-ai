'use client';

// Settings — five tabs (Agent / Widget / Team / Security / API). Each tab
// owns its own form state; the Agent tab posts a partial PATCH to /agents/:id,
// the Team tab manages invites + role/status mutations via /orgs/current/members.
// Security and API key regeneration are stubbed pending backend endpoints.

import { useState } from "react";
import {
  Bot,
  Code2,
  Copy,
  Globe,
  Loader2,
  ShieldCheck,
  Users,
  AlertCircle,
  Check,
  ExternalLink,
} from "lucide-react";
import {
  Button,
  Input,
  Label,
  Textarea,
  Slider,
  Badge,
  Switch,
} from "@csb/ui";
import Link from "next/link";
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

export type Org = {
  _id: string;
  name: string;
  slug: string;
  plan: string;
};

export type Member = {
  membershipId: string;
  role: "owner" | "admin" | "agent" | "viewer";
  status: "active" | "pending" | "revoked";
  invitedAt?: string;
  acceptedAt?: string;
  user: { _id: string; email: string; name?: string; avatarUrl?: string } | null;
};

const TABS = [
  { id: "agent", label: "AI Agent", icon: Bot },
  { id: "widget", label: "Web widget", icon: Globe },
  { id: "team", label: "Team", icon: Users },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "api", label: "API", icon: Code2 },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SettingsClient({
  org,
  initialAgent,
  initialMembers,
  apiBaseUrl,
}: {
  org: Org | null;
  initialAgent: Agent | null;
  initialMembers: Member[];
  apiBaseUrl: string;
}) {
  const [tab, setTab] = useState<TabId>("agent");

  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure your AI agent, widget, team, and integrations.
      </p>

      <div className="mt-8 grid gap-8 md:grid-cols-[200px_1fr]">
        <nav className="flex flex-row gap-1 overflow-x-auto md:flex-col">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                  active ? "bg-foreground text-background" : "text-foreground/80 hover:bg-muted"
                }`}
              >
                <t.icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </nav>

        <div className="space-y-6">
          {tab === "agent" && <AgentTab initialAgent={initialAgent} />}
          {tab === "widget" && <WidgetTab />}
          {tab === "team" && <TeamTab initialMembers={initialMembers} />}
          {tab === "security" && <SecurityTab />}
          {tab === "api" && <ApiTab org={org} apiBaseUrl={apiBaseUrl} />}
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="font-display text-base font-semibold">{title}</div>
      {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

// ------------------------------------------------------------ Agent tab
function AgentTab({ initialAgent }: { initialAgent: Agent | null }) {
  const [agent, setAgent] = useState<Agent | null>(initialAgent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!agent) {
    return (
      <Card title="No agent yet">
        <p className="text-sm text-muted-foreground">
          No agent is configured for this workspace. The first agent is normally created during
          onboarding. Contact support if this seems wrong.
        </p>
      </Card>
    );
  }

  function update<K extends keyof Agent>(k: K, v: Agent[K]) {
    setAgent((prev) => (prev ? { ...prev, [k]: v } : prev));
    setSaved(false);
  }

  async function save() {
    if (!agent) return;
    setBusy(true);
    setError(null);
    try {
      const payload: Partial<Agent> = {
        name: agent.name,
        description: agent.description,
        welcomeMessage: agent.welcomeMessage,
        suggestedQuestions: agent.suggestedQuestions,
        systemPromptOverride: agent.systemPromptOverride,
        model: agent.model,
        temperature: agent.temperature,
        confidenceThreshold: agent.confidenceThreshold,
      };
      const next = await clientApi.patch<Agent>(`/agents/${agent._id}`, payload);
      setAgent(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <ErrorBanner message={error} />}
      <Card title="Identity" desc="How your AI agent introduces itself.">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Display name
            </Label>
            <Input value={agent.name} onChange={(e) => update("name", e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Model</Label>
            <select
              value={agent.model ?? "openai/gpt-4o-mini"}
              onChange={(e) => update("model", e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            >
              <option value="openai/gpt-4o-mini">OpenAI · gpt-4o-mini</option>
              <option value="openai/gpt-4o">OpenAI · gpt-4o</option>
              <option value="anthropic/claude-3.5-sonnet">Anthropic · claude-3.5-sonnet</option>
            </select>
          </div>
        </div>
        <div className="mt-4 grid gap-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Welcome message
          </Label>
          <Textarea
            rows={2}
            value={agent.welcomeMessage ?? ""}
            onChange={(e) => update("welcomeMessage", e.target.value)}
            placeholder="Hi 👋 How can I help today?"
          />
        </div>
        <div className="mt-4 grid gap-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            System prompt override
          </Label>
          <Textarea
            rows={5}
            value={agent.systemPromptOverride ?? ""}
            onChange={(e) => update("systemPromptOverride", e.target.value)}
            className="font-mono text-xs"
            placeholder="Leave blank to use the platform default."
          />
        </div>
      </Card>

      <Card title="Behavior" desc="Tune the model and the confidence-based handoff.">
        <div className="space-y-5">
          <SliderRow
            label="Confidence threshold"
            value={agent.confidenceThreshold ?? 0.7}
            min={0}
            max={1}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={(v) => update("confidenceThreshold", v)}
          />
          <SliderRow
            label="Temperature"
            value={agent.temperature ?? 0.7}
            min={0}
            max={1}
            step={0.1}
            format={(v) => v.toFixed(1)}
            onChange={(v) => update("temperature", v)}
          />
        </div>
      </Card>

      <div className="flex items-center justify-end gap-2">
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        <Button onClick={save} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Saving…
            </>
          ) : (
            "Save changes"
          )}
        </Button>
      </div>
    </>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono text-xs text-muted-foreground">{format(value)}</span>
      </div>
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
        className="mt-2"
      />
    </div>
  );
}

// ------------------------------------------------------------ Widget tab
function WidgetTab() {
  const [copied, setCopied] = useState(false);
  const snippet = `<script src="${process.env.NEXT_PUBLIC_WIDGET_URL ?? "http://localhost:3001"}/widget.js" async></script>`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <>
      <Card
        title="Install snippet"
        desc="Drop this into your site's <head>. Configure per-domain settings on the Websites page."
      >
        <pre className="overflow-x-auto rounded-md border border-border bg-surface p-4 font-mono text-[12px] leading-relaxed">
          {snippet}
        </pre>
        <Button size="sm" variant="outline" className="mt-3 gap-2" onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy snippet"}
        </Button>
      </Card>

      <Card
        title="Appearance"
        desc="The widget's colors, position, and copy live in the Widget Studio for now."
      >
        <Link
          href="/app/widget"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          Open Widget Studio <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </Card>
    </>
  );
}

// ------------------------------------------------------------ Team tab
function TeamTab({ initialMembers }: { initialMembers: Member[] }) {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "agent" | "viewer">("agent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function invite() {
    const email = inviteEmail.trim();
    if (!email) {
      setError("Email is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await clientApi.post("/orgs/current/members/invite", { email, role: inviteRole });
      // Refetch to get the canonical list (the invite response is partial).
      const next = await clientApi.get<Member[]>("/orgs/current/members");
      setMembers(next);
      setInviteEmail("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(m: Member, role: Member["role"]) {
    setError(null);
    try {
      const updated = await clientApi.patch<Member>(
        `/orgs/current/members/${m.membershipId}`,
        { role },
      );
      setMembers((prev) =>
        prev.map((x) =>
          x.membershipId === m.membershipId ? { ...x, role: updated.role ?? role } : x,
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  }

  async function revoke(m: Member) {
    if (!window.confirm(`Revoke access for ${m.user?.email ?? "this member"}?`)) return;
    setError(null);
    try {
      await clientApi.delete(`/orgs/current/members/${m.membershipId}`);
      setMembers((prev) =>
        prev.map((x) =>
          x.membershipId === m.membershipId ? { ...x, status: "revoked" as const } : x,
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  }

  const active = members.filter((m) => m.status !== "revoked");
  const revoked = members.filter((m) => m.status === "revoked");

  return (
    <>
      {error && <ErrorBanner message={error} />}
      <Card
        title="Invite a teammate"
        desc="They&apos;ll receive an invite to join this workspace."
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
          <Input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          >
            <option value="admin">Admin</option>
            <option value="agent">Agent</option>
            <option value="viewer">Viewer</option>
          </select>
          <Button onClick={invite} disabled={busy}>
            {busy ? "Sending…" : "Send invite"}
          </Button>
        </div>
      </Card>

      <Card title="Team members" desc={`${active.length} active`}>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border">
            {active.length === 0 && (
              <tr>
                <td colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                  No active members.
                </td>
              </tr>
            )}
            {active.map((m) => (
              <MemberRow key={m.membershipId} member={m} onRole={changeRole} onRevoke={revoke} />
            ))}
          </tbody>
        </table>
      </Card>

      {revoked.length > 0 && (
        <Card title="Revoked" desc={`${revoked.length} previously invited`}>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {revoked.map((m) => (
                <tr key={m.membershipId} className="opacity-60">
                  <td className="py-3">
                    <div className="text-sm">{m.user?.email ?? "unknown"}</div>
                  </td>
                  <td className="py-3 text-right text-xs text-muted-foreground">{m.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function MemberRow({
  member,
  onRole,
  onRevoke,
}: {
  member: Member;
  onRole: (m: Member, role: Member["role"]) => void;
  onRevoke: (m: Member) => void;
}) {
  const name = member.user?.name ?? member.user?.email ?? "—";
  const initials =
    (member.user?.name ?? member.user?.email ?? "?")
      .split(/[ @.]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";
  return (
    <tr>
      <td className="py-3">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-muted text-[11px] font-semibold">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{name}</span>
              {member.status === "pending" && (
                <Badge variant="secondary" className="text-[10px]">
                  Pending
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">{member.user?.email}</div>
          </div>
        </div>
      </td>
      <td className="py-3 text-right">
        {member.role === "owner" ? (
          <span className="text-xs text-muted-foreground">Owner</span>
        ) : (
          <select
            value={member.role}
            onChange={(e) => onRole(member, e.target.value as Member["role"])}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="admin">Admin</option>
            <option value="agent">Agent</option>
            <option value="viewer">Viewer</option>
          </select>
        )}
      </td>
      <td className="py-3 text-right">
        {member.role !== "owner" && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => onRevoke(member)}
          >
            Revoke
          </Button>
        )}
      </td>
    </tr>
  );
}

// ------------------------------------------------------------ Security tab
function SecurityTab() {
  const [twoFa, setTwoFa] = useState(false);
  const [sessionHours, setSessionHours] = useState(8);

  return (
    <>
      <Card title="Two-factor authentication" desc="Add a second factor to every operator login.">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Require 2FA for admins</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              TODO: backend endpoint not implemented yet.
            </div>
          </div>
          <Switch checked={twoFa} onCheckedChange={setTwoFa} disabled />
        </div>
      </Card>

      <Card title="Session timeout">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Auto-logout after inactivity</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              TODO: not wired to the auth layer yet.
            </div>
          </div>
          <select
            value={sessionHours}
            onChange={(e) => setSessionHours(Number(e.target.value))}
            disabled
            className="h-9 rounded-md border border-border bg-background px-3 text-sm disabled:opacity-50"
          >
            {[1, 4, 8, 24, 168].map((h) => (
              <option key={h} value={h}>
                {h >= 168 ? "7 days" : `${h} hour${h === 1 ? "" : "s"}`}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card title="Audit log" desc="Every operator-level mutation is recorded here.">
        <div className="rounded-md border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-muted-foreground">
          TODO — audit log API not implemented yet.
        </div>
      </Card>
    </>
  );
}

// ------------------------------------------------------------ API tab
function ApiTab({ org, apiBaseUrl }: { org: Org | null; apiBaseUrl: string }) {
  const [copied, setCopied] = useState(false);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }
  return (
    <>
      <Card title="Workspace" desc="The identifiers your integrations should use.">
        <dl className="grid gap-3 sm:grid-cols-2">
          <KV k="Organization" v={org?.name ?? "—"} />
          <KV k="Slug" v={org?.slug ?? "—"} mono />
          <KV k="Plan" v={org?.plan ?? "—"} />
          <KV k="Org ID" v={org?._id ?? "—"} mono />
        </dl>
      </Card>

      <Card title="API base URL">
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
          <code className="flex-1 truncate font-mono text-xs">{apiBaseUrl}</code>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5"
            onClick={() => copy(apiBaseUrl)}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          For a deeper integration guide and SDK examples, head to the Developers page.
        </p>
      </Card>

      <Card title="API keys" desc="Issue and rotate keys for programmatic access.">
        <div className="rounded-md border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-muted-foreground">
          TODO — programmatic API key issuance is not implemented yet.
        </div>
        <Button size="sm" disabled className="mt-3">
          Regenerate API key
        </Button>
      </Card>
    </>
  );
}

function KV({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className={`mt-0.5 text-sm ${mono ? "font-mono" : ""}`}>{v}</div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
