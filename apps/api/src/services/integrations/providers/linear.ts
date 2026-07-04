import type { ProviderAdapter, RawCredentials, ToolTemplate } from "./types.js";
import type { EncryptedBlob } from "../../security/crypto.service.js";
import { env } from "../../../config/env.js";

const OAUTH_BASE = "https://linear.app/oauth";
const GQL_ENDPOINT = "https://api.linear.app/graphql";

export class LinearAdapter implements ProviderAdapter {
  readonly provider = "linear";

  buildAuthUrl(orgId: string, state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.LINEAR_CLIENT_ID ?? "",
      redirect_uri: `${env.apiBaseUrl}/api/v1/integrations/linear/callback`,
      response_type: "code",
      scope: "issues:create,read",
      state,
    });
    return `${OAUTH_BASE}/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, _orgId: string): Promise<RawCredentials> {
    const res = await fetch(`${OAUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.LINEAR_CLIENT_ID ?? "",
        client_secret: process.env.LINEAR_CLIENT_SECRET ?? "",
        code,
        grant_type: "authorization_code",
        redirect_uri: `${env.apiBaseUrl}/api/v1/integrations/linear/callback`,
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    return { accessToken: data.access_token as string };
  }

  async refreshTokens(_blob: EncryptedBlob): Promise<RawCredentials | null> {
    return null;
  }

  getTools(): ToolTemplate[] {
    return [
      {
        key: "create_support_ticket",
        displayName: "Create Support Ticket",
        description: "Creates a Linear issue from this support conversation.",
        jsonSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Issue title" },
            description: { type: "string", description: "Issue description (conversation summary)" },
            priority: { type: "number", enum: [0, 1, 2, 3, 4], description: "0=no priority, 1=urgent, 2=high, 3=medium, 4=low" },
          },
          required: ["title"],
        },
      },
    ];
  }

  async execute(
    toolKey: string,
    args: Record<string, unknown>,
    credentials: RawCredentials,
    _sandbox: boolean,
  ): Promise<unknown> {
    if (toolKey === "create_support_ticket") {
      const teamId = (args._teamId as string) ?? process.env.LINEAR_DEFAULT_TEAM_ID ?? "";
      const res = await fetch(GQL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.accessToken ?? ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation CreateIssue($input: IssueCreateInput!) {
              issueCreate(input: $input) { success issue { id identifier url } }
            }
          `,
          variables: {
            input: {
              teamId,
              title: args.title,
              description: [
                args.description ?? "",
                args._transcript ? `\n\n---\n**Conversation transcript:**\n${args._transcript}` : "",
              ].join(""),
              priority: args.priority ?? 3,
            },
          },
        }),
      });
      return res.json();
    }

    throw new Error(`Unknown tool key: ${toolKey}`);
  }
}
