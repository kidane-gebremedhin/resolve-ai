import { CalcomAdapter } from "../providers/calcom.js";
import { CalendlyAdapter } from "../providers/calendly.js";
import { StripeAdapter } from "../providers/stripe.js";
import { ShopifyAdapter } from "../providers/shopify.js";
import { LinearAdapter } from "../providers/linear.js";
import { JiraAdapter } from "../providers/jira.js";
import { PaddleAdapter } from "../providers/paddle.js";
import { WebhookAdapter } from "../providers/webhook.js";
import type { ProviderAdapter } from "../providers/types.js";

const adapters: Record<string, ProviderAdapter> = {
  calcom: new CalcomAdapter(),
  calendly: new CalendlyAdapter(),
  stripe: new StripeAdapter(),
  shopify: new ShopifyAdapter(),
  linear: new LinearAdapter(),
  jira: new JiraAdapter(),
  paddle: new PaddleAdapter(),
  webhook: new WebhookAdapter(),
};

export function getAdapter(provider: string): ProviderAdapter | null {
  return adapters[provider] ?? null;
}

export function listAdapters(): ProviderAdapter[] {
  return Object.values(adapters);
}
