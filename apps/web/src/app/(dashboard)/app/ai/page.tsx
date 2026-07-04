import { api, ApiError } from "@/lib/api";
import { getEffectiveWebsiteId } from "@/lib/website-scope";
import {
  AgentEditor,
  type AgentDoc,
  type AgentDefaults,
  type ConnectedTool,
} from "@/components/ai/agent-editor";
import { ConversationSettings } from "@/components/settings/conversation-settings";
import { ListPreferences } from "@/components/settings/list-preferences";
import type { Org } from "@/components/settings/tab-inlines";

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
  const websiteId = await getEffectiveWebsiteId();

  // No website selected — show the same empty state as /app/widget (just the
  // heading + "pick a website" message, no form/subtitle), not an agent form.
  if (!websiteId) {
    return (
      <div className="container-page py-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight">AI agent</h1>
        <PickWebsite />
      </div>
    );
  }

  let agent: AgentDoc | null = null;
  let defaults: AgentDefaults = FALLBACK_DEFAULTS;
  let loadError: string | null = null;
  let connections: ConnectedTool[] = [];
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

  // Load connected integrations so the agent editor can show a per-tool toggle.
  if (agent) {
    try {
      const intData = await api.get<{
        providers: {
          provider: string;
          connection: { _id: string; name: string; status: string; enabledAgentIds: string[] } | null;
        }[];
      }>("/integrations");
      connections = intData.providers
        .filter((p) => p.connection?.status === "active")
        .map((p) => ({
          connectionId: p.connection!._id,
          connectionName: p.connection!.name ?? p.provider,
          provider: p.provider,
          enabledAgentIds: p.connection!.enabledAgentIds,
        }));
    } catch {
      // best-effort
    }
  }

  // Org-level conversation behavior (escalation toggle + ask-before-resolve).
  let org: Org | null = null;
  try {
    org = await api.get<Org>("/orgs/current");
  } catch {
    org = null;
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

      {agent ? (
        <AgentEditor agent={agent} defaults={defaults} connections={connections} />
      ) : !loadError ? (
        // Every website auto-provisions its agent (ensureWebsiteAgent); if none
        // is found it's still being set up — no manual "create agent" form.
        <div className="mt-6 rounded-xl border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-muted-foreground">
          Setting up this website&apos;s agent… reload in a moment.
        </div>
      ) : null}

      {agent ? (
        <div className="mt-8 space-y-6">
          <ConversationSettings org={org} />
          <ListPreferences org={org} />
        </div>
      ) : null}
    </div>
  );
}

export default Page;
