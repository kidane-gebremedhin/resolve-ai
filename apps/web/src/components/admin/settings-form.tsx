"use client";

// Local-state stub for the platform-admin settings page. No backend endpoints
// exist yet for any of these knobs — every section ships with a TODO badge so
// the future API implementation has a clear home.

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  Button,
  Input,
  Label,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@csb/ui";

function TodoBadge({ children = "TODO" }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warning">
      <AlertTriangle className="h-3 w-3" />
      {children}
    </span>
  );
}

function Section({
  title,
  todo,
  description,
  children,
}: {
  title: string;
  todo?: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {description ? (
            <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
          ) : null}
        </div>
        {todo ? <TodoBadge>{todo}</TodoBadge> : null}
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}

export function SettingsForm() {
  // All inputs below are uncontrolled-by-API: pure local state with no
  // persistence path yet. Replace with backend wiring once endpoints exist.
  const [smtp, setSmtp] = useState({
    host: "",
    port: "587",
    from: "",
    username: "",
  });
  const [api, setApi] = useState({
    defaultRateLimit: "600",
    burstLimit: "1200",
    apiVersion: "2025-05",
  });
  const [security, setSecurity] = useState({
    enforce2fa: true,
    blockDisposable: true,
    strongPasswords: true,
    sessionTimeout24h: false,
  });
  const [audit, setAudit] = useState({
    retentionDays: "90",
    forwardToSiem: false,
  });

  return (
    <Tabs defaultValue="email" className="mt-6">
      <TabsList>
        <TabsTrigger value="email">Email / SMTP</TabsTrigger>
        <TabsTrigger value="api">API limits</TabsTrigger>
        <TabsTrigger value="security">Security</TabsTrigger>
        <TabsTrigger value="audit">Audit log</TabsTrigger>
      </TabsList>

      <TabsContent value="email" className="mt-6 max-w-2xl">
        <Section
          title="SMTP relay"
          todo="No backend"
          description="Outbound transactional email delivery."
        >
          <div>
            <Label>SMTP host</Label>
            <Input
              className="mt-1.5"
              value={smtp.host}
              onChange={(e) => setSmtp({ ...smtp, host: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Port</Label>
              <Input
                className="mt-1.5"
                value={smtp.port}
                onChange={(e) => setSmtp({ ...smtp, port: e.target.value })}
              />
            </div>
            <div>
              <Label>From address</Label>
              <Input
                className="mt-1.5"
                value={smtp.from}
                onChange={(e) => setSmtp({ ...smtp, from: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Username</Label>
            <Input
              className="mt-1.5"
              value={smtp.username}
              onChange={(e) => setSmtp({ ...smtp, username: e.target.value })}
            />
          </div>
          <Button size="sm" disabled className="mt-2">
            Save (not yet wired)
          </Button>
        </Section>
      </TabsContent>

      <TabsContent value="api" className="mt-6 max-w-2xl">
        <Section
          title="API rate limits"
          todo="No backend"
          description="Platform-wide defaults. Per-tenant overrides not yet implemented."
        >
          <div>
            <Label>Default rate limit (req / min)</Label>
            <Input
              className="mt-1.5"
              value={api.defaultRateLimit}
              onChange={(e) => setApi({ ...api, defaultRateLimit: e.target.value })}
            />
          </div>
          <div>
            <Label>Burst limit</Label>
            <Input
              className="mt-1.5"
              value={api.burstLimit}
              onChange={(e) => setApi({ ...api, burstLimit: e.target.value })}
            />
          </div>
          <div>
            <Label>API version</Label>
            <Input
              className="mt-1.5"
              value={api.apiVersion}
              onChange={(e) => setApi({ ...api, apiVersion: e.target.value })}
            />
          </div>
          <Button size="sm" disabled className="mt-2">
            Save (not yet wired)
          </Button>
        </Section>
      </TabsContent>

      <TabsContent value="security" className="mt-6 max-w-2xl space-y-4">
        <Section
          title="Authentication policies"
          todo="No backend"
          description="Platform-wide auth hardening."
        >
          {(
            [
              ["enforce2fa", "Enforce 2FA for platform admins"],
              ["blockDisposable", "Block sign-ins from disposable email domains"],
              ["strongPasswords", "Require strong passwords"],
              ["sessionTimeout24h", "Session timeout after 24h"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between text-sm">
              <span>{label}</span>
              <Switch
                checked={security[key]}
                onCheckedChange={(v) => setSecurity({ ...security, [key]: Boolean(v) })}
              />
            </div>
          ))}
          <Button size="sm" disabled className="mt-2">
            Save (not yet wired)
          </Button>
        </Section>
      </TabsContent>

      <TabsContent value="audit" className="mt-6 max-w-2xl">
        <Section
          title="Audit log"
          todo="No backend"
          description="Retention and forwarding of administrative actions."
        >
          <div>
            <Label>Retention (days)</Label>
            <Input
              className="mt-1.5"
              value={audit.retentionDays}
              onChange={(e) => setAudit({ ...audit, retentionDays: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
            <div>
              <div>Forward events to SIEM</div>
              <div className="text-xs text-muted-foreground">
                Stream to an external syslog / SIEM endpoint.
              </div>
            </div>
            <Switch
              checked={audit.forwardToSiem}
              onCheckedChange={(v) => setAudit({ ...audit, forwardToSiem: Boolean(v) })}
            />
          </div>
          <Button size="sm" disabled className="mt-2">
            Save (not yet wired)
          </Button>
        </Section>
      </TabsContent>
    </Tabs>
  );
}
