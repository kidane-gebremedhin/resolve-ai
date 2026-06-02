import { api, ApiError } from "@/lib/api";
import { getActiveWebsiteId } from "@/lib/website-scope";
import {
  AgentEditor,
  CreateAgentForm,
  type AgentDoc,
  type AgentDefaults,
} from "@/components/ai/agent-editor";

export const dynamic = "force-dynamic";

// Used only if the defaults endpoint is unreachable; mirrors the env defaults.
const FALLBACK_DEFAULTS: AgentDefaults = {
  model: "openai/gpt-4o",
  temperature: 0.2,
  confidenceThreshold: 0.7,
};

function PickWebsite() {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-muted-foreground">
      Each website has its own AI agent. Pick a website in the sidebar switcher to
      configure its agent.
    </div>
  );
}

async function Page() {
  const websiteId = await getActiveWebsiteId();

  let agent: AgentDoc | null = null;
  let defaults: AgentDefaults = FALLBACK_DEFAULTS;
  let loadError: string | null = null;
  if (websiteId) {
    try {
      const [agents, d] = await Promise.all([
        api.get<AgentDoc[]>(`/agents?websiteId=${websiteId}`),
        api.get<AgentDefaults>("/agents/defaults"),
      ]);
      agent = agents[0] ?? null;
      defaults = d;
    } catch (e) {
      loadError = e instanceof ApiError ? e.message : "Failed to load agent.";
    }
  }

  return (
    <div className="container-page py-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">AI agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tune personality, choose a model, and manage what the AI knows — per website.
        </p>
      </div>

      {loadError && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {!websiteId ? (
        <PickWebsite />
      ) : !agent && !loadError ? (
        <CreateAgentForm websiteId={websiteId} />
      ) : agent ? (
        <AgentEditor agent={agent} defaults={defaults} />
      ) : null}
    </div>
  );
}

export default Page;
