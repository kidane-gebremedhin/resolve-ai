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
import { SuggestedQuestions } from "./SuggestedQuestions";

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
  // Suggested questions are onboarding prompts — hide them once the visitor has
  // sent their first message (any "customer" message in the transcript).
  const userHasSent = messages.some((m) => m.role === "customer");
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
      {/* Suggested questions (configured per-agent in /app/widget) — a chip strip
          in the Chat tab shown only before the visitor's first message, to seed
          the conversation. Hidden after they send, and while the contact-prompt
          overlay forces the composer closed. */}
      {!composerDisabled && !userHasSent ? (
        <SuggestedQuestions
          questions={agent?.suggestedQuestions ?? []}
          onSend={onSend}
          disabled={aiTyping}
        />
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
