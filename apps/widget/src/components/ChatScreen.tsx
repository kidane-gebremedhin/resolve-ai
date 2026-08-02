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
  headerStyle,
  messages,
  escalated,
  onSend,
  onAttach,
  onVoiceMessage,
  composerDisabled = false,
  aiTyping = false,
  operatorTyping = false,
  onTyping,
  sessionToken,
  conversationId,
  inFlight,
}: {
  agent: WidgetAgent | null;
  primaryColor: string;
  headerStyle: "pinstripe" | "solid";
  messages: WidgetMessage[];
  /** Show the escalated banner above the transcript. */
  escalated: boolean;
  onSend: (content: string, attachments?: WidgetAttachment[]) => Promise<void> | void;
  /** Uploads a file and returns its metadata for the composer to queue. */
  onAttach?: (file: File) => Promise<WidgetAttachment>;
  /** Sends a voice recording blob to the API voice-message endpoint. */
  onVoiceMessage?: (blob: Blob) => Promise<void>;
  /** Set true while the contact_prompt overlay is up — chat is read-only then. */
  composerDisabled?: boolean;
  /** Show the animated "AI is typing" indicator while a reply is pending. */
  aiTyping?: boolean;
  /** Show the "operator is typing" 3-dot bubble. */
  operatorTyping?: boolean;
  /** Called on every keystroke — WidgetRoot debounces and emits customer:typing. */
  onTyping?: () => void;
  /** Authenticates attachment preview/download URLs. */
  sessionToken?: string;
  /** Current active conversation id, passed to block components for form submissions. */
  conversationId?: string;
  /** In-flight streaming messages: messageId → accumulated delta text. */
  inFlight?: Map<string, string>;
}) {
  // Suggested questions are onboarding prompts — hide them once the conversation
  // has started. That means any message exists (customer or AI, incl. a proactive
  // opener) OR a conversation id is already present (covers resumed sessions and
  // the brief window before the first message has propagated into `messages`).
  const conversationStarted = messages.length > 0 || Boolean(conversationId);
  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-neutral-900">
      <WidgetHeader
        agent={agent}
        primaryColor={primaryColor}
        headerStyle={headerStyle}
        status={
          escalated ? { label: "Connecting", tone: "warn" } : null
        }
      />
      {escalated ? (
        <EscalatedBanner operatorJoined={messages.some((m) => m.role === "operator")} />
      ) : null}
      <MessageList
        messages={messages}
        primaryColor={primaryColor}
        typing={aiTyping}
        operatorTyping={operatorTyping}
        sessionToken={sessionToken}
        conversationId={conversationId}
        inFlight={inFlight}
        onSendMessage={(text) => void onSend(text)}
      />
      {/* Suggested questions (configured per-agent in /app/widget) — a chip strip
          in the Chat tab shown only before the visitor's first message, to seed
          the conversation. Hidden after they send, and while the contact-prompt
          overlay forces the composer closed. */}
      {!composerDisabled && !conversationStarted ? (
        <SuggestedQuestions
          questions={agent?.suggestedQuestions ?? []}
          onSend={onSend}
          disabled={aiTyping}
        />
      ) : null}
      <Composer
        onSend={onSend}
        onAttach={onAttach}
        onVoiceMessage={onVoiceMessage}
        onTyping={onTyping}
        primaryColor={primaryColor}
        disabled={composerDisabled}
      />
    </div>
  );
}
