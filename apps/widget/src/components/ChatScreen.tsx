"use client";

// ChatScreen — the active conversation view. Wraps header / optional escalated
// banner / MessageList / Composer. The contact_prompt overlay is layered on
// top by the parent (WidgetRoot) when machine.overlay === "contact_prompt".
//
// This component is *presentation only*: it doesn't talk to the API. The
// parent passes `messages`, `onSend`, and `onAttach`. That keeps the optimistic
// append + socket-driven append logic in one place (WidgetRoot) instead of
// duplicated here.

import type { WidgetAgent, WidgetAttachment, WidgetMessage } from "../lib/api-client";
import { WidgetHeader } from "./WidgetHeader";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { EscalatedBanner } from "./EscalatedBanner";

export function ChatScreen({
  agent,
  primaryColor,
  messages,
  escalated,
  onSend,
  onAttach,
  composerDisabled = false,
  aiTyping = false,
  sessionToken,
}: {
  agent: WidgetAgent | null;
  primaryColor: string;
  messages: WidgetMessage[];
  /** Show the escalated banner above the transcript. */
  escalated: boolean;
  onSend: (content: string, attachments?: WidgetAttachment[]) => Promise<void> | void;
  /** Uploads a file and returns its metadata for the composer to queue. */
  onAttach?: (file: File) => Promise<WidgetAttachment>;
  /** Set true while the contact_prompt overlay is up — chat is read-only then. */
  composerDisabled?: boolean;
  /** Show the animated "AI is typing" indicator while a reply is pending. */
  aiTyping?: boolean;
  /** Authenticates attachment preview/download URLs. */
  sessionToken?: string;
}) {
  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-neutral-900">
      <WidgetHeader
        agent={agent}
        primaryColor={primaryColor}
        status={
          escalated ? { label: "Connecting", tone: "warn" } : null
        }
      />
      {escalated ? (
        <EscalatedBanner operatorJoined={messages.some((m) => m.role === "operator")} />
      ) : null}
      <MessageList messages={messages} primaryColor={primaryColor} typing={aiTyping} sessionToken={sessionToken} />
      {/* Suggested questions (configured per-agent in /app/widget) — shown only
          before the first message, right-aligned like the customer's own
          bubbles. Clicking sends immediately. */}
      {agent?.suggestedQuestions &&
      agent.suggestedQuestions.length > 0 &&
      messages.length === 0 &&
      !composerDisabled ? (
        <div className="flex flex-col items-end gap-1.5 px-3 pb-1.5">
          {agent.suggestedQuestions.map((q, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSend(q)}
              disabled={aiTyping}
              className="max-w-[85%] rounded-full border border-neutral-200 bg-white px-3.5 py-2 text-right text-sm text-neutral-800 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
            >
              {q}
            </button>
          ))}
        </div>
      ) : null}
      <Composer
        onSend={onSend}
        onAttach={onAttach}
        primaryColor={primaryColor}
        disabled={composerDisabled}
      />
    </div>
  );
}
