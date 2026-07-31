import type { OAuthAppCreds, ProviderAdapter, RawCredentials, ToolTemplate } from "./types.js";
import type { EncryptedBlob } from "../../security/crypto.service.js";
import { env } from "../../../config/env.js";

const OAUTH_BASE = "https://auth.atlassian.com/authorize";
const TOKEN_URL = "https://auth.atlassian.com/oauth/token";

// The redirect URI must match the one registered in the operator's Atlassian OAuth
// app. It can be overridden per-app config (e.g. an ngrok tunnel); otherwise it
// derives from API_BASE_URL.
function getRedirectUri(app?: OAuthAppCreds | null): string {
  return app?.redirectUri ?? `${env.apiBaseUrl}/api/v1/integrations/jira/callback`;
}

export class JiraAdapter implements ProviderAdapter {
  readonly provider = "jira";

  buildAuthUrl(_orgId: string, state: string, app?: OAuthAppCreds | null): string {
    const params = new URLSearchParams({
      audience: "api.atlassian.com",
      client_id: app?.clientId ?? "",
      redirect_uri: getRedirectUri(app),
      response_type: "code",
      // offline_access is required to get a refresh_token so the connection
      // stays alive beyond the 1-hour access-token lifetime. read:jira-work lets
      // us list/resolve projects so the AI doesn't have to guess a project key.
      scope: "read:jira-user read:jira-work write:jira-work offline_access",
      prompt: "consent",
      state,
    });
    return `${OAUTH_BASE}?${params.toString()}`;
  }

