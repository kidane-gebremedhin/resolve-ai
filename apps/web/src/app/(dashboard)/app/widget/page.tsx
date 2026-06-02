// Server entry point for the Widget Studio. Agents are per-website, so we load
// the agent for the active website (sidebar switcher) + its WidgetSettings and
// hand them to the client editor along with the widget app URL for the preview.

import { api, ApiError } from "@/lib/api";
import { getActiveWebsiteId } from "@/lib/website-scope";
import {
  WidgetStudio,
  type Agent,
  type WidgetSettings,
  type AgentDefaults,
} from "@/components/widget-studio";

export const dynamic = "force-dynamic";

const FALLBACK_DEFAULTS: AgentDefaults = {
  model: "openai/gpt-4o",
  temperature: 0.2,
  confidenceThreshold: 0.7,
};

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    return await api.get<T>(path);
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function WidgetStudioPage() {
  const websiteId = await getActiveWebsiteId();
  const widgetUrl = process.env.NEXT_PUBLIC_WIDGET_URL ?? "http://localhost:3001";

  if (!websiteId) {
    return (
      <div className="container-page py-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Widget studio</h1>
        <div className="mt-6 rounded-xl border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-muted-foreground">
          Each website has its own widget. Pick a website in the sidebar switcher
          to configure it.
        </div>
      </div>
    );
  }

  const agents = await safeGet<Agent[]>(`/agents?websiteId=${websiteId}`);
  const agent = agents?.[0] ?? null;
  const [settings, agentDefaults] = await Promise.all([
    agent ? safeGet<WidgetSettings>(`/widget-settings/${agent._id}`) : Promise.resolve(null),
    safeGet<AgentDefaults>("/agents/defaults"),
  ]);
  return (
    <WidgetStudio
      initialAgent={agent}
      initialSettings={settings}
      widgetUrl={widgetUrl}
      agentDefaults={agentDefaults ?? FALLBACK_DEFAULTS}
    />
  );
}
