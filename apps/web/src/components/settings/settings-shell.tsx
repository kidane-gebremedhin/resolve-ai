"use client";

// Top-level Settings page shell. Renders the 5 tabs and dispatches to the
// per-tab client components. Agent + Team + Widget are delegated back to
// the existing `SettingsClient` rendered inline-by-tab — we slice its
// internals via a `forcedTab` prop hack to avoid copying the still-living
// behaviour. Security / API / Audit are the new tabs added in this work.

import { useState } from "react";
import { Building2, ClipboardList, Code2, ShieldCheck, Users } from "lucide-react";
import { TwoFactor } from "./two-factor";
import { ApiKeys, type ApiKeyRow } from "./api-keys";
import { AuditLog, type AuditItem } from "./audit-log";
import { GeneralInline } from "./general";
import {
  TeamInline,
  ApiInfoInline,
  type Agent,
  type Member,
  type Org,
} from "./tab-inlines";

// AI Agent and Web widget live on their own dedicated pages (/app/ai and
// /app/widget) — they were removed from Settings to avoid duplicate surfaces.
const TABS = [
  { id: "general", label: "General", icon: Building2 },
  { id: "team", label: "Team", icon: Users },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "api", label: "API", icon: Code2 },
  { id: "audit", label: "Audit log", icon: ClipboardList },
] as const;

type TabId = (typeof TABS)[number]["id"];

interface Props {
  org: Org | null;
  initialAgent: Agent | null;
  initialMembers: Member[];
  apiBaseUrl: string;
  initialApiKeys: ApiKeyRow[];
  initialAudit: AuditItem[];
  initialAuditCursor: string | null;
  initialTotpEnabled: boolean;
}

export function SettingsShell({
  org,
  initialAgent,
  initialMembers,
  apiBaseUrl,
  initialApiKeys,
  initialAudit,
  initialAuditCursor,
  initialTotpEnabled,
}: Props) {
  const [tab, setTab] = useState<TabId>("general");

  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your organization, team, security, and API access.
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
          {tab === "general" && <GeneralInline org={org} />}
          {tab === "team" && <TeamInline initialMembers={initialMembers} />}
          {tab === "security" && <TwoFactor initialEnabled={initialTotpEnabled} />}
          {tab === "api" && (
            <>
              <ApiInfoInline org={org} apiBaseUrl={apiBaseUrl} />
              <ApiKeys initial={initialApiKeys} />
            </>
          )}
          {tab === "audit" && (
            <AuditLog initialItems={initialAudit} initialCursor={initialAuditCursor} />
          )}
        </div>
      </div>
    </div>
  );
}
