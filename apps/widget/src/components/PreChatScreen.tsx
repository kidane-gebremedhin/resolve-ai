"use client";

// pre_chat — first-time visitor (or expired session). Shows the agent greeting,
// suggested questions, and a composer.
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
  onStart,
  busy,
}: {
  agent: WidgetAgent | null;
  settings: WidgetSettings;
  primaryColor: string;
  /** Called when the user submits their first message. */
  onStart: (args: { content: string }) => Promise<void> | void;
  busy: boolean;
}) {
  const title = "How can we help?";
  const subtitle = "Send us a message and we&apos;ll get back to you fast.";
  const suggested = settings?.suggestedQuestions ?? agent?.suggestedQuestions ?? [];
  const welcome = settings?.welcomeMessage ?? agent?.welcomeMessage;

  async function handleSend(content: string) {
    await onStart({ content });
  }

  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-neutral-900">
      <WidgetHeader agent={agent} primaryColor={primaryColor} />
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
          <p
            className="mt-1 text-xs text-neutral-500 dark:text-neutral-400"
            dangerouslySetInnerHTML={{ __html: subtitle }}
          />
        </div>

        {welcome ? (
          <div className="rounded-2xl bg-neutral-100 px-3 py-2 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
            {welcome}
          </div>
        ) : null}

        {suggested.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Suggested</p>
            <div className="flex flex-col gap-1.5">
              {suggested.slice(0, 4).map((q) => (
                <button
                  key={q}
                  type="button"
                  className="rounded-xl border border-neutral-200 px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  onClick={() => handleSend(q)}
                  disabled={busy}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <Composer onSend={handleSend} primaryColor={primaryColor} disabled={busy} />
    </div>
  );
}
