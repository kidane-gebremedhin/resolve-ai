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

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// Animated "AI is typing" bubble — three dots bouncing in sequence. Styled to
// match an AI message bubble (left-aligned, neutral background).
function TypingIndicator() {
  return (
    <div className="group flex max-w-full flex-col" aria-live="polite" aria-label="Assistant is typing">
      <div className="mr-auto flex items-center gap-1 rounded-2xl bg-neutral-100 px-3.5 py-3 dark:bg-neutral-800">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:-300ms] dark:bg-neutral-500" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:-150ms] dark:bg-neutral-500" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 dark:bg-neutral-500" />
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  primaryColor,
  typing = false,
}: {
  messages: WidgetMessage[];
  primaryColor: string;
  /** Show the animated "AI is typing" bubble at the bottom of the transcript. */
  typing?: boolean;
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
          ? "ml-auto text-white"
          : isOperator
            ? "mr-auto text-neutral-900 dark:text-neutral-100"
            : "mr-auto bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100";

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
            className="group flex max-w-full flex-col"
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
                <ul className="mt-1.5 space-y-1">
                  {m.attachments.map((a, i) => {
                    const href = a.url ?? a.fileUrl;
                    const label = a.fileName ?? "Attachment";
                    if (!href) return null;
                    return (
                      <li key={i}>
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] underline opacity-90 hover:opacity-100"
                        >
                          {label}
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
