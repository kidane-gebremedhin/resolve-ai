// Every website has exactly one agent. This helper creates a website's default
// agent. Model-tuning fields (model/temperature/confidenceThreshold) are left
// UNSET so the runtime reads the env defaults and the dashboard prepopulates the
// editors from GET /agents/defaults — operators then override per website.

import { Agent } from "../models/index.js";

export async function ensureWebsiteAgent(
  organizationId: string | { toString(): string },
  websiteId: string | { toString(): string },
  name?: string,
): Promise<InstanceType<typeof Agent>> {
  const existing = await Agent.findOne({ websiteId });
  if (existing) return existing;

  // Default agents get a generic, brand-neutral name — NEVER the website/org
  // name. The widget's identity is the operator-configured Agent Name; deriving
  // it from the website made the bot refer to itself by the company/site name.
  const agentName = name ?? "Support agent";

  return Agent.create({
    organizationId,
    websiteId,
    name: agentName,
    welcomeMessage: "Hi! How can I help today?",
    isActive: true,
  });
}
