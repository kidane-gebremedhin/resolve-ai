import type { ProviderAdapter, RawCredentials, ToolTemplate } from "./types.js";
import type { EncryptedBlob } from "../../security/crypto.service.js";
import { env } from "../../../config/env.js";

export class ShopifyAdapter implements ProviderAdapter {
  readonly provider = "shopify";

  buildAuthUrl(orgId: string, state: string): string {
    const shop = process.env.SHOPIFY_SHOP ?? "";
    const clientId = process.env.SHOPIFY_CLIENT_ID ?? "";
    if (!shop || !clientId) return "";
    const params = new URLSearchParams({
      client_id: clientId,
      scope: "read_orders,write_orders",
      redirect_uri: `${env.apiBaseUrl}/api/v1/integrations/shopify/callback`,
      state,
    });
    return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, _orgId: string): Promise<RawCredentials> {
    const shop = process.env.SHOPIFY_SHOP ?? "";
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_CLIENT_ID,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET,
        code,
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    return { accessToken: data.access_token as string, extra: { shop } };
  }

  async refreshTokens(_blob: EncryptedBlob): Promise<RawCredentials | null> {
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
}
