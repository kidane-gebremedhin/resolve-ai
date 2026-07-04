"use client";

// MessageList — renders the chat transcript chronologically (oldest at top).
// Auto-scrolls to bottom whenever new messages land. Role drives the bubble
// styling per spec 09:
//   - customer  → right-aligned, accent (primaryColor) background
//   - ai        → left-aligned, neutral muted background
//   - operator  → left-aligned, primary-tinted background with a small badge
//   - system    → centered, italic, low-contrast (joins/leaves, etc.)

import { useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import type { WidgetMessage } from "../lib/api-client";
import { DocumentIcon } from "./icons";
import { Citations } from "./Citations";
import { FeedbackControls } from "./FeedbackControls";
import { QuickReplies } from "./QuickReplies";
import { BlockRenderer } from "./blocks/BlockRenderer";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// Animated "AI is typing" bubble — three dots with a wave-style scale loop so
// the indicator feels alive (a step up from `animate-bounce`). Styled to match
// an AI message bubble (left-aligned, neutral background).
function TypingIndicator({ "aria-label": ariaLabel = "Assistant is typing" }: { "aria-label"?: string }) {
  return (
    <div className="group flex max-w-full flex-col" aria-live="polite" aria-label={ariaLabel}>
      <div className="csb-typing mr-auto flex items-center gap-1 rounded-2xl bg-neutral-100 px-3.5 py-3 dark:bg-neutral-800">
        <span className="csb-typing-dot block h-1.5 w-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500" />
        <span className="csb-typing-dot block h-1.5 w-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500" />
        <span className="csb-typing-dot block h-1.5 w-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500" />
      </div>
    </div>
  );
}

function formatBytes(n?: number): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Attachment download/preview URLs are API-origin and session-guarded. An <img>
// or link can't send the x-session-token header, so we append it as `?t=`.
// Operator-sent attachments are stored against the operator-only
// `/messages/attachments/<sha>` route; the customer can only authenticate the
// widget route, so we rewrite the path to `/widget/attachments/<sha>` (same
// org-scoped storage key) before appending the session token.
function authedUrl(raw: string | undefined, sessionToken?: string): string | undefined {
  if (!raw) return undefined;
  const widgetUrl = raw.replace("/api/v1/messages/attachments/", "/api/v1/widget/attachments/");
  if (!sessionToken) return widgetUrl;
  return widgetUrl + (widgetUrl.includes("?") ? "&" : "?") + "t=" + encodeURIComponent(sessionToken);
}

// Detect images by MIME type, falling back to the file name/URL extension —
// mimeType can be absent on a re-fetched/socket-delivered message.
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)(\?|#|$)/i;
function isImageAttachment(a: { mimeType?: string; fileName?: string; fileUrl?: string; url?: string }): boolean {
  if ((a.mimeType ?? "").startsWith("image/")) return true;
  return IMAGE_EXT_RE.test(a.fileName ?? "") || IMAGE_EXT_RE.test(a.fileUrl ?? a.url ?? "");
}

export function MessageList({
  messages,
  primaryColor,
  typing = false,
  operatorTyping = false,
  sessionToken,
  conversationId,
  inFlight,
  onSendMessage,
}: {
  messages: WidgetMessage[];
  primaryColor: string;
  /** Show the animated "AI is typing" bubble at the bottom of the transcript. */
  typing?: boolean;
  /** Show the "operator is typing" 3-dot bubble (a human agent, not AI). */
  operatorTyping?: boolean;
  /** Used to authenticate attachment preview/download URLs (?t=). */
  sessionToken?: string;
  /** Conversation id passed to FormBlockRenderer for inline form submissions. */
  conversationId?: string;
  /** Currently streaming message: messageId → accumulated text so far. */
  inFlight?: Map<string, string>;
  /** Send a text message as the customer (used by QuickReplies + CardBlock buttons). */
  onSendMessage?: (text: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const showTypingBubble = typing || operatorTyping;

  // Scroll to bottom by directly setting scrollTop — more reliable than
  // scrollIntoView across browsers and iframe environments.
  const scrollToBottom = useCallback((smooth = true) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "instant" });
  }, []);

  const inFlightSize = inFlight?.size ?? 0;
  useEffect(() => {
    scrollToBottom();
  }, [messages.length, showTypingBubble, inFlightSize, scrollToBottom]);

  if (messages.length === 0 && !showTypingBubble) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
          No messages yet — say hello.
        </p>
      </div>
    );
  }

  // Only render quick-reply chips on the most recent AI message (and only if
  // there are no in-flight streaming messages and no typing indicator).
  const lastAiMessageId =
    (inFlight?.size ?? 0) === 0 && !typing
      ? [...messages].reverse().find((m) => m.role === "ai" && m.quickReplies?.length)?._id
      : undefined;

  return (
    <div ref={containerRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
      {messages.map((m) => {
        if (m.role === "system") {
          return (
            <div
              key={m._id}
              className="mx-auto max-w-[85%] py-1 text-center text-[11px] italic text-neutral-400 dark:text-neutral-500"
              title={formatTime(m.createdAt)}
            >
              {m.content}
            </div>
          );
        }

        const isCustomer = m.role === "customer";
        const isOperator = m.role === "operator";

        const bubbleClass = isCustomer
          ? "ml-auto rounded-br-md text-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
          : isOperator
            ? "mr-auto rounded-bl-md text-neutral-900 dark:text-neutral-100"
            : "mr-auto rounded-bl-md bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100";

        // Customer uses primaryColor; operator gets a tinted background
        // derived from primaryColor at low opacity. AI keeps the neutral bg.
        const inlineStyle: React.CSSProperties = isCustomer
          ? { background: primaryColor }
          : isOperator
            ? { background: `${primaryColor}1A`, borderColor: `${primaryColor}33` }
            : {};

        return (
          <div
            key={m._id}
            className="csb-bubble-in group flex max-w-full flex-col"
            title={formatTime(m.createdAt)}
          >
            {isOperator ? (
              <span className="mb-0.5 ml-1 text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                Teammate
              </span>
            ) : null}
            <div
              className={`max-w-[80%] break-words rounded-2xl border border-transparent px-3 py-2 text-sm ${bubbleClass}`}
              style={inlineStyle}
            >
              {m.role === "ai" ? (
                <div className="message-content">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeSanitize, rehypeHighlight]}
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                      ),
                    }}
                  >
                    {m.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <span className="whitespace-pre-wrap">{m.content}</span>
              )}
              {m.attachments && m.attachments.length > 0 ? (
                <ul className="mt-1.5 space-y-2.5">
                  {m.attachments.map((a, i) => {
                    const href = authedUrl(a.url ?? a.fileUrl, sessionToken);
                    const label = a.fileName ?? "Attachment";
                    if (!href) return null;
                    const isImage = isImageAttachment(a);
                    if (isImage) {
                      return (
                        <li key={i}>
                          <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={href}
                              alt={label}
                              className="max-h-40 max-w-full rounded-lg border border-black/5 object-cover"
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
                          className="flex items-center gap-2 rounded-lg border border-black/10 bg-white/60 px-2.5 py-1.5 text-[11px] text-current no-underline transition hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                        >
                          <DocumentIcon className="h-4 w-4 shrink-0 opacity-70" />
                          <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                          {a.size ? <span className="shrink-0 opacity-60">{formatBytes(a.size)}</span> : null}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
            {m.role === "ai" && m.blocks && m.blocks.length > 0 ? (
              <BlockRenderer
                blocks={m.blocks}
                primaryColor={primaryColor}
                onSendMessage={onSendMessage}
                conversationId={conversationId}
                sessionToken={sessionToken}
              />
            ) : null}
            {m.role === "ai" && m.sources && m.sources.length > 0 ? (
              <Citations sources={m.sources} />
            ) : null}
            {m.role === "ai" ? (
              <FeedbackControls messageId={m._id} sessionToken={sessionToken} onExpand={scrollToBottom} />
            ) : null}
            {m.role === "ai" && m._id === lastAiMessageId && m.quickReplies?.length && onSendMessage ? (
              <QuickReplies replies={m.quickReplies} onSend={onSendMessage} />
            ) : null}
            <span className="mt-0.5 ml-1 text-[10px] text-neutral-400 opacity-0 transition group-hover:opacity-100 dark:text-neutral-500">
              {formatTime(m.createdAt)}
            </span>
          </div>
        );
      })}
      {/* In-flight streaming bubbles */}
      {inFlight && Array.from(inFlight.entries()).map(([msgId, text]) => (
        <div key={`stream-${msgId}`} className="csb-bubble-in group flex max-w-full flex-col">
          <div className="max-w-[80%] break-words rounded-2xl rounded-bl-md border border-transparent bg-neutral-100 px-3 py-2 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
            <div className="message-content csb-streaming-cursor">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {text || " "}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      ))}
      {showTypingBubble && (inFlight?.size ?? 0) === 0 ? (
        <TypingIndicator
          aria-label={operatorTyping ? "Operator is typing" : "Assistant is typing"}
        />
      ) : null}
    </div>
  );
}
