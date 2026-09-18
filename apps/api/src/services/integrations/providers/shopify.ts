import type { OAuthAppCreds, ProviderAdapter, RawCredentials, ToolTemplate } from "./types.js";
import type { EncryptedBlob } from "../../security/crypto.service.js";
import { env } from "../../../config/env.js";

export class ShopifyAdapter implements ProviderAdapter {
  readonly provider = "shopify";

  buildAuthUrl(_orgId: string, state: string, app?: OAuthAppCreds | null): string {
    // The shop domain is a non-secret, per-operator app extra (e.g. example.myshopify.com).
    const shop = String(app?.extra?.shop ?? "");
    const clientId = app?.clientId ?? "";
    if (!shop || !clientId) return "";
    const params = new URLSearchParams({
      client_id: clientId,
      scope: "read_orders,write_orders",
      redirect_uri: app?.redirectUri ?? `${env.apiBaseUrl}/api/v1/integrations/shopify/callback`,
      state,
    });
    return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, _orgId: string, app?: OAuthAppCreds | null): Promise<RawCredentials> {
    const shop = String(app?.extra?.shop ?? "");
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: app?.clientId,
        client_secret: app?.clientSecret,
        code,
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    // A failed exchange (bad/missing secret, expired code) returns no access_token —
    // surface it rather than storing a tokenless "connected" integration.
    if (!res.ok || !data.access_token) {
      throw new Error(
        `Shopify token exchange failed: ${data.error_description ?? data.error ?? res.status}`,
      );
    }
    return { accessToken: data.access_token as string, extra: { shop } };
  }

  async refreshTokens(_blob: EncryptedBlob, _app?: OAuthAppCreds | null): Promise<RawCredentials | null> {
    return null;
  }

  getTools(): ToolTemplate[] {
    return [
      {
        key: "lookup_order",
        displayName: "Look Up Order",
        description: "Looks up a Shopify order by ID or order number.",
        jsonSchema: {
          type: "object",
          properties: {
            orderId: { type: "string", description: "Shopify order ID or #order-number" },
          },
          required: ["orderId"],
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
    const shop = (credentials.extra?.shop as string) ?? "";
    const headers = { "X-Shopify-Access-Token": credentials.accessToken ?? "", "Content-Type": "application/json" };

    if (toolKey === "lookup_order") {
      const res = await fetch(`https://${shop}/admin/api/2024-01/orders/${args.orderId}.json`, { headers });
      return res.json();
    }

    throw new Error(`Unknown tool key: ${toolKey}`);
  }

  async verifyCredentials(credentials: RawCredentials): Promise<{ ok: boolean; error?: string }> {
    const shop = (credentials.extra?.shop as string) ?? "";
    const token = credentials.accessToken ?? credentials.apiKey ?? "";
    if (!shop) return { ok: false, error: "Missing Shopify store domain — reconnect via OAuth to capture it." };
    if (!token) return { ok: false, error: "No Shopify access token provided." };
    try {
      const res = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
        headers: { "X-Shopify-Access-Token": token },
      });
      if (res.ok) return { ok: true };
      if (res.status === 401 || res.status === 403) return { ok: false, error: "Shopify rejected these credentials (unauthorized)." };
      return { ok: false, error: `Shopify returned HTTP ${res.status}.` };
    } catch (err) {
      return { ok: false, error: `Couldn't reach Shopify: ${(err as Error).message}` };
    }
  }
}
