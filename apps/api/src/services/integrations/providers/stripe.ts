import type { ProviderAdapter, RawCredentials, ToolTemplate } from "./types.js";
import type { EncryptedBlob } from "../../security/crypto.service.js";
import { env } from "../../../config/env.js";

const OAUTH_BASE = "https://connect.stripe.com/oauth";
const API_BASE = "https://api.stripe.com/v1";
const API_TEST = "https://api.stripe.com/v1";

export class StripeAdapter implements ProviderAdapter {
  readonly provider = "stripe";

  buildAuthUrl(orgId: string, state: string): string {
    const clientId = process.env.STRIPE_CLIENT_ID;
    if (!clientId) return "";
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${env.apiBaseUrl}/api/v1/integrations/stripe/callback`,
      response_type: "code",
      scope: "read_write",
      state,
    });
    return `${OAUTH_BASE}/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, _orgId: string): Promise<RawCredentials> {
    const res = await fetch(`${OAUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_secret: process.env.STRIPE_SECRET_KEY ?? "",
        code,
        grant_type: "authorization_code",
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
        key: "lookup_order",
        displayName: "Look Up Order",
        description: "Looks up a Stripe payment intent or charge by ID.",
        jsonSchema: {
          type: "object",
          properties: {
            orderId: { type: "string", description: "Stripe payment intent or charge ID (pi_... or ch_...)" },
          },
          required: ["orderId"],
        },
      },
      {
        key: "issue_refund",
        displayName: "Issue Refund",
        description: "Issues a refund for a Stripe charge. Requires identity verification for amounts above the guardrail cap.",
        jsonSchema: {
          type: "object",
          properties: {
            chargeId: { type: "string", description: "Stripe charge ID (ch_...)" },
            amount: { type: "number", description: "Refund amount in USD" },
            reason: { type: "string", enum: ["duplicate", "fraudulent", "requested_by_customer"] },
          },
          required: ["chargeId", "amount"],
        },
      },
    ];
  }

  async execute(
    toolKey: string,
    args: Record<string, unknown>,
    credentials: RawCredentials,
    sandbox: boolean,
  ): Promise<unknown> {
    const base = sandbox ? API_TEST : API_BASE;
    const auth = `Basic ${Buffer.from(`${credentials.accessToken ?? ""}:`).toString("base64")}`;
    const headers = { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" };

    if (toolKey === "lookup_order") {
      const id = args.orderId as string;
      const endpoint = id.startsWith("ch_") ? "charges" : "payment_intents";
      const res = await fetch(`${base}/${endpoint}/${id}`, { headers });
      return res.json();
    }

    if (toolKey === "issue_refund") {
      const amountCents = Math.round(Number(args.amount) * 100);
      const body = new URLSearchParams({
        charge: args.chargeId as string,
        amount: String(amountCents),
        ...(args.reason ? { reason: args.reason as string } : {}),
      });
      const res = await fetch(`${base}/refunds`, { method: "POST", headers, body });
      return res.json();
    }

    throw new Error(`Unknown tool key: ${toolKey}`);
  }

  async verifyCredentials(credentials: RawCredentials, sandbox: boolean): Promise<{ ok: boolean; error?: string }> {
    const base = sandbox ? API_TEST : API_BASE;
    const key = credentials.accessToken ?? credentials.apiKey ?? "";
    if (!key) return { ok: false, error: "No Stripe key provided." };
    try {
      const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
      const res = await fetch(`${base}/account`, { headers: { Authorization: auth } });
      if (res.ok) return { ok: true };
      if (res.status === 401) return { ok: false, error: "Stripe rejected this key (unauthorized)." };
      return { ok: false, error: `Stripe returned HTTP ${res.status}.` };
    } catch (err) {
      return { ok: false, error: `Couldn't reach Stripe: ${(err as Error).message}` };
    }
  }
}
