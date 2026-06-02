// Server component: fetches the first page of conversations from the Express
// API using the NextAuth session-bound `api` client, then hands them to the
// <InboxList> client component which handles filters + Socket.io live updates.

import { api, ApiError } from "@/lib/api";
import { getActiveWebsiteId } from "@/lib/website-scope";
import { InboxList } from "@/components/inbox/inbox-list";
import type {
  Conversation,
  ConversationListResponse,
  InboxFilter,
} from "@/components/inbox/types";

type Search = { [key: string]: string | string[] | undefined };

function readFilter(sp: Search): InboxFilter {
  const raw = sp.status;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "active" || v === "escalated" || v === "resolved") return v;
  return "all";
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const filter = readFilter(sp);
  const websiteId = await getActiveWebsiteId();

  const qs = new URLSearchParams({ limit: "50" });
  if (filter !== "all") qs.set("status", filter);
  if (websiteId) qs.set("websiteId", websiteId);

  let items: Conversation[] = [];
  let errorMessage: string | null = null;
  try {
    const res = await api.get<ConversationListResponse>(`/conversations?${qs.toString()}`);
    items = res.items ?? [];
  } catch (e) {
    errorMessage =
      e instanceof ApiError
        ? `${e.code}: ${e.message}`
        : e instanceof Error
          ? e.message
          : "Failed to load conversations.";
  }

  if (errorMessage) {
    return (
      <div className="container-page py-8">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {errorMessage}
        </div>
      </div>
    );
  }

  return <InboxList initialItems={items} initialFilter={filter} websiteId={websiteId} />;
}
