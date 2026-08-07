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
import { Bot, ChevronDown, ChevronRight, Download, FileText, Paperclip, Send, Sparkles, Undo2, User2, Wrench, X } from "lucide-react";
import { Button, Textarea } from "@csb/ui";
import { clientApi, API_BASE_URL } from "@/lib/api";
import { useCan } from "@/hooks/use-permissions";
import { ReadOnlyNotice } from "@/components/layouts/read-only-notice";
import { getOperatorSocket } from "@/lib/socket";
import { SuggestionsPanel } from "./suggestions-panel";
import type {
  Attachment,
  ContactSession,
  Conversation,
  ConversationStatus,
  Message,
  MessageListResponse,
  MessageRole,
} from "./types";

// Attachments are served through the same-origin proxy
// (apps/web/.../api/attachments/[hash]), which forwards to the API with the
// operator bearer token — so an <img>/link works without leaking the token in a
// URL. We pull the content hash out of whatever URL the API stored (widget- or
// operator-uploaded share the same content-addressed key) and route it there.
const SHA_RE = /([a-f0-9]{64})/i;
function attachmentHref(a: Attachment): string | undefined {
  const raw = a.url ?? a.fileUrl;
  const sha = raw?.match(SHA_RE)?.[1];
  return sha ? `/api/attachments/${sha}` : raw;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)(\?|#|$)/i;
function isImageAttachment(a: Attachment): boolean {
  if ((a.mimeType ?? "").startsWith("image/")) return true;
  return IMAGE_EXT_RE.test(a.fileName ?? "") || IMAGE_EXT_RE.test(a.fileUrl ?? a.url ?? "");
}

function formatBytes(n?: number): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2.5">
      {attachments.map((a, i) => {
        const href = attachmentHref(a);
        if (!href) return null;
        const label = a.fileName ?? "Attachment";
        if (isImageAttachment(a)) {
          return (
            <li key={i}>
              <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={href}
                  alt={label}
                  className="max-h-48 max-w-full rounded-lg border border-border object-cover"
                  loading="lazy"
                />
              </a>
            </li>
          );
        }
        return (
          <li key={i}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface/60 px-2.5 py-1.5 text-xs no-underline transition hover:bg-surface"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="min-w-0 max-w-[200px] truncate font-medium">{label}</span>
              {a.size ? <span className="shrink-0 opacity-60">{formatBytes(a.size)}</span> : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

type AuditLog = {
  _id: string;
  toolKey: string;
  status: "success" | "guardrail_blocked" | "error" | "otp_pending";
  argsMasked?: Record<string, unknown>;
  resultSummary?: string;
  errorMessage?: string;
  durationMs: number;
  createdAt: string;
};

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

// Built-in reasoning tools are conversation plumbing, not operator-facing actions.
const NOISE_TOOLS = new Set(["search_kb", "escalate_conversation", "resolve_conversation"]);

// Turn a raw tool call into a short human sentence for the inbox strip, e.g.
// "AI booked a meeting for Mon, Jul 6, 3:00 PM" or "AI created support ticket SUP-12".
// toolCalls store `result` as a JSON string (see agent.service.ts) and `args` as
// an object. Normalise both to plain objects for formatting.
function asObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function describeToolCall(call: { name: string; args?: unknown; result?: unknown }): string | null {
  if (NOISE_TOOLS.has(call.name)) return null;
  const result = asObject(call.result);
  const args = asObject(call.args);
  const fmtTime = (v: unknown): string | null => {
    if (!v || typeof v !== "string") return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime())
      ? null
      : d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };
  switch (call.name) {
    case "book_meeting": {
      const when = fmtTime(result.start) ?? fmtTime(args.startTime);
      return when ? `booked a meeting for ${when}` : "booked a meeting";
    }
    case "list_event_types":
      return "looked up available meeting types";
    case "list_calendar_slots":
      return "checked calendar availability";
    case "create_support_ticket": {
      const key = result.key ?? result.issueIdentifier ?? result.id;
      return key ? `created support ticket ${key}` : "created a support ticket";
    }
    case "issue_refund": {
      const amt = args.amount ?? args.refundAmount;
      return amt ? `issued a refund of $${amt}` : "issued a refund";
    }
    case "get_subscription":
      return "looked up the customer's subscription";
    case "upgrade_subscription": {
      const plan = result.plan ?? args.targetPlan ?? args.targetPlanKey;
      return `upgraded the subscription${plan ? ` to ${plan}` : ""}`;
    }
    case "downgrade_subscription": {
      const plan = result.plan ?? args.targetPlan ?? args.targetPlanKey;
      return `downgraded the subscription${plan ? ` to ${plan}` : ""}`;
    }
    case "cancel_subscription":
      return "cancelled the subscription";
    case "lookup_order": {
      const order = args.orderId ?? args.orderNumber ?? result.orderId;
      return order ? `looked up order ${order}` : "looked up an order";
    }
    default:
      return `ran ${call.name.replace(/_/g, " ")}`;
  }
}

// Inline strip under an AI message summarising any external tool actions it took.
function ToolCallStrip({ calls }: { calls: { name: string; args?: unknown; result?: unknown }[] }) {
  const lines = calls
    .map((c) => ({ text: describeToolCall(c), failed: isFailedResult(c.result) }))
    .filter((l): l is { text: string; failed: boolean } => Boolean(l.text));
  if (lines.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {lines.map((l, i) => (
        <div
          key={i}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] ${
            l.failed
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-border bg-muted/40 text-muted-foreground"
          }`}
        >
          <Wrench className="h-3 w-3 shrink-0" />
          <span>
            {l.failed ? "AI tried to " : "AI "}
            {l.text}
            {l.failed ? " — it didn't go through" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function isFailedResult(result: unknown): boolean {
  const r = asObject(result);
  return Boolean(r.error) || r.ok === false || Boolean(r.blocked) || Boolean(r.otpRequired);
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
          {message.attachments && message.attachments.length > 0 && (
            <AttachmentList attachments={message.attachments} />
          )}
        </div>
        {isAi && message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallStrip calls={message.toolCalls} />
        )}
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
  const canReply = useCan("handleConversations");
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[] | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const [customerTyping, setCustomerTyping] = useState(false);
  const customerTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<ReturnType<typeof getOperatorSocket> | null>(null);
  const operatorTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

    const handleCustomerTyping = (payload: { conversationId: string; isTyping: boolean }) => {
      if (payload.conversationId !== conversation._id) return;
      if (customerTypingTimerRef.current) clearTimeout(customerTypingTimerRef.current);
      if (payload.isTyping) {
        setCustomerTyping(true);
        customerTypingTimerRef.current = setTimeout(() => setCustomerTyping(false), 5_000);
      } else {
        setCustomerTyping(false);
      }
    };

    (async () => {
      const tokenRes = await fetch("/api/session-token", { cache: "no-store" });
      const { accessToken } = (await tokenRes.json()) as { accessToken?: string };
      if (cancelled || !accessToken) return;
      socket = getOperatorSocket(accessToken);
      socketRef.current = socket;
      socket.on("message:new", handleNew);
      socket.on("conversation:updated", handleUpdated);
      socket.on("conversation:assigned", handleAssigned);
      socket.on("customer:typing", handleCustomerTyping);
    })();

    return () => {
      cancelled = true;
      socketRef.current = null;
      if (socket) {
        socket.off("message:new", handleNew);
        socket.off("conversation:updated", handleUpdated);
        socket.off("conversation:assigned", handleAssigned);
        socket.off("customer:typing", handleCustomerTyping);
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

  // Upload picked files to the operator attachment endpoint (multipart — so it
  // bypasses the JSON clientApi) and stash them as pending until the operator
  // sends. The send call then persists them on the message.
  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      setError(null);
      try {
        const tokenRes = await fetch("/api/session-token", { cache: "no-store" });
        const { accessToken } = (await tokenRes.json()) as { accessToken?: string };
        const uploaded: Attachment[] = [];
        for (const file of Array.from(files)) {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("conversationId", conversation._id);
          const res = await fetch(`${API_BASE_URL}/messages/attachments`, {
            method: "POST",
            headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
            body: fd,
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as
              | { error?: { message?: string } }
              | null;
            throw new Error(body?.error?.message ?? `Upload failed (${res.status}).`);
          }
          const { attachment } = (await res.json()) as { attachment: Attachment };
          uploaded.push(attachment);
        }
        setPending((prev) => [...prev, ...uploaded]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to upload attachment.");
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [conversation._id],
  );

  const handleSend = useCallback(async () => {
    const content = draft.trim();
    if ((!content && pending.length === 0) || sending) return;
    setSending(true);
    setError(null);
    const wasEnhanced = originalDraft !== null;
    try {
      const created = await clientApi.post<Message>("/messages", {
        conversationId: conversation._id,
        content,
        role: "operator",
        attachments: pending.length ? pending : undefined,
        isEnhanced: wasEnhanced || undefined,
        originalContent: wasEnhanced ? originalDraft ?? undefined : undefined,
      });
      // Optimistically append; the socket event will also fire and trigger a
      // full refetch, which is idempotent.
      setMessages((prev) =>
        prev.some((m) => m._id === created._id) ? prev : [...prev, created],
      );
      setDraft("");
      setPending([]);
      setOriginalDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  }, [draft, pending, sending, originalDraft, conversation._id]);

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

  const loadAuditTrail = useCallback(async () => {
    if (loadingAudit) return;
    setLoadingAudit(true);
    try {
      const data = await clientApi.get<{ logs: AuditLog[] }>(
        `/conversations/${conversation._id}/audit-trail`,
      );
      setAuditLogs(data.logs);
    } catch {
      setAuditLogs([]);
    } finally {
      setLoadingAudit(false);
    }
  }, [conversation._id, loadingAudit]);

  const handleAuditToggle = useCallback(() => {
    const next = !auditOpen;
    setAuditOpen(next);
    if (next && auditLogs === null) void loadAuditTrail();
  }, [auditOpen, auditLogs, loadAuditTrail]);

  const handleExport = useCallback(
    async (format: "csv" | "json") => {
      setExporting(true);
      setError(null);
      try {
        const tokenRes = await fetch("/api/session-token", { cache: "no-store" });
        const { accessToken } = (await tokenRes.json()) as { accessToken?: string };
        const res = await fetch(
          `${API_BASE_URL}/conversations/${conversation._id}/export`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify({ format }),
          },
        );
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("json")) {
          const data = (await res.json()) as { url?: string };
          if (data.url) window.open(data.url, "_blank");
        } else {
          // Inline binary stream — create a temporary download link.
          const blob = await res.blob();
          const ext = format === "csv" ? "csv" : "json";
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `transcript-${conversation._id}.${ext}`;
          a.click();
          URL.revokeObjectURL(a.href);
        }
      } catch {
        setError("Export failed. Please try again.");
      } finally {
        setExporting(false);
      }
    },
    [conversation._id],
  );

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
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-6">
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
            <div className="relative group">
              <Button
                size="sm"
                variant="outline"
                disabled={exporting}
                onClick={() => void handleExport("json")}
                className="gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                {exporting ? "Exporting…" : "Export"}
              </Button>
              <div className="absolute right-0 top-full z-10 mt-1 hidden min-w-[120px] overflow-hidden rounded-md border border-border bg-card shadow-md group-focus-within:flex group-hover:flex flex-col">
                <button
                  type="button"
                  onClick={() => void handleExport("json")}
                  className="px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  Export as JSON
                </button>
                <button
                  type="button"
                  onClick={() => void handleExport("csv")}
                  className="px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  Export as CSV
                </button>
              </div>
            </div>
            {/* Assignment and status changes are PATCHes on conversation.routes
                (requireOrgRole("agent")) — export is a GET, so viewers keep it. */}
            {canReply && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleAssignToMe}
              disabled={updatingStatus || isAssignedToMe || !session?.user?.id}
            >
              {isAssignedToMe ? "Assigned" : "Assign to me"}
            </Button>
            )}
            {canReply && conversation.status === "escalated" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => updateStatus("active")}
                disabled={updatingStatus}
              >
                Re-open
              </Button>
            )}
            {canReply &&
              (conversation.status === "resolved" ? (
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
              ))}
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

        {/* Customer typing indicator */}
        {customerTyping && (
          <div className="mx-6 mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-flex gap-0.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
            </span>
            Customer is typing…
          </div>
        )}

        {error && (
          <div className="mx-4 mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Composer — hidden for viewers: message.routes and conversation.routes
            both mount requireOrgRole("agent"), so a viewer's reply would 403. */}
        {!canReply ? (
          <div className="border-t border-border bg-background p-4">
            <ReadOnlyNotice capability="handleConversations" />
          </div>
        ) : (
        <div className="border-t border-border bg-background p-4">
          <div className="rounded-xl border border-border bg-card">
            <Textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (socketRef.current) {
                  socketRef.current.emit("operator:typing", { conversationId: conversation._id, isTyping: true });
                  if (operatorTypingTimerRef.current) clearTimeout(operatorTypingTimerRef.current);
                  operatorTypingTimerRef.current = setTimeout(() => {
                    socketRef.current?.emit("operator:typing", { conversationId: conversation._id, isTyping: false });
                  }, 3_000);
                }
              }}
              placeholder="Write a reply to the customer…"
              className="min-h-[88px] w-full resize-none rounded-t-xl border-0 bg-transparent p-3 text-sm focus-visible:ring-0"
              rows={4}
            />
            {pending.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-border px-3 py-2">
                {pending.map((a, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface/60 px-2 py-1 text-[11px]"
                  >
                    {isImageAttachment(a) ? (
                      <Paperclip className="h-3 w-3 opacity-60" />
                    ) : (
                      <FileText className="h-3 w-3 opacity-60" />
                    )}
                    <span className="max-w-[160px] truncate font-medium">{a.fileName ?? "file"}</span>
                    <button
                      type="button"
                      aria-label="Remove attachment"
                      onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))}
                      className="opacity-60 transition hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between border-t border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,application/pdf,text/plain,text/markdown,text/csv,text/html,.doc,.docx,.xls,.xlsx"
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="gap-1.5"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  {uploading ? "Uploading…" : "Attach"}
                </Button>
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
                disabled={sending || uploading || (!draft.trim() && pending.length === 0)}
                className="gap-1.5"
              >
                <Send className="h-3.5 w-3.5" />
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </div>
        )}
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

          {/* Audit trail — tool calls made by the AI during this conversation */}
          <div>
            <button
              type="button"
              onClick={handleAuditToggle}
              className="flex w-full items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              {auditOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Audit trail
            </button>

            {auditOpen && (
              <div className="mt-2">
                {loadingAudit ? (
                  <div className="py-3 text-center text-xs text-muted-foreground">Loading…</div>
                ) : auditLogs === null || auditLogs.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border py-3 text-center text-xs text-muted-foreground">
                    No tool calls yet.
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {auditLogs.map((log) => (
                      <li
                        key={log._id}
                        className="rounded-md border border-border bg-surface/60 p-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-medium truncate">{log.toolKey}</span>
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              log.status === "success"
                                ? "bg-success/10 text-success"
                                : log.status === "guardrail_blocked"
                                  ? "bg-warning/15 text-foreground"
                                  : "bg-destructive/10 text-destructive"
                            }`}
                          >
                            {log.status.replace("_", " ")}
                          </span>
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {log.durationMs}ms · {new Date(log.createdAt).toLocaleTimeString()}
                        </div>
                        {log.errorMessage && (
                          <div className="mt-1 text-[10px] text-destructive">{log.errorMessage}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
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
