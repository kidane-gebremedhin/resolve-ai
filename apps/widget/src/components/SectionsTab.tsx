"use client";

// SectionsTab — the "Sections" top-level tab: a help-center style list of the
// org's configured sections. Tapping a section opens its linked content inline
// (see SectionContentView via WidgetRoot.handleOpenSection). This is separate
// from the Chat tab and from suggested questions.

import type { WidgetAgent, WidgetSection } from "../lib/api-client";
import { WidgetHeader } from "./WidgetHeader";
import { SectionCard } from "./SectionCard";

export function SectionsTab({
  agent,
  sections,
  primaryColor,
  headerStyle,
  onSelect,
}: {
  agent: WidgetAgent | null;
  sections: WidgetSection[];
  primaryColor: string;
  headerStyle: "pinstripe" | "solid";
  onSelect: (section: WidgetSection) => void;
}) {
  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-neutral-900">
      <WidgetHeader agent={agent} primaryColor={primaryColor} headerStyle={headerStyle} />
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        <div className="mb-1">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            How can we help?
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            Browse our help topics.
          </p>
        </div>
        {sections.length === 0 ? (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            No topics yet.
          </p>
        ) : (
          sections.map((s) => (
            <SectionCard
              key={s._id}
              section={s}
              primaryColor={primaryColor}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}
