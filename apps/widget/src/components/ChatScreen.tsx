"use client";

// ChatScreen — the active conversation view. Wraps header / optional escalated
// banner / MessageList / Composer. The contact_prompt overlay is layered on
// top by the parent (WidgetRoot) when machine.overlay === "contact_prompt".
//
// This component is *presentation only*: it doesn't talk to the API. The
// parent passes `messages`, `onSend`, and `onAttach`. That keeps the optimistic
// append + socket-driven append logic in one place (WidgetRoot) instead of
// duplicated here.

import type { WidgetAgent, WidgetMessage } from "../lib/api-client";
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
}: {
  agent: WidgetAgent | null;
  primaryColor: string;
  messages: WidgetMessage[];
  /** Show the escalated banner above the transcript. */
  escalated: boolean;
  onSend: (content: string) => Promise<void> | void;
  onAttach?: (file: File) => Promise<void> | void;
  /** Set true while the contact_prompt overlay is up — chat is read-only then. */
  composerDisabled?: boolean;
  /** Show the animated "AI is typing" indicator while a reply is pending. */
  aiTyping?: boolean;
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
      <MessageList messages={messages} primaryColor={primaryColor} typing={aiTyping} />
      <Composer
        onSend={onSend}
        onAttach={onAttach}
        primaryColor={primaryColor}
        disabled={composerDisabled}
      />
    </div>
  );
}
