'use client';

import { useState } from "react";
import { Bot, Globe, ShieldCheck, Users, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const tabs = [
  { id: "agent", label: "AI Agent", icon: Bot },
  { id: "widget", label: "Web widget", icon: Globe },
  { id: "team", label: "Team", icon: Users },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "api", label: "API", icon: Code2 },
] as const;

function Settings() {
  const [tab, setTab] = useState<typeof tabs[number]["id"]>("agent");

  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Configure your AI agent, widget and workspace.</p>

      <div className="mt-8 grid gap-8 md:grid-cols-[200px_1fr]">
        <nav className="flex flex-row gap-1 overflow-x-auto md:flex-col">
          {tabs.map((t) => {
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
          {tab === "agent" && <AgentSettings />}
          {tab === "widget" && <WidgetSettings />}
          {tab === "team" && <TeamSettings />}
          {tab === "security" && <SecuritySettings />}
          {tab === "api" && <ApiSettings />}
        </div>
      </div>
    </div>
  );
}

function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="font-display text-base font-semibold">{title}</div>
      {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function AgentSettings() {
  return (
    <>
      <Card title="Identity" desc="How your AI agent introduces itself.">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Display name</Label>
            <Input defaultValue="Helio" />
          </div>
          <div className="grid gap-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Avatar initial</Label>
            <Input defaultValue="H" maxLength={1} />
          </div>
        </div>
        <div className="mt-4 grid gap-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">Personality</Label>
          <Textarea rows={3} defaultValue="Helpful, concise and human. Never makes things up. Cites sources. Hands off to a human when confidence is below 70%." />
        </div>
      </Card>

      <Card title="Behavior" desc="Confidence thresholds and escalation.">
        <Slider label="Confidence threshold" value={70} suffix="%" />
        <Slider label="Max turns before handoff" value={6} suffix=" turns" min={2} max={12} />
        <Toggle label="Allow tool calling (refunds, plan changes…)" defaultOn />
        <Toggle label="Always cite sources" defaultOn />
      </Card>

      <div className="flex justify-end">
        <Button>Save changes</Button>
      </div>
    </>
  );
}

function WidgetSettings() {
  return (
    <>
      <Card title="Install snippet" desc="Drop this into your site's <head> to launch the chat widget.">
        <pre className="overflow-x-auto rounded-md border border-border bg-surface p-4 font-mono text-[12px] leading-relaxed">
{`<script src="https://cdn.helio.support/v1.js"
  data-workspace="northwind"
  data-color="#3b82f6"
  defer></script>`}
        </pre>
      </Card>
      <Card title="Appearance">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Primary color</Label>
            <div className="flex items-center gap-2">
              <span className="h-9 w-9 rounded-md border border-border" style={{ background: "#3b82f6" }} />
              <Input defaultValue="#3B82F6" className="font-mono" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Position</Label>
            <Input defaultValue="bottom-right" />
          </div>
        </div>
      </Card>
    </>
  );
}

function TeamSettings() {
  const team = [
    { n: "Maya Okafor", e: "maya@northwind.io", r: "Owner" },
    { n: "Idris Khan", e: "idris@northwind.io", r: "Admin" },
    { n: "Anya Petrov", e: "anya@northwind.io", r: "Agent" },
  ];
  return (
    <Card title="Team members" desc="Invite agents and admins to the workspace.">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border">
          {team.map((m) => (
            <tr key={m.e}>
              <td className="py-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-8 w-8 place-items-center rounded-full bg-muted text-[11px] font-semibold">{m.n.split(" ").map((p) => p[0]).join("")}</div>
                  <div>
                    <div className="font-medium">{m.n}</div>
                    <div className="text-xs text-muted-foreground">{m.e}</div>
                  </div>
                </div>
              </td>
              <td className="py-3 text-right text-xs text-muted-foreground">{m.r}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4"><Button size="sm">Invite teammate</Button></div>
    </Card>
  );
}

function SecuritySettings() {
  return (
    <>
      <Card title="Authentication">
        <Toggle label="Require SSO (SAML)" />
        <Toggle label="Enforce 2FA for admins" defaultOn />
        <Toggle label="Session timeout after 8 hours" defaultOn />
      </Card>
      <Card title="Data residency" desc="Choose where customer data is stored.">
        <div className="flex gap-2 text-sm">
          {["US", "EU", "AU"].map((r, i) => (
            <button key={r} className={`rounded-md border px-3 py-1.5 text-xs ${i === 1 ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"}`}>{r}</button>
          ))}
        </div>
      </Card>
    </>
  );
}

function ApiSettings() {
  return (
    <Card title="API keys">
      <div className="space-y-3">
        {[
          { name: "Production", key: "hl_live_••••••••••••0a8f", created: "Mar 14, 2025" },
          { name: "Staging", key: "hl_test_••••••••••••3c12", created: "Apr 02, 2025" },
        ].map((k) => (
          <div key={k.name} className="flex items-center justify-between rounded-md border border-border bg-surface/60 px-4 py-3">
            <div>
              <div className="text-sm font-medium">{k.name}</div>
              <div className="font-mono text-xs text-muted-foreground">{k.key}</div>
            </div>
            <div className="text-right text-xs text-muted-foreground">Created {k.created}</div>
          </div>
        ))}
        <Button size="sm">Generate new key</Button>
      </div>
    </Card>
  );
}

function Slider({ label, value, suffix = "", min = 0, max = 100 }: { label: string; value: number; suffix?: string; min?: number; max?: number }) {
  const [v, setV] = useState(value);
  return (
    <div className="mb-5 last:mb-0">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono text-xs text-muted-foreground">{v}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} value={v} onChange={(e) => setV(Number(e.target.value))} className="mt-2 w-full accent-foreground" />
    </div>
  );
}

function Toggle({ label, defaultOn = false }: { label: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="mb-3 flex items-center justify-between last:mb-0">
      <span className="text-sm">{label}</span>
      <button
        onClick={() => setOn((v) => !v)}
        className={`relative h-5 w-9 rounded-full transition ${on ? "bg-foreground" : "bg-muted"}`}
        aria-pressed={on}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition ${on ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}
