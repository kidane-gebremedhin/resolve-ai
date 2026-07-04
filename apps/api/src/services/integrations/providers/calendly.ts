import type { ProviderAdapter, RawCredentials, ToolTemplate } from "./types.js";
import type { EncryptedBlob } from "../../security/crypto.service.js";
import { env } from "../../../config/env.js";

const OAUTH_BASE = "https://auth.calendly.com/oauth";
const API_BASE = "https://api.calendly.com";

export class CalendlyAdapter implements ProviderAdapter {
  readonly provider = "calendly";

  buildAuthUrl(orgId: string, state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.CALENDLY_CLIENT_ID ?? "",
      redirect_uri: `${env.apiBaseUrl}/api/v1/integrations/calendly/callback`,
      response_type: "code",
      state,
    });
    return `${OAUTH_BASE}/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, _orgId: string): Promise<RawCredentials> {
    const res = await fetch(`${OAUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.CALENDLY_CLIENT_ID ?? "",
        client_secret: process.env.CALENDLY_CLIENT_SECRET ?? "",
        code,
        grant_type: "authorization_code",
        redirect_uri: `${env.apiBaseUrl}/api/v1/integrations/calendly/callback`,
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    return {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string,
      expiresAt: Date.now() / 1000 + Number(data.expires_in ?? 7200),
    };
  }

  async refreshTokens(_blob: EncryptedBlob): Promise<RawCredentials | null> {
    return null;
  }

  getTools(): ToolTemplate[] {
    return [
      {
        key: "list_calendar_slots",
        displayName: "List Available Calendar Slots",
        description: "Returns available scheduling slots from the operator's Calendly event types.",
        jsonSchema: {
          type: "object",
          properties: {
            eventTypeUri: { type: "string", description: "Calendly event type URI" },
            startTime: { type: "string", format: "date-time" },
            endTime: { type: "string", format: "date-time" },
          },
          required: ["eventTypeUri", "startTime", "endTime"],
        },
      },
      {
        key: "book_meeting",
        displayName: "Book a Meeting",
        description: "Creates a scheduling invitation for a Calendly event type.",
        jsonSchema: {
          type: "object",
          properties: {
            eventTypeUri: { type: "string" },
            name: { type: "string" },
            email: { type: "string", format: "email" },
          },
          required: ["eventTypeUri", "name", "email"],
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
    const headers = {
      Authorization: `Bearer ${credentials.accessToken ?? ""}`,
      "Content-Type": "application/json",
    };

    if (toolKey === "list_calendar_slots") {
      const qs = new URLSearchParams({
        event_type: args.eventTypeUri as string,
        start_time: args.startTime as string,
        end_time: args.endTime as string,
      });
      const res = await fetch(`${API_BASE}/event_type_available_times?${qs}`, { headers });
      return res.json();
    }

    if (toolKey === "book_meeting") {
      const res = await fetch(`${API_BASE}/scheduling_links`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          max_event_count: 1,
          owner: args.eventTypeUri,
          owner_type: "EventType",
        }),
      });
      return res.json();
    }

    throw new Error(`Unknown tool key: ${toolKey}`);
  }
}
