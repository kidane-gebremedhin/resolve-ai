// Server entry point for the Websites page. We grab the list + the first agent
// (used to compose the embed snippet) and pass them to the client component
// that handles all CRUD interactions.

import { api, ApiError, API_BASE_URL } from "@/lib/api";
import {
  WebsitesClient,
  type Website,
  type Agent,
} from "@/components/dashboard-pages/websites-client";

export const dynamic = "force-dynamic";

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    return await api.get<T>(path);
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function WebsitesPage() {
  const [websites, agents] = await Promise.all([
    safeGet<Website[]>("/websites"),
    safeGet<Agent[]>("/agents"),
  ]);

  if (!websites) {
    return (
      <div className="container-page py-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Websites</h1>
        <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load websites. Check that the API is reachable and you&apos;re signed in.
        </p>
      </div>
    );
  }

  return (
    <WebsitesClient
      initialWebsites={websites}
      agent={agents?.[0] ?? null}
      apiBaseUrl={API_BASE_URL}
    />
  );
}
