import { api } from "@/lib/api";
import { IntegrationsClient } from "./integrations-client";

export const dynamic = "force-dynamic";

type ProviderInfo = {
  provider: string;
  tools: { key: string; displayName: string; description: string }[];
  connection: {
    _id: string;
    name: string;
    status: "active" | "error" | "revoked";
    sandbox: boolean;
    authMode: "oauth" | "api_key" | "webhook";
    enabledAgentIds: string[];
  } | null;
};

type IntegrationsResponse = { providers: ProviderInfo[]; agents: { _id: string; name: string }[] };

async function fetchIntegrations(): Promise<IntegrationsResponse> {
  try {
    return await api.get<IntegrationsResponse>("/integrations");
  } catch {
    return { providers: [], agents: [] };
  }
}

export default async function IntegrationsPage() {
  const { providers, agents } = await fetchIntegrations();
  return <IntegrationsClient providers={providers} agents={agents ?? []} />;
}
