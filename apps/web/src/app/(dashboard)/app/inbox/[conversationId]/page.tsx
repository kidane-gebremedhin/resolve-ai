// Server component for /app/inbox/[conversationId]. Fetches the conversation
// metadata + first page of messages + (best-effort) the contact session for
// the side panel, then composes the same two-pane layout from <InboxList> so
// the list pane stays visible while the operator drills into one thread.

import { notFound } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { InboxList } from "@/components/inbox/inbox-list";
import { InboxThread } from "@/components/inbox/inbox-thread";
import type {
  ContactSession,
  Conversation,
  ConversationListResponse,
  InboxFilter,
  Message,
  MessageListResponse,
} from "@/components/inbox/types";

type Search = { [key: string]: string | string[] | undefined };

function readFilter(sp: Search): InboxFilter {
  const raw = sp.status;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "active" || v === "escalated" || v === "resolved") return v;
  return "all";
}

export default async function ConversationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<Search>;
}) {
  const [{ conversationId }, sp] = await Promise.all([params, searchParams]);
  const filter = readFilter(sp);

  const listQs = new URLSearchParams({ limit: "50" });
  if (filter !== "all") listQs.set("status", filter);

  let conversation: Conversation | null = null;
  let messages: Message[] = [];
  let conversations: Conversation[] = [];
  let listNextCursor: string | null = null;
  let contactSession: ContactSession | null = null;
  let errorMessage: string | null = null;

  try {
    const [convo, msgs, list] = await Promise.all([
      api.get<Conversation>(`/conversations/${conversationId}`),
      api.get<MessageListResponse>(`/conversations/${conversationId}/messages?limit=50`),
      api.get<ConversationListResponse>(`/conversations?${listQs.toString()}`),
    ]);
    conversation = convo;
    messages = msgs.items ?? [];
    conversations = list.items ?? [];
    listNextCursor = list.nextCursor ?? null;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    errorMessage =
      e instanceof ApiError
        ? `${e.code}: ${e.message}`
        : e instanceof Error
          ? e.message
          : "Failed to load conversation.";
  }

  if (errorMessage || !conversation) {
    return (
      <div className="container-page py-8">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {errorMessage ?? "Conversation not found."}
        </div>
      </div>
    );
  }

  // Best-effort contact lookup. The endpoint is org-scoped so this 404s
  // benignly if the session has been purged — we just hide the contact card.
  // TODO: a dedicated GET /conversations/:id/contact would let us avoid the
  // extra round-trip.
  try {
    contactSession = await api.get<ContactSession>(`/contacts/${conversation.contactSessionId}`);
  } catch {
    contactSession = null;
  }

  return (
    <InboxList initialItems={conversations} initialFilter={filter} initialNextCursor={listNextCursor}>
      <InboxThread
        initialConversation={conversation}
        initialMessages={messages}
        contactSession={contactSession}
      />
    </InboxList>
  );
}