  async exchangeCode(code: string, _orgId: string, app?: OAuthAppCreds | null): Promise<RawCredentials> {
    // Atlassian is a CONFIDENTIAL OAuth client — the token exchange requires a client
    // secret. Fail fast with a clear message if it's missing, otherwise the request
    // below silently returns no access_token and we'd store a tokenless "connected"
    // integration.
    if (!app?.clientSecret) {
      throw new Error(
        "Jira requires an OAuth client secret. Add it to the Jira OAuth app in Integrations, then reconnect.",
      );
    }
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: app?.clientId,
        client_secret: app?.clientSecret,
        code,
        redirect_uri: getRedirectUri(app),
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    // A failed exchange (bad secret/redirect, expired code) returns a non-2xx with an
    // error payload but no access_token — surface it instead of storing empty creds.
    if (!res.ok || !data.access_token) {
      throw new Error(
        `Jira token exchange failed: ${data.error_description ?? data.error ?? res.status}`,
      );
    }
    // Fetch the accessible resources to get the cloud ID
    const cloudRes = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
      headers: { Authorization: `Bearer ${data.access_token}`, Accept: "application/json" },
    });
    const clouds = (await cloudRes.json()) as Array<{ id: string; url?: string }>;
    const cloudId = clouds[0]?.id ?? "";
    // The site URL (e.g. https://acme.atlassian.net) is the human-browsable host —
    // keep it so ticket links point at the UI, not the api.atlassian.com gateway.
    const siteUrl = clouds[0]?.url ?? "";
    return {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string,
      expiresAt: Date.now() / 1000 + Number(data.expires_in ?? 3600),
      extra: { cloudId, siteUrl },
    };
  }

  async refreshTokens(blob: EncryptedBlob, app?: OAuthAppCreds | null): Promise<RawCredentials | null> {
    const { decrypt } = await import("../../security/crypto.service.js");
    let existing: RawCredentials;
    try {
      existing = JSON.parse(decrypt(blob)) as RawCredentials;
    } catch {
      return null;
    }
    if (!existing.refreshToken) return null;
    if (!app?.clientId || !app?.clientSecret) return null; // no app configured → can't refresh

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: app.clientId,
        client_secret: app.clientSecret,
        refresh_token: existing.refreshToken,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return {
      accessToken: data.access_token as string,
      refreshToken: (data.refresh_token as string) ?? existing.refreshToken,
      expiresAt: Date.now() / 1000 + Number(data.expires_in ?? 3600),
      extra: existing.extra,
    };
  }

  getTools(): ToolTemplate[] {
    return [
      {
        key: "create_support_ticket",
        displayName: "Create Support Ticket",
        description: "Creates a Jira issue from this support conversation.",
        jsonSchema: {
          type: "object",
          properties: {
            summary: { type: "string", description: "Issue summary/title" },
            description: { type: "string" },
            projectKey: { type: "string", description: "Jira project key (e.g. SUPPORT)" },
            issueType: { type: "string", default: "Task" },
          },
          required: ["summary", "projectKey"],
        },
      },
    ];
  }

  // List the Jira projects available to this connection so the dashboard can offer
  // a pick-list instead of a free-text key (which let operators save a project
  // that doesn't exist — e.g. "PTKA" when only "KAN" exists — breaking ticket
  // creation). Best-effort: returns [] if the call fails / scope is missing.
  // Throws a typed error (jira_missing_cloud_id / jira_unauthorized /
  // jira_forbidden / jira_http_<status>) instead of silently returning [] so the
  // route can tell an expired token (→ refresh & retry, or prompt reconnect) apart
  // from a missing scope or a genuinely empty site, and show the operator why.
  async listProjects(credentials: RawCredentials): Promise<{ key: string; name: string }[]> {
    const cloudId = (credentials.extra?.cloudId as string) ?? "";
    if (!cloudId) throw new Error("jira_missing_cloud_id");
    const apiBase = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;
    const res = await fetch(`${apiBase}/project/search`, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken ?? ""}`,
        Accept: "application/json",
      },
    });
    if (res.status === 401) throw new Error("jira_unauthorized");
    if (res.status === 403) throw new Error("jira_forbidden");
    if (!res.ok) throw new Error(`jira_http_${res.status}`);
    const data = (await res.json()) as { values?: { key: string; name: string }[] };
    return (data.values ?? []).map((p) => ({ key: p.key, name: p.name }));
  }

  async execute(
    toolKey: string,
    args: Record<string, unknown>,
    credentials: RawCredentials,
    _sandbox: boolean,
  ): Promise<unknown> {
    if (toolKey === "create_support_ticket") {
      const cloudId = (credentials.extra?.cloudId as string) ?? "";
      if (!cloudId) {
        throw new Error("Jira connection is missing its cloudId — reconnect the integration.");
      }
      const apiBase = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;
      const authHeaders = {
        Authorization: `Bearer ${credentials.accessToken ?? ""}`,
        Accept: "application/json",
      };

      // Resolve the project key against the instance's real projects:
      //  - Operator's configured key (injected by the dispatcher) that EXISTS →
      //    honoured (case-normalised). The agent editor now offers a dropdown of
      //    real projects, so a configured key should always match.
      //  - Configured key that doesn't exist (stale), or the AI's default guess
      //    ("SUPPORT"), or blank → fall back to the first real project so the
      //    ticket is still created rather than dropped.
      //  - If projects can't be listed (network/scope), proceed with the
      //    requested key as-is.
      let resolvedKey = String(args.projectKey ?? "").trim();
      try {
        const projRes = await fetch(`${apiBase}/project/search`, { headers: authHeaders });
        if (projRes.ok) {
          const projData = (await projRes.json()) as { values?: { key: string }[] };
          const projects = projData.values ?? [];
          if (projects.length > 0) {
            const match = projects.find(
              (p) => p.key.toLowerCase() === resolvedKey.toLowerCase(),
            );
            resolvedKey = (match ?? projects[0]!).key;
          }
        }
      } catch {
        // Network/scope issue — proceed with the requested key.
      }
      if (!resolvedKey) {
        throw new Error("No Jira project available to create the ticket in.");
      }

      const body: Record<string, unknown> = {
        fields: {
          project: { key: resolvedKey },
          summary: args.summary,
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  // Keep the description to the AI's CONCISE, issue-only summary.
                  // The issue-scoped transcript goes up as a file attachment below.
                  { type: "text", text: String(args.description ?? "No description provided.") },
                ],
              },
            ],
          },
          issuetype: { name: args.issueType ?? "Task" },
        },
      };
      const res = await fetch(`${apiBase}/issue`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      // Jira returns 4xx/5xx with an error body — surface it as a thrown error so
      // the dispatcher logs status="error" and the AI doesn't claim success on a
      // 401/403/400. Without this check a failed call looks like a created ticket.
      if (!res.ok) {
        const detail =
          (Array.isArray(data.errorMessages) && data.errorMessages.join("; ")) ||
          (data.errors && JSON.stringify(data.errors)) ||
          (data.message as string) ||
          `HTTP ${res.status}`;
        throw new Error(`Jira ticket creation failed: ${detail}`);
      }
      // Return a compact, useful result (issue key + browse URL) for the AI/audit log.
      // Link to the tenant UI host (…atlassian.net/browse/KEY), not the API gateway.
      const key = data.key as string | undefined;
      const siteUrl = (credentials.extra?.siteUrl as string | undefined) ?? "";
      const browseUrl = key && siteUrl ? `${siteUrl}/browse/${key}` : undefined;

      // Attach the issue-scoped conversation transcript as a file so agents have the
      // relevant context (the messages about this issue, not the whole chat) without
      // bloating the description. Best-effort — a failed attachment must never fail the
      // ticket itself.
      const transcript = String(args._transcript ?? "").trim();
      if (key && transcript) {
        try {
          const form = new FormData();
          form.append(
            "file",
            new Blob([transcript], { type: "text/plain" }),
            "conversation-transcript.txt",
          );
          await fetch(`${apiBase}/issue/${key}/attachments`, {
            method: "POST",
            headers: {
              Authorization: authHeaders.Authorization,
              // Required by Jira to accept programmatic attachment uploads.
              "X-Atlassian-Token": "no-check",
            },
            body: form,
          });
        } catch {
          /* attachment is best-effort */
        }
      }
      return { ok: true, key, id: data.id, url: browseUrl, project: resolvedKey };
    }

    throw new Error(`Unknown tool key: ${toolKey}`);
  }

  async verifyCredentials(credentials: RawCredentials): Promise<{ ok: boolean; error?: string }> {
    const token = credentials.accessToken ?? "";
    if (!token) return { ok: false, error: "No Jira access token — reconnect the integration." };
    try {
      const res = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (res.status === 401 || res.status === 403) return { ok: false, error: "Jira rejected this token (unauthorized) — reconnect." };
      if (!res.ok) return { ok: false, error: `Jira returned HTTP ${res.status}.` };
      const clouds = (await res.json().catch(() => [])) as unknown[];
      if (!Array.isArray(clouds) || clouds.length === 0) return { ok: false, error: "Jira token has no accessible sites." };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Couldn't reach Jira: ${(err as Error).message}` };
    }
  }
}
