"use client";

// SectionCard — one clickable tile in the Sections (help-center) tab. Clicking
// it delegates to the parent (WidgetRoot.handleOpenSection), which renders the
// section's linked content INLINE inside the widget (SectionContentView).

import type { WidgetSection } from "../lib/api-client";

export function SectionCard({
  section,
  primaryColor,
  onSelect,
}: {
  section: WidgetSection;
  primaryColor: string;
  onSelect: (section: WidgetSection) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(section)}
      className="group flex w-full items-start gap-3 rounded-2xl border border-neutral-200 p-3 text-left transition hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
    >
      <span
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
        style={{ background: primaryColor }}
        aria-hidden
      >
        {section.icon ? section.icon : (section.title?.[0] ?? "?").toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {section.title}
        </span>
        {section.description ? (
          <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">{section.description}</span>
        ) : null}
      </span>
      <span className="mt-1 text-neutral-300 group-hover:text-neutral-500 dark:text-neutral-600 dark:group-hover:text-neutral-400" aria-hidden>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </button>
  );
}
