// Server component: fetches a single KnowledgeSource by ID and hands off to
// the client editor. 404s from the API surface as a Next.js notFound() so
// the user lands on the standard not-found UI.

import { notFound } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { KnowledgeDetail } from "@/components/knowledge/knowledge-detail";
import type { KnowledgeSource } from "@/components/knowledge/types";

export const dynamic = "force-dynamic";

export default async function KnowledgeSourcePage({
  params,
}: {
  params: Promise<{ sourceId: string }>;
}) {
  const { sourceId } = await params;

  try {
    const source = await api.get<KnowledgeSource>(`/knowledge/${sourceId}`);
    return <KnowledgeDetail source={source} />;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    const message = err instanceof ApiError ? err.message : "Failed to load knowledge source.";
    return (
      <div className="container-page py-8">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Source unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }
}
