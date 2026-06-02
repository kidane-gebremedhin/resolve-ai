// Server component: knowledge is keyed by (organizationId, agentId). The sidebar
// website switcher picks a website; we resolve that website's agent and scope the
// knowledge base to it. With no website selected ("All websites") we list the
// whole org's sources read-only (adding requires a specific agent/website).

import { api, ApiError } from "@/lib/api";
import { getActiveWebsiteId } from "@/lib/website-scope";
import { KnowledgeList } from "@/components/knowledge/knowledge-list";
import type { KnowledgeSource } from "@/components/knowledge/types";

export const dynamic = "force-dynamic";

type Website = { _id: string; name: string; domain: string };
type Agent = { _id: string; websiteId: string };

export default async function KnowledgePage() {
  const websiteId = await getActiveWebsiteId();
  let sources: KnowledgeSource[] = [];
  let websites: Website[] = [];
  let agentId: string | null = null;
  let error: string | null = null;
  try {
    websites = await api.get<Website[]>("/websites");
    if (websiteId) {
      const agents = await api.get<Agent[]>(`/agents?websiteId=${websiteId}`);
      agentId = agents[0]?._id ?? null;
    }
    const qs = agentId ? `?agentId=${agentId}` : "";
    sources = await api.get<KnowledgeSource[]>(`/knowledge${qs}`);
  } catch (err) {
    error = err instanceof ApiError ? err.message : "Failed to load knowledge sources.";
  }

  if (error) {
    return (
      <div className="container-page py-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Knowledge</h1>
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      </div>
    );
  }

  const active = websites.find((w) => w._id === websiteId) ?? null;
  return (
    <KnowledgeList
      sources={sources}
      agentId={agentId}
      websiteLabel={active ? active.domain : null}
    />
  );
}
