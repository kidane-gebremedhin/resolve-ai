// Server entry point for Settings. Fans out reads for org, members, agents,
// api keys, audit log, and current 2FA status in parallel, then hands them
// to the client-side `SettingsShell` which dispatches per-tab.

import { api, ApiError, API_BASE_URL } from "@/lib/api";
import { SettingsShell } from "@/components/settings/settings-shell";
import type { Agent, Member, Org } from "@/components/settings/tab-inlines";
import type { ApiKeyRow } from "@/components/settings/api-keys";
import type { AuditItem } from "@/components/settings/audit-log";

export const dynamic = "force-dynamic";

async function safeGet<T>(path: string): Promise<T | null> {
  // Wrap api.get so that one missing dependency (e.g. no agent yet, or the
  // user just hasn't loaded their first audit event) doesn't take out the
  // whole Settings page. Unexpected errors still escape so we don't silently
  // hide bugs.
  try {
    return await api.get<T>(path);
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

interface AuditResponse {
  items: AuditItem[];
  nextCursor: string | null;
}

interface TotpStatus {
  totpEnabled: boolean;
}

export default async function SettingsPage() {
  const [org, members, agents, apiKeys, audit, twoFa] = await Promise.all([
    safeGet<Org>("/orgs/current"),
    safeGet<Member[]>("/orgs/current/members"),
    safeGet<Agent[]>("/agents"),
    safeGet<ApiKeyRow[]>("/api-keys"),
    safeGet<AuditResponse>("/audit?limit=20"),
    safeGet<TotpStatus>("/auth/2fa/status"),
  ]);

  return (
    <SettingsShell
      org={org}
      initialMembers={members ?? []}
      initialAgent={agents?.[0] ?? null}
      apiBaseUrl={API_BASE_URL}
      initialApiKeys={apiKeys ?? []}
      initialAudit={audit?.items ?? []}
      initialAuditCursor={audit?.nextCursor ?? null}
      initialTotpEnabled={Boolean(twoFa?.totpEnabled)}
    />
  );
}
