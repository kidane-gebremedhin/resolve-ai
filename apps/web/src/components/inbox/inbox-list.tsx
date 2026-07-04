"use client";

// Client component that owns the operator inbox list pane. Receives the
// initial server-rendered page of conversations, then keeps itself in sync via:
//   - Socket.io (`message:new`, `conversation:updated`, `conversation:assigned`)
//   - Filter pill clicks (updates ?status= via router.replace)
// It renders into a two-pane layout; the right pane is either an empty state
// or the children prop (which on the detail route is the <InboxThread>).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { Filter, MessageCircle } from "lucide-react";
import { clientApi } from "@/lib/api";
import { getOperatorSocket } from "@/lib/socket";
import type {
  Conversation,
  ConversationListResponse,
  ConversationStatus,
  InboxFilter,
} from "./types";

type Props = {
  initialItems: Conversation[];
  initialFilter: InboxFilter;
  /** Active website scope (null = All websites). Set via the sidebar switcher. */
  websiteId?: string | null;
  children?: React.ReactNode;
};

const FILTER_PILLS: { key: InboxFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Open" },
  { key: "escalated", label: "Escalated" },
  { key: "resolved", label: "Resolved" },
];

function statusToFilterValue(s: InboxFilter): string | null {
  return s === "all" ? null : s;
}

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function contactLabel(c: Conversation): string {
  // Identify the visitor by IP address. Fall back to the conversation subject,
  // then a short session id only if no IP was captured.
  if (c.ipAddress) return c.ipAddress;
  if (c.subject && c.subject.trim().length > 0) return c.subject;
  const tail = c.contactSessionId?.slice?.(-6) ?? "anon";
  return `Visitor #${tail}`;
}

export function InboxList({ initialItems, initialFilter, websiteId = null, children }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ conversationId?: string }>();
  const activeId = params?.conversationId;

  const [items, setItems] = useState<Conversation[]>(initialItems);
  const [filter, setFilter] = useState<InboxFilter>(initialFilter);

  // Keep up-to-date refs so the socket callback can refetch with the current
  // filter + website scope without re-binding the socket listener every render.
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const websiteIdRef = useRef(websiteId);
  websiteIdRef.current = websiteId;

  const refetch = useCallback(async () => {
    const status = statusToFilterValue(filterRef.current);
    const qs = new URLSearchParams({ limit: "50" });
    if (status) qs.set("status", status);
    if (websiteIdRef.current) qs.set("websiteId", websiteIdRef.current);
    try {
      const res = await clientApi.get<ConversationListResponse>(
        `/conversations?${qs.toString()}`,
      );
      setItems(res.items);
    } catch {
      // Silent — list will refresh on the next event.
    }
  }, []);

  // When the user clicks a filter pill, reflect it in the URL and refetch.
  useEffect(() => {
    const status = statusToFilterValue(filter);
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    if (status) next.set("status", status);
    else next.delete("status");
    const query = next.toString();
    const base = activeId ? `/app/inbox/${activeId}` : "/app/inbox";
    router.replace(query ? `${base}?${query}` : base);
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Re-scope when the operator switches website in the sidebar. Skip the first
  // render — `initialItems` is already scoped server-side for the first paint.
  const scopeMounted = useRef(false);
  useEffect(() => {
    if (!scopeMounted.current) {
      scopeMounted.current = true;
      return;
    }
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websiteId]);

  // Subscribe to the operator socket on mount.
  useEffect(() => {
    let socket: ReturnType<typeof getOperatorSocket> | null = null;
    let cancelled = false;

    const handleNew = () => refetch();
    const handleUpdated = () => refetch();
    const handleAssigned = () => refetch();

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
  }, [refetch]);

  const filtered = useMemo(() => items, [items]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-w-0 overflow-x-hidden">
      <section className="hidden md:flex md:w-[340px] md:shrink-0 flex-col border-r border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">Inbox</h2>
            <button
              type="button"
              className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground"
              aria-label="Filter"
            >
              <Filter className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-3 flex gap-1">
            {FILTER_PILLS.map((p) => (
              <button
                key={p.key}
                onClick={() => setFilter(p.key)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                  filter === p.key
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              No conversations match this filter yet.
            </div>
          ) : (
            filtered.map((c) => (
              <ConversationRow
                key={c._id}
                conversation={c}
                isActive={c._id === activeId}
                searchParams={searchParams?.toString() ?? ""}
              />
            ))
          )}
        </div>
      </section>

      {/* Right pane: either the thread (when a conversationId route is mounted)
          or an empty state. */}
      <section className="flex min-w-0 flex-1 flex-col bg-background">
        {children ?? <EmptyState />}
      </section>
    </div>
  );
}

function ConversationRow({
  conversation,
  isActive,
  searchParams,
}: {
  conversation: Conversation;
  isActive: boolean;
  searchParams: string;
}) {
  const label = contactLabel(conversation);
  const initials = label
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "?";
  const href = searchParams
    ? `/app/inbox/${conversation._id}?${searchParams}`
    : `/app/inbox/${conversation._id}`;

  return (
    <Link
      href={href}
      className={`flex w-full gap-3 border-b border-border px-4 py-3 text-left transition ${
        isActive ? "bg-surface" : "hover:bg-surface/60"
      }`}
    >
      <div className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{label}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {timeAgo(conversation.lastMessageAt ?? conversation.updatedAt)}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted-foreground">
          {conversation.lastMessagePreview ?? "(no messages yet)"}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <StatusDot status={conversation.status} />
        </div>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
      <MessageCircle className="h-6 w-6" />
      <div className="text-sm">Pick a conversation on the left to get started.</div>
    </div>
  );
}

function StatusDot({ status }: { status: ConversationStatus }) {
  const color: Record<ConversationStatus, string> = {
    active: "bg-primary",
    escalated: "bg-warning",
    resolved: "bg-success",
    expired: "bg-muted-foreground",
  };
  const label: Record<ConversationStatus, string> = {
    active: "Open",
    escalated: "Escalated",
    resolved: "Resolved",
    expired: "Expired",
  };
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${color[status]}`} />
      {label[status]}
    </span>
  );
}
