import type { OAuthAppCreds, ProviderAdapter, RawCredentials, ToolTemplate } from "./types.js";
import type { EncryptedBlob } from "../../security/crypto.service.js";
import { env } from "../../../config/env.js";

const OAUTH_BASE = "https://auth.calendly.com/oauth";
const API_BASE = "https://api.calendly.com";

export class CalendlyAdapter implements ProviderAdapter {
  readonly provider = "calendly";

  private redirectUri(app?: OAuthAppCreds | null): string {
    return app?.redirectUri ?? `${env.apiBaseUrl}/api/v1/integrations/calendly/callback`;
  }

  buildAuthUrl(_orgId: string, state: string, app?: OAuthAppCreds | null): string {
    const params = new URLSearchParams({
      client_id: app?.clientId ?? "",
      redirect_uri: this.redirectUri(app),
      response_type: "code",
      state,
    });
    return `${OAUTH_BASE}/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, _orgId: string, app?: OAuthAppCreds | null): Promise<RawCredentials> {
    const res = await fetch(`${OAUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: app?.clientId ?? "",
        client_secret: app?.clientSecret ?? "",
        code,
        grant_type: "authorization_code",
        redirect_uri: this.redirectUri(app),
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    // A failed exchange (bad/missing secret, expired code) returns no access_token —
    // surface it rather than storing a tokenless "connected" integration.
    if (!res.ok || !data.access_token) {
      throw new Error(
        `Calendly token exchange failed: ${data.error_description ?? data.error ?? res.status}`,
      );
    }
    return {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string,
      expiresAt: Date.now() / 1000 + Number(data.expires_in ?? 7200),
    };
  }

  async refreshTokens(_blob: EncryptedBlob, _app?: OAuthAppCreds | null): Promise<RawCredentials | null> {
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

  async verifyCredentials(credentials: RawCredentials): Promise<{ ok: boolean; error?: string }> {
    const token = credentials.accessToken ?? credentials.apiKey ?? "";
    if (!token) return { ok: false, error: "No Calendly token provided." };
    try {
      const res = await fetch(`${API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (res.ok) return { ok: true };
      if (res.status === 401 || res.status === 403) return { ok: false, error: "Calendly rejected this token (unauthorized)." };
      return { ok: false, error: `Calendly returned HTTP ${res.status}.` };
    } catch (err) {
      return { ok: false, error: `Couldn't reach Calendly: ${(err as Error).message}` };
    }
  }
}
