// Developers page — embed snippets for installing the widget on customer
// sites. Scoped to the active website (sidebar switcher): it grabs that
// website's agent and the agent's saved WidgetSettings (position, primary
// color, theme) so the generated snippet mirrors /app/widget for the same
// website. The tabbed UI with copy-to-clipboard is the colocated client
// component.

import { api, ApiError } from "@/lib/api";
import { WIDGET_URL, EMBED_URL } from "@/lib/app-urls";
import { getActiveWebsiteId } from "@/lib/website-scope";
import { DevelopersClient, type EmbedConfig } from "./developers-client";

export const dynamic = "force-dynamic";

type Agent = {
  _id: string;
  name?: string;
};

// The cosmetic fields the embed loader honors as data-* attributes, read from
// the agent's saved WidgetSettings so the snippet mirrors the Widget Studio.
type WidgetSettings = {
  primaryColor?: string;
  position?: "bottom-right" | "bottom-left" | "centered";
  theme?: "light" | "dark" | "auto";
};

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    return await api.get<T>(path);
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function DevelopersPage() {
  // The embed snippet is per-agent, and an agent maps to one website — so the
  // snippet is per-website. Require a website selection (like Widget Studio)
  // rather than guessing across the org.
  const websiteId = await getActiveWebsiteId();
  if (!websiteId) {
    return (
      <div className="container-page py-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Developers</h1>
        <div className="mt-6 rounded-xl border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-muted-foreground">
          Each website has its own embed snippet. Pick a website in the sidebar
          switcher to get its install code.
        </div>
      </div>
    );
  }

  const agents = await safeGet<Agent[]>(`/agents?websiteId=${websiteId}`);
  const agent = agents?.[0] ?? null;
  const settings = agent
    ? await safeGet<WidgetSettings>(`/widget-settings/${agent._id}`)
    : null;

  const embedUrl =
    EMBED_URL;
  const widgetUrl = WIDGET_URL;

  const config: EmbedConfig = {
    agentId: agent?._id ?? "YOUR_AGENT_ID",
    embedUrl,
    widgetUrl,
    position: settings?.position,
    primaryColor: settings?.primaryColor,
    theme: settings?.theme,
  };

  return <DevelopersClient config={config} />;
}
