// Server entry point. Fetches contact sessions (the underlying record for "leads")
// and the org's websites for domain-lookup display, then hands off to the client
// component which does the filtering/search/export interactions.

import { api, ApiError } from "@/lib/api";
import { getActiveWebsiteId } from "@/lib/website-scope";
import { LeadsClient, type Lead, type Website } from "@/components/dashboard-pages/leads-client";

export const dynamic = "force-dynamic";

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    return await api.get<T>(path);
  } catch (err) {
    if (err instanceof ApiError) {
      // Surface API errors as empty results so the page can still render shell + message.
      return null;
    }
    throw err;
  }
}

export default async function LeadsPage() {
  // Leads (contact sessions) carry a websiteId; obey the sidebar website filter.
  const websiteId = await getActiveWebsiteId();
  const contactsPath = websiteId ? `/contacts?websiteId=${websiteId}` : "/contacts";
  const [leads, websites] = await Promise.all([
    safeGet<Lead[]>(contactsPath),
    safeGet<Website[]>("/websites"),
  ]);

  if (!leads) {
    return (
      <div className="container-page py-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Leads</h1>
        <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load leads. Check that the API is reachable and you&apos;re signed in.
        </p>
      </div>
    );
  }

  return <LeadsClient initialLeads={leads} websites={websites ?? []} />;
}
