"use client";

// MessageList — renders the chat transcript chronologically (oldest at top).
// Auto-scrolls to bottom whenever new messages land. Role drives the bubble
// styling per spec 09:
//   - customer  → right-aligned, accent (primaryColor) background
//   - ai        → left-aligned, neutral muted background
//   - operator  → left-aligned, primary-tinted background with a small badge
//   - system    → centered, italic, low-contrast (joins/leaves, etc.)

import { useEffect, useRef } from "react";
import type { WidgetMessage } from "../lib/api-client";
import { DocumentIcon } from "./icons";

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
function TypingIndicator() {
  return (
    <div className="group flex max-w-full flex-col" aria-live="polite" aria-label="Assistant is typing">
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
  sessionToken,
}: {
  messages: WidgetMessage[];
  primaryColor: string;
  /** Show the animated "AI is typing" bubble at the bottom of the transcript. */
  typing?: boolean;
  /** Used to authenticate attachment preview/download URLs (?t=). */
  sessionToken?: string;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Scroll to bottom whenever the message count changes or the typing indicator
  // toggles. We deliberately key on length (not the array identity) so
  // re-renders that don't add a message don't yank the user's scroll position.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, typing]);

  if (messages.length === 0 && !typing) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
          No messages yet — say hello.
        </p>
        <div ref={bottomRef} />
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
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
              className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl border border-transparent px-3 py-2 text-sm ${bubbleClass}`}
              style={inlineStyle}
            >
              {m.content}
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
            <span className="mt-0.5 ml-1 text-[10px] text-neutral-400 opacity-0 transition group-hover:opacity-100 dark:text-neutral-500">
              {formatTime(m.createdAt)}
            </span>
          </div>
        );
      })}
      {typing ? <TypingIndicator /> : null}
      <div ref={bottomRef} />
    </div>
  );
}
