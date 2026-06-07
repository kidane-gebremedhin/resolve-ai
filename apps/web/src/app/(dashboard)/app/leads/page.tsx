// Server entry point. Fetches a page of contact sessions ("leads") with the
// org's saved page size, server-side search/date/has filters, and scope stats,
// plus the org's websites for domain display. The sidebar website filter is
// merged into the query; all other list state lives in the URL.

import { api, ApiError } from "@/lib/api";
import { getActiveWebsiteId } from "@/lib/website-scope";
import { buildListQuery } from "@/lib/list-params";
import { LeadsView, type LeadsEnvelope, type Website } from "@/components/dashboard-pages/leads-client";

export const dynamic = "force-dynamic";

const KEYS = ["q", "from", "to", "has", "page", "pageSize"] as const;

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    return await api.get<T>(path);
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const websiteId = await getActiveWebsiteId(); // sidebar website scope (cookie)
  const qs = buildListQuery(sp, KEYS);
  const params = new URLSearchParams(qs);
  if (websiteId) params.set("websiteId", websiteId);
  const query = params.toString();

  const [envelope, websites] = await Promise.all([
    safeGet<LeadsEnvelope>(`/contacts${query ? `?${query}` : ""}`),
    safeGet<Website[]>("/websites"),
  ]);

  if (!envelope) {
    return (
      <div className="container-page py-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Leads</h1>
        <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load leads. Check that the API is reachable and you&apos;re signed in.
        </p>
      </div>
    );
  }

  return <LeadsView envelope={envelope} websites={websites ?? []} websiteId={websiteId ?? undefined} />;
}
