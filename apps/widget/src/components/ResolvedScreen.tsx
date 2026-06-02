"use client";

// ResolvedScreen — terminal state for a conversation. Shows the prior history
// (read-only via MessageList) plus a CTA to start a fresh thread. Per spec 09
// new messages do NOT reopen a resolved conversation; the "Start new" button
// dispatches START_NEW_CONVERSATION which sends the machine back to pre_chat.

import type { WidgetAgent, WidgetMessage } from "../lib/api-client";
import { WidgetHeader } from "./WidgetHeader";
import { MessageList } from "./MessageList";

export function ResolvedScreen({
  agent,
  primaryColor,
  messages,
  onStartNew,
  busy,
}: {
  agent: WidgetAgent | null;
  primaryColor: string;
  messages: WidgetMessage[];
  onStartNew: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-neutral-900">
      <WidgetHeader
        agent={agent}
        primaryColor={primaryColor}
        status={{ label: "Resolved", tone: "success" }}
      />
      <div className="border-b border-emerald-100 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
        This conversation has been resolved. Start a new one if you need more
        help.
      </div>
      <MessageList messages={messages} primaryColor={primaryColor} />
      <footer className="border-t border-neutral-100 p-3 dark:border-neutral-800">
        <button
          type="button"
          onClick={onStartNew}
          disabled={busy}
          className="w-full rounded-full px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: primaryColor }}
        >
          Start a new conversation
        </button>
      </footer>
    </div>
  );
}
