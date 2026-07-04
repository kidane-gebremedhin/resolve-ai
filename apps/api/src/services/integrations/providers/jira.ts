import type { ProviderAdapter, RawCredentials, ToolTemplate } from "./types.js";
import type { EncryptedBlob } from "../../security/crypto.service.js";
import { env } from "../../../config/env.js";

const OAUTH_BASE = "https://auth.atlassian.com/authorize";
const TOKEN_URL = "https://auth.atlassian.com/oauth/token";

// Allow an explicit override so the redirect URI registered in the Atlassian
// developer console can differ from API_BASE_URL (e.g. ngrok tunnel vs localhost).
function getRedirectUri(): string {
  return (
    process.env.ATLASSIAN_REDIRECT_URI ??
    `${env.apiBaseUrl}/api/v1/integrations/jira/callback`
  );
}

export class JiraAdapter implements ProviderAdapter {
  readonly provider = "jira";

  buildAuthUrl(orgId: string, state: string): string {
    const params = new URLSearchParams({
      audience: "api.atlassian.com",
      client_id: process.env.ATLASSIAN_CLIENT_ID ?? "",
      redirect_uri: getRedirectUri(),
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

  async exchangeCode(code: string, _orgId: string): Promise<RawCredentials> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: process.env.ATLASSIAN_CLIENT_ID,
        client_secret: process.env.ATLASSIAN_CLIENT_SECRET,
        code,
        redirect_uri: getRedirectUri(),
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
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

  async refreshTokens(blob: EncryptedBlob): Promise<RawCredentials | null> {
    const { decrypt } = await import("../../security/crypto.service.js");
    let existing: RawCredentials;
    try {
      existing = JSON.parse(decrypt(blob)) as RawCredentials;
    } catch {
      return null;
    }
    if (!existing.refreshToken) return null;

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: process.env.ATLASSIAN_CLIENT_ID,
        client_secret: process.env.ATLASSIAN_CLIENT_SECRET,
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
  async listProjects(credentials: RawCredentials): Promise<{ key: string; name: string }[]> {
    const cloudId = (credentials.extra?.cloudId as string) ?? "";
    if (!cloudId) return [];
    const apiBase = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;
    const res = await fetch(`${apiBase}/project/search`, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken ?? ""}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return [];
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
                  // The full conversation goes up as a file attachment below.
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

      // Attach the full conversation transcript as a file so agents have the
      // complete context without bloating the description. Best-effort — a failed
      // attachment must never fail the ticket itself.
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
}
