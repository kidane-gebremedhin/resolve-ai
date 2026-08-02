"use client";

// pre_chat — first-time visitor (or expired session). Shows the agent greeting,
// suggested questions, and a composer. (Sections are a separate top-level tab,
// not part of the chat — see SectionsTab / WidgetRoot.)
//
// Contact info is collected AFTER the first message is sent — the
// ContactPromptScreen overlay appears once the first AI reply lands.

import type { WidgetAgent, WidgetSettings } from "../lib/api-client";
import { WidgetHeader } from "./WidgetHeader";
import { Composer } from "./Composer";

export function PreChatScreen({
  agent,
  settings,
  primaryColor,
  headerStyle,
  onStart,
  busy,
}: {
  agent: WidgetAgent | null;
  settings: WidgetSettings;
  primaryColor: string;
  headerStyle: "pinstripe" | "solid";
  /** Called when the user submits their first message. */
  onStart: (args: { content: string }) => Promise<void> | void;
  busy: boolean;
}) {
  // Prefer the widget-settings list when it has entries, otherwise the agent's.
  // (`??` alone would let an empty settings array shadow the agent's questions.)
  const suggested =
    (settings?.suggestedQuestions?.length
      ? settings.suggestedQuestions
      : agent?.suggestedQuestions) ?? [];
  const welcome = settings?.welcomeMessage ?? agent?.welcomeMessage;

  async function handleSend(content: string) {
    await onStart({ content });
  }

  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-neutral-900">
      <WidgetHeader agent={agent} primaryColor={primaryColor} headerStyle={headerStyle} />

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {welcome ? (
          <div className="rounded-2xl bg-neutral-100 px-3 py-2 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
            {welcome}
          </div>
        ) : null}
      </div>

      {/* Suggested questions pinned to the bottom (above the composer),
          right-aligned like the customer's own bubbles — see the Chatbase
          reference. Clicking sends immediately. */}
      {suggested.length > 0 ? (
        <div className="flex flex-col items-end gap-1.5 px-3 pb-1.5">
          {suggested.slice(0, 4).map((q) => (
            <button
              key={q}
              type="button"
              className="max-w-[85%] rounded-full border border-neutral-200 bg-white px-3.5 py-2 text-right text-sm text-neutral-800 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
              onClick={() => handleSend(q)}
              disabled={busy}
            >
              {q}
            </button>
          ))}
        </div>
      ) : null}

      <Composer onSend={handleSend} primaryColor={primaryColor} disabled={busy} />
    </div>
  );
}
