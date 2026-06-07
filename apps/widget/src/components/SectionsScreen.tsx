"use client";

// sections — return visitor with a valid session but no active conversation.
// Lists tappable topics + an explicit "Start a new conversation" CTA.

import type { WidgetAgent, WidgetSection, WidgetSettings } from "../lib/api-client";
import { WidgetHeader } from "./WidgetHeader";
import { SectionCard } from "./SectionCard";

export function SectionsScreen({
  agent,
  settings,
  sections,
  primaryColor,
  onSelectSection,
  onStartNew,
  busy,
}: {
  agent: WidgetAgent | null;
  settings: WidgetSettings;
  sections: WidgetSection[];
  primaryColor: string;
  onSelectSection: (s: WidgetSection) => void;
  onStartNew: () => void;
  busy: boolean;
}) {
  const title = "Welcome back";
  const subtitle = "Pick a topic or start a new conversation.";

  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-neutral-900">
      <WidgetHeader agent={agent} primaryColor={primaryColor} />
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{subtitle}</p>
        </div>

        <div className="space-y-2">
          {sections.length === 0 ? (
            <p className="text-xs text-neutral-400 dark:text-neutral-500">No topics yet. Tap below to start chatting.</p>
          ) : (
            sections.map((s) => (
              <SectionCard
                key={s._id}
                section={s}
                primaryColor={primaryColor}
                onSelect={onSelectSection}
              />
            ))
          )}
        </div>
      </div>
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
