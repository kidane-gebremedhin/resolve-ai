"use client";

// pre_chat — first-time visitor (or expired session). Shows the agent greeting,
// suggested questions, the configured sections, and a composer.
//
// Sections (when configured) float as an overlay panel over the bottom of the
// chat transcript, anchored just above the composer, visible until the first
// message is sent. The visitor can either tap a section topic OR type their own
// message directly — sections never block the input.
//
// Contact info is collected AFTER the first message is sent — the
// ContactPromptScreen overlay appears once the first AI reply lands.

import type { WidgetAgent, WidgetSection, WidgetSettings } from "../lib/api-client";
import { WidgetHeader } from "./WidgetHeader";
import { SectionCard } from "./SectionCard";
import { Composer } from "./Composer";

export function PreChatScreen({
  agent,
  settings,
  sections,
  primaryColor,
  onStart,
  onSelectSection,
  busy,
}: {
  agent: WidgetAgent | null;
  settings: WidgetSettings;
  sections: WidgetSection[];
  primaryColor: string;
  /** Called when the user submits their first message. */
  onStart: (args: { content: string }) => Promise<void> | void;
  /** Called when the user taps a configured section/topic. */
  onSelectSection: (section: WidgetSection) => void;
  busy: boolean;
}) {
  const suggested = settings?.suggestedQuestions ?? agent?.suggestedQuestions ?? [];
  const welcome = settings?.welcomeMessage ?? agent?.welcomeMessage;

  async function handleSend(content: string) {
    await onStart({ content });
  }

  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-neutral-900">
      <WidgetHeader agent={agent} primaryColor={primaryColor} />

      {/* Transcript region — `relative` so the sections panel can float over its
          bottom edge (just above the composer) rather than pushing content. */}
      <div className="relative min-h-0 flex-1">
        <div className="h-full space-y-4 overflow-y-auto px-4 py-4">
          {welcome ? (
            <div className="rounded-2xl bg-neutral-100 px-3 py-2 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
              {welcome}
            </div>
          ) : null}
        </div>

        {/* Sections floating over the bottom of the chat, anchored just above
            the composer — visible until the first message is sent. Tapping one
            starts the conversation on that topic; the visitor can also just type
            instead. The wrapper is click-through (pointer-events-none) so only
            the panel itself is interactive; scrolls if there are many. */}
        {sections.length > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 px-3 pb-2">
            <div className="pointer-events-auto max-h-[60%] space-y-2 overflow-y-auto rounded-2xl border border-neutral-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95">
              {sections.map((s) => (
                <SectionCard
                  key={s._id}
                  section={s}
                  primaryColor={primaryColor}
                  onSelect={onSelectSection}
                />
              ))}
            </div>
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
