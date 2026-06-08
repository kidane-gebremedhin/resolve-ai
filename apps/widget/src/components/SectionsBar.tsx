"use client";

// SectionsBar — a compact, always-visible strip of the configured section
// shortcuts, pinned at the bottom of the widget during a conversation so the
// topics never disappear once the visitor starts chatting. Horizontally
// scrollable when there are more chips than fit.
//
// Tap behaviour mirrors SectionCard but adapted to an in-progress chat:
//   - link  → open the URL in a new tab
//   - topic → send the section's topicPrompt into the CURRENT conversation
//   - other → send the section title as the visitor's message
// (the parent's onSelect handler decides; see WidgetRoot.handleSectionShortcut).

import type { WidgetSection } from "../lib/api-client";

export function SectionsBar({
  sections,
  primaryColor,
  onSelect,
  disabled,
}: {
  sections: WidgetSection[];
  primaryColor: string;
  onSelect: (section: WidgetSection) => void;
  disabled?: boolean;
}) {
  if (sections.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-neutral-100 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((s) => (
          <button
            key={s._id}
            type="button"
            onClick={() => onSelect(s)}
            disabled={disabled}
            title={s.title}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
          >
            <span aria-hidden style={{ color: primaryColor }}>
              {s.icon ? s.icon : "•"}
            </span>
            <span className="whitespace-nowrap">{s.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
