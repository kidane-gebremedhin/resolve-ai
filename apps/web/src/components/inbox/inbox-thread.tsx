"use client";

// Client component for the conversation detail pane. Receives the conversation
// + first page of messages from the server, then:
//   - subscribes to Socket.io and appends new messages for THIS conversation,
//     refreshes the conversation row on `conversation:updated` /
//     `conversation:assigned`
//   - lets the operator type a reply, enhance it with AI (POST /messages/enhance),
//     and send it (POST /messages, role=operator)
//   - exposes header actions: Assign to me, Resolve, Re-open (escalated → active)

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Bot, Send, Sparkles, Undo2, User2, Wrench } from "lucide-react";
import { Button, Textarea } from "@csb/ui";
import { clientApi } from "@/lib/api";
import { getOperatorSocket } from "@/lib/socket";
import { SuggestionsPanel } from "./suggestions-panel";
import type {
  ContactSession,
  Conversation,
  ConversationStatus,
  Message,
  MessageListResponse,
  MessageRole,
} from "./types";

type Props = {
  initialConversation: Conversation;
  initialMessages: Message[];
  contactSession: ContactSession | null;
  // Optional decorations for the side panel that we couldn't fetch server-side
  // (the operator API doesn't expose website or agent lookup endpoints yet —
  // see TODO notes in apps/web/src/app/(dashboard)/app/inbox/[conversationId]/page.tsx).
  websiteLabel?: string;
  agentLabel?: string;
};

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function StatusPill({ status }: { status: ConversationStatus }) {
  const map: Record<ConversationStatus, string> = {
    active: "bg-primary/10 text-primary",
    escalated: "bg-warning/15 text-foreground",
    resolved: "bg-success/10 text-success",
    expired: "bg-muted text-muted-foreground",
  };
  const label: Record<ConversationStatus, string> = {
    active: "Open",
    escalated: "Escalated",
    resolved: "Resolved",
    expired: "Expired",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${map[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {label[status]}
    </span>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const role: MessageRole = message.role;
  const isAi = role === "ai";
  const isOp = role === "operator";
  const isSystem = role === "system";

  const Avatar =
    isAi ? Bot : isSystem ? Wrench : User2;
  const avatarClass =
    isAi
      ? "bg-foreground text-background"
      : isOp
        ? "bg-primary text-primary-foreground"
        : isSystem
          ? "bg-muted text-muted-foreground"
          : "bg-muted";

  const roleLabel =
    role === "customer" ? "Customer" : role === "ai" ? "AI" : role === "operator" ? "You" : "System";

  return (
    <div className="flex gap-3">
      <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${avatarClass}`}>
        <Avatar className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{roleLabel}</span>
          {isAi && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              AI
            </span>
          )}
          {isAi && typeof message.confidence === "number" && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              confidence {Math.round(message.confidence * 100)}%
            </span>
          )}
          {isOp && message.isEnhanced && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              enhanced
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">{timeAgo(message.createdAt)}</span>
        </div>
        <div className="mt-1.5 whitespace-pre-wrap rounded-xl border border-border bg-card p-3.5 text-sm leading-relaxed">
          {message.content}
        </div>
      </div>
    </div>
  );
}

export function InboxThread({
  initialConversation,
  initialMessages,
  contactSession,
  websiteLabel,
  agentLabel,
}: Props) {
  const { data: session } = useSession();
  const [conversation, setConversation] = useState<Conversation>(initialConversation);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [originalDraft, setOriginalDraft] = useState<string | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [sending, setSending] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll on new messages.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Refetch a single message by id. Used after we get `message:new` for this
  // conversation. We could instead refetch the entire message list, but
  // fetching incrementally avoids flicker for long threads.
  const refetchAllMessages = useCallback(async () => {
    try {
      const res = await clientApi.get<MessageListResponse>(
        `/conversations/${conversation._id}/messages?limit=50`,
      );
      setMessages(res.items);
    } catch {
      // ignore
    }
  }, [conversation._id]);

  const refetchConversation = useCallback(async () => {
    try {
      const updated = await clientApi.get<Conversation>(`/conversations/${conversation._id}`);
      setConversation(updated);
    } catch {
      // ignore
    }
  }, [conversation._id]);

  // Subscribe to socket events for this conversation.
  useEffect(() => {
    let socket: ReturnType<typeof getOperatorSocket> | null = null;
    let cancelled = false;

    const handleNew = (payload: { conversationId: string; messageId: string }) => {
      if (payload.conversationId !== conversation._id) return;
      // We don't have a single-message endpoint, so refetch the page. Cheap
      // enough for the common case (operator viewing one thread).
      refetchAllMessages();
    };
    const handleUpdated = (payload: { conversationId: string; status: string }) => {
      if (payload.conversationId !== conversation._id) return;
      setConversation((prev) => ({ ...prev, status: payload.status as ConversationStatus }));
    };
    const handleAssigned = (payload: { conversationId: string; operatorId: string | null }) => {
      if (payload.conversationId !== conversation._id) return;
      setConversation((prev) => ({ ...prev, assignedOperatorId: payload.operatorId }));
    };

    (async () => {
      const tokenRes = await fetch("/api/session-token", { cache: "no-store" });
      const { accessToken } = (await tokenRes.json()) as { accessToken?: string };
      if (cancelled || !accessToken) return;
      socket = getOperatorSocket(accessToken);
      socket.on("message:new", handleNew);
      socket.on("conversation:updated", handleUpdated);
      socket.on("conversation:assigned", handleAssigned);
    })();

    return () => {
      cancelled = true;
      if (socket) {
        socket.off("message:new", handleNew);
        socket.off("conversation:updated", handleUpdated);
        socket.off("conversation:assigned", handleAssigned);
      }
    };
  }, [conversation._id, refetchAllMessages]);

  const handleEnhance = useCallback(async () => {
    if (!draft.trim() || enhancing) return;
    setEnhancing(true);
    setError(null);
    const before = draft;
    try {
      const res = await clientApi.post<{ enhanced: string; original: string }>(
        "/messages/enhance",
        { draft, conversationId: conversation._id },
      );
      setOriginalDraft(before);
      setDraft(res.enhanced);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enhance draft.");
    } finally {
      setEnhancing(false);
    }
  }, [draft, enhancing, conversation._id]);

  const handleRevert = useCallback(() => {
    if (originalDraft === null) return;
    setDraft(originalDraft);
    setOriginalDraft(null);
  }, [originalDraft]);

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    const wasEnhanced = originalDraft !== null;
    try {
      const created = await clientApi.post<Message>("/messages", {
        conversationId: conversation._id,
        content,
        role: "operator",
        isEnhanced: wasEnhanced || undefined,
        originalContent: wasEnhanced ? originalDraft ?? undefined : undefined,
      });
      // Optimistically append; the socket event will also fire and trigger a
      // full refetch, which is idempotent.
      setMessages((prev) =>
        prev.some((m) => m._id === created._id) ? prev : [...prev, created],
      );
      setDraft("");
      setOriginalDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  }, [draft, sending, originalDraft, conversation._id]);

  const handleAssignToMe = useCallback(async () => {
    if (!session?.user?.id) return;
    setUpdatingStatus(true);
    setError(null);
    try {
      const updated = await clientApi.patch<Conversation>(
        `/conversations/${conversation._id}/assign`,
        { operatorId: session.user.id },
      );
      setConversation(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to assign.");
    } finally {
      setUpdatingStatus(false);
    }
  }, [conversation._id, session?.user?.id]);

  const updateStatus = useCallback(
    async (status: ConversationStatus) => {
      setUpdatingStatus(true);
      setError(null);
      try {
        const updated = await clientApi.patch<Conversation>(
          `/conversations/${conversation._id}`,
          { status },
        );
        setConversation(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update status.");
      } finally {
        setUpdatingStatus(false);
      }
    },
    [conversation._id],
  );

  const isAssignedToMe =
    !!session?.user?.id && conversation.assignedOperatorId === session.user.id;

  return (
    <div className="flex h-full min-w-0 flex-1">
      {/* Main thread column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-6 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-display text-base font-semibold">
                {contactSession?.ipAddress ?? conversation.subject ?? contactSession?.name ?? `Visitor #${conversation.contactSessionId.slice(-6)}`}
              </h2>
              <StatusPill status={conversation.status} />
              {conversation.assignedOperatorId && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {isAssignedToMe ? "Assigned to you" : "Assigned"}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {conversation.lastMessagePreview ?? "Live conversation"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleAssignToMe}
              disabled={updatingStatus || isAssignedToMe || !session?.user?.id}
            >
              {isAssignedToMe ? "Assigned" : "Assign to me"}
            </Button>
            {conversation.status === "escalated" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => updateStatus("active")}
                disabled={updatingStatus}
              >
                Re-open
              </Button>
            )}
            {conversation.status === "resolved" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => updateStatus("active")}
                disabled={updatingStatus}
              >
                Re-open
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => updateStatus("resolved")}
                disabled={updatingStatus}
              >
                Mark resolved
              </Button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollerRef} className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
          {messages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface/60 p-6 text-center text-sm text-muted-foreground">
              No messages yet.
            </div>
          ) : (
            messages.map((m) => <MessageBubble key={m._id} message={m} />)
          )}
        </div>

        {error && (
          <div className="mx-4 mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Composer */}
        <div className="border-t border-border bg-background p-4">
          <div className="rounded-xl border border-border bg-card">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a reply to the customer…"
              className="min-h-[88px] w-full resize-none rounded-t-xl border-0 bg-transparent p-3 text-sm focus-visible:ring-0"
              rows={4}
            />
            <div className="flex items-center justify-between border-t border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleEnhance}
                  disabled={enhancing || !draft.trim()}
                  className="gap-1.5"
                >
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  {enhancing ? "Enhancing…" : "Enhance"}
                </Button>
                {originalDraft !== null && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleRevert}
                    className="gap-1.5 text-muted-foreground"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Revert
                  </Button>
                )}
              </div>
              <Button
                size="sm"
                onClick={handleSend}
                disabled={sending || !draft.trim()}
                className="gap-1.5"
              >
                <Send className="h-3.5 w-3.5" />
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Right side panel */}
      <aside className="hidden w-[300px] shrink-0 flex-col border-l border-border bg-background lg:flex">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-muted text-sm font-semibold">
              <User2 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-display text-sm font-semibold">
                {contactSession?.ipAddress ?? contactSession?.name ?? `Visitor #${conversation.contactSessionId.slice(-6)}`}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {contactSession?.email ?? contactSession?.phone ?? "no contact info"}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <Section title="Conversation">
            <KV k="Status" v={conversation.status} />
            <KV k="Messages" v={String(conversation.messageCount ?? messages.length)} />
            <KV k="Thread" v={conversation.threadId} />
            <KV k="Started" v={timeAgo(conversation.createdAt)} />
          </Section>

          <Section title="Contact">
            <KV k="Email" v={contactSession?.email ?? "—"} />
            <KV k="Phone" v={contactSession?.phone ?? "—"} />
            <KV k="IP address" v={contactSession?.ipAddress ?? "—"} />
            <KV k="Session" v={`#${conversation.contactSessionId.slice(-8)}`} />
          </Section>

          <Section title="Routing">
            <KV k="Website" v={websiteLabel ?? conversation.websiteId.slice(-8)} />
            <KV k="Agent" v={agentLabel ?? conversation.agentId.slice(-8)} />
            <KV
              k="Assigned"
              v={
                conversation.assignedOperatorId
                  ? isAssignedToMe
                    ? "You"
                    : `#${conversation.assignedOperatorId.slice(-6)}`
                  : "Unassigned"
              }
            />
          </Section>

          <SuggestionsPanel conversationId={conversation._id} />
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-surface/60 px-2.5 py-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</span>
      <span className="truncate text-xs font-medium">{v}</span>
    </div>
  );
}
