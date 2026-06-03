"use client";

// Platform-admin settings form, wired to /admin/settings.
//
// Loads its initial state from the server-component (`initial` prop) and
// PATCHes the same endpoint on save. We hold the whole settings object in
// local state and submit a partial nested patch — the backend merges keys
// with dot-paths so unspecified fields are untouched.
//
// Sections: SMTP relay, Security policies, Limits, Branding.

import { useEffect, useState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
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
import { clientApi, ApiError } from "@/lib/api";

export type PlatformSettings = {
  _id?: string;
  singleton?: string;
  smtp?: {
    host?: string;
    port?: number;
    username?: string;
    secret?: string;
    fromEmail?: string;
  };
  security?: {
    mfaRequired?: boolean;
    sessionTimeoutMinutes?: number;
    ipAllowlist?: string[];
  };
  limits?: {
    maxOrgsPerUser?: number;
    defaultRateLimitPerMinute?: number;
  };
  branding?: {
    platformName?: string;
    supportEmail?: string;
  };
  theming?: {
    fontSans?: string;
    fontDisplay?: string;
  };
  updatedAt?: string;
};

// Curated font options — values MUST match apps/web/src/app/fonts.ts and the
// admin Zod enum in apps/api/src/routes/admin.routes.ts.
const SANS_OPTIONS = [
  { value: "inter", label: "Inter" },
  { value: "open-sans", label: "Open Sans" },
  { value: "montserrat", label: "Montserrat" },
];
const DISPLAY_OPTIONS = [
  { value: "inter-tight", label: "Inter Tight" },
  { value: "lora", label: "Lora (serif)" },
  { value: "montserrat", label: "Montserrat" },
];

type Editable = {
  smtp: {
    host: string;
    port: string; // input is string; coerced to number on submit
    username: string;
    secret: string;
    fromEmail: string;
  };
  security: {
    mfaRequired: boolean;
    sessionTimeoutMinutes: string;
    ipAllowlist: string; // comma-separated for the textarea
  };
  limits: {
    maxOrgsPerUser: string;
    defaultRateLimitPerMinute: string;
  };
  branding: {
    platformName: string;
    supportEmail: string;
  };
  theming: {
    fontSans: string;
    fontDisplay: string;
  };
};

function toEditable(s: PlatformSettings | null): Editable {
  return {
    smtp: {
      host: s?.smtp?.host ?? "",
      port: String(s?.smtp?.port ?? 587),
      username: s?.smtp?.username ?? "",
      secret: s?.smtp?.secret ?? "",
      fromEmail: s?.smtp?.fromEmail ?? "",
    },
    security: {
      mfaRequired: s?.security?.mfaRequired ?? false,
      sessionTimeoutMinutes: String(s?.security?.sessionTimeoutMinutes ?? 1440),
      ipAllowlist: (s?.security?.ipAllowlist ?? []).join(", "),
    },
    limits: {
      maxOrgsPerUser: String(s?.limits?.maxOrgsPerUser ?? 5),
      defaultRateLimitPerMinute: String(s?.limits?.defaultRateLimitPerMinute ?? 600),
    },
    branding: {
      platformName: s?.branding?.platformName ?? "",
      supportEmail: s?.branding?.supportEmail ?? "",
    },
    theming: {
      fontSans: s?.theming?.fontSans ?? "inter",
      fontDisplay: s?.theming?.fontDisplay ?? "inter-tight",
    },
  };
}

function toPatch(e: Editable): Record<string, unknown> {
  // Numbers come back from <input> as strings; coerce here and drop NaN.
  const port = Number(e.smtp.port);
  const session = Number(e.security.sessionTimeoutMinutes);
  const maxOrgs = Number(e.limits.maxOrgsPerUser);
  const rate = Number(e.limits.defaultRateLimitPerMinute);
  return {
    smtp: {
      host: e.smtp.host,
      port: Number.isFinite(port) ? port : undefined,
      username: e.smtp.username,
      secret: e.smtp.secret,
      fromEmail: e.smtp.fromEmail,
    },
    security: {
      mfaRequired: e.security.mfaRequired,
      sessionTimeoutMinutes: Number.isFinite(session) ? session : undefined,
      ipAllowlist: e.security.ipAllowlist
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    limits: {
      maxOrgsPerUser: Number.isFinite(maxOrgs) ? maxOrgs : undefined,
      defaultRateLimitPerMinute: Number.isFinite(rate) ? rate : undefined,
    },
    branding: {
      platformName: e.branding.platformName,
      supportEmail: e.branding.supportEmail,
    },
    theming: {
      fontSans: e.theming.fontSans,
      fontDisplay: e.theming.fontDisplay,
    },
  };
}

export function AdminSettingsForm({ initial }: { initial: PlatformSettings | null }) {
  const [draft, setDraft] = useState<Editable>(toEditable(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await clientApi.patch<PlatformSettings>(
        "/admin/settings",
        toPatch(draft),
      );
      setDraft(toEditable(next));
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function update<K extends keyof Editable>(group: K, partial: Partial<Editable[K]>) {
    setDraft((prev) => ({ ...prev, [group]: { ...prev[group], ...partial } }));
  }

  return (
    <div className="mt-6">
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {savedAt && !error && (
        <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-1.5 text-xs text-success">
          <Check className="h-3.5 w-3.5" /> Saved
        </div>
      )}

      <Tabs defaultValue="smtp">
        <TabsList>
          <TabsTrigger value="smtp">SMTP</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="limits">Limits</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="theming">Theming</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
        </TabsList>

        <TabsContent value="smtp" className="mt-6 max-w-2xl">
          <Section title="SMTP relay" description="Outbound transactional email delivery.">
            <div>
              <Label>SMTP host</Label>
              <Input
                className="mt-1.5"
                value={draft.smtp.host}
                onChange={(e) => update("smtp", { host: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Port</Label>
                <Input
                  className="mt-1.5"
                  inputMode="numeric"
                  value={draft.smtp.port}
                  onChange={(e) => update("smtp", { port: e.target.value })}
                />
              </div>
              <div>
                <Label>From address</Label>
                <Input
                  className="mt-1.5"
                  value={draft.smtp.fromEmail}
                  onChange={(e) => update("smtp", { fromEmail: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Username</Label>
              <Input
                className="mt-1.5"
                value={draft.smtp.username}
                onChange={(e) => update("smtp", { username: e.target.value })}
              />
            </div>
            <div>
              <Label>Secret / password</Label>
              <Input
                type="password"
                className="mt-1.5"
                value={draft.smtp.secret}
                onChange={(e) => update("smtp", { secret: e.target.value })}
                placeholder="••••••••"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Stored as plaintext for now — TODO: encrypt at rest.
              </p>
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="security" className="mt-6 max-w-2xl">
          <Section title="Authentication & access" description="Platform-wide auth hardening.">
            <div className="flex items-center justify-between text-sm">
              <div>
                <div>Require MFA for platform admins</div>
                <div className="text-xs text-muted-foreground">
                  Forces TOTP on every platform-admin login.
                </div>
              </div>
              <Switch
                checked={draft.security.mfaRequired}
                onCheckedChange={(v) => update("security", { mfaRequired: Boolean(v) })}
              />
            </div>
            <div>
              <Label>Session timeout (minutes)</Label>
              <Input
                className="mt-1.5"
                inputMode="numeric"
                value={draft.security.sessionTimeoutMinutes}
                onChange={(e) =>
                  update("security", { sessionTimeoutMinutes: e.target.value })
                }
              />
            </div>
            <div>
              <Label>IP allowlist (comma-separated CIDRs)</Label>
              <Input
                className="mt-1.5"
                value={draft.security.ipAllowlist}
                onChange={(e) =>
                  update("security", { ipAllowlist: e.target.value })
                }
              />
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="limits" className="mt-6 max-w-2xl">
          <Section title="Limits & quotas" description="Platform-wide defaults.">
            <div>
              <Label>Max orgs per user</Label>
              <Input
                className="mt-1.5"
                inputMode="numeric"
                value={draft.limits.maxOrgsPerUser}
                onChange={(e) =>
                  update("limits", { maxOrgsPerUser: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Default API rate limit (req / min)</Label>
              <Input
                className="mt-1.5"
                inputMode="numeric"
                value={draft.limits.defaultRateLimitPerMinute}
                onChange={(e) =>
                  update("limits", {
                    defaultRateLimitPerMinute: e.target.value,
                  })
                }
              />
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="branding" className="mt-6 max-w-2xl">
          <Section title="Platform branding" description="Customer-facing platform identity.">
            <div>
              <Label>Platform name</Label>
              <Input
                className="mt-1.5"
                value={draft.branding.platformName}
                onChange={(e) =>
                  update("branding", { platformName: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Support email</Label>
              <Input
                className="mt-1.5"
                value={draft.branding.supportEmail}
                onChange={(e) =>
                  update("branding", { supportEmail: e.target.value })
                }
              />
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="theming" className="mt-6 max-w-2xl">
          <Section
            title="Global app font"
            description="Applied consistently across the dashboard, admin, and public pages. Defaults to Inter."
          >
            <div>
              <Label>Body font (sans)</Label>
              <select
                className="mt-1.5 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={draft.theming.fontSans}
                onChange={(e) => update("theming", { fontSans: e.target.value })}
              >
                {SANS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Heading font (display)</Label>
              <select
                className="mt-1.5 h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={draft.theming.fontDisplay}
                onChange={(e) => update("theming", { fontDisplay: e.target.value })}
              >
                {DISPLAY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Changes apply on the next page load (cached up to 60s).
            </p>
          </Section>
        </TabsContent>

        <TabsContent value="plans" className="mt-6 max-w-2xl">
          <PlansTab />
        </TabsContent>
      </Tabs>

      <div className="mt-6">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

// Plans editor — seeds from the effective catalog (GET /billing/plans) and saves
// overrides to PlatformSetting.plans. Quota limits are code-driven and not shown.
type PlanRow = {
  plan: string;
  name: string;
  priceMonthlyUsd: string; // "" = custom (null)
  priceId: string;
  features: string; // newline-separated
};

function PlansTab() {
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    clientApi
      .get<{ plans: { plan: string; name: string; priceMonthlyUsd: number | null; priceId: string | null; features: string[] }[] }>(
        "/billing/plans",
      )
      .then((d) =>
        setRows(
          d.plans.map((p) => ({
            plan: p.plan,
            name: p.name ?? "",
            priceMonthlyUsd: p.priceMonthlyUsd == null ? "" : String(p.priceMonthlyUsd),
            priceId: p.priceId ?? "",
            features: (p.features ?? []).join("\n"),
          })),
        ),
      )
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load plans"));
  }, []);

  function update(i: number, partial: Partial<PlanRow>) {
    setRows((prev) => (prev ? prev.map((r, idx) => (idx === i ? { ...r, ...partial } : r)) : prev));
    setSaved(false);
  }

  async function save() {
    if (!rows) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const plans = rows.map((r) => ({
        plan: r.plan,
        name: r.name,
        priceMonthlyUsd: r.priceMonthlyUsd.trim() === "" ? null : Number(r.priceMonthlyUsd),
        priceId: r.priceId.trim() || undefined,
        features: r.features
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      }));
      await clientApi.patch("/admin/settings", { plans });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !rows) {
    return <div className="text-sm text-destructive">{error}</div>;
  }
  if (!rows) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading plans…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Edit the customer-facing plans rendered on the pricing and billing pages. Quota limits are
        fixed in code. Leave price empty for a custom (&ldquo;Contact us&rdquo;) plan. The Paddle
        price ID drives checkout.
      </p>
      {rows.map((r, i) => (
        <Section key={r.plan} title={r.name || r.plan} description={`Tier: ${r.plan}`}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Display name</Label>
              <Input className="mt-1.5" value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
            </div>
            <div>
              <Label>Price (USD / mo)</Label>
              <Input
                className="mt-1.5"
                inputMode="numeric"
                placeholder="empty = custom"
                value={r.priceMonthlyUsd}
                onChange={(e) => update(i, { priceMonthlyUsd: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Paddle price ID</Label>
            <Input
              className="mt-1.5"
              placeholder="pri_…"
              value={r.priceId}
              onChange={(e) => update(i, { priceId: e.target.value })}
            />
          </div>
          <div>
            <Label>Features (one per line)</Label>
            <textarea
              className="mt-1.5 min-h-[88px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={r.features}
              onChange={(e) => update(i, { features: e.target.value })}
            />
          </div>
        </Section>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save plans
        </Button>
        {saved && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
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
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  );
}
