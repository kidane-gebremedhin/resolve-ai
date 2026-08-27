"use client";

import { useState } from "react";
import type { MessageSource } from "../lib/api-client";

/**
 * Resolve an inline `[2]` in the reply text to its source.
 *
 * Exported so the message renderer can turn markers into anchors. Returns
 * undefined for a marker with no matching source, which the renderer leaves as
 * plain text rather than rendering a link to nowhere — though the server strips
 * impossible markers before they get here, so this is defence in depth.
 */
export function resolveMarker(
  sources: MessageSource[] | undefined,
  marker: number,
): MessageSource | undefined {
  return sources?.find((s) => s.marker === marker);
}

/** Whether this message carries inline markers at all. */
export function hasInlineMarkers(sources: MessageSource[] | undefined): boolean {
  return Boolean(sources?.some((s) => typeof s.marker === "number"));
}

export function Citations({ sources }: { sources: MessageSource[] }) {
  const [open, setOpen] = useState(false);

  if (!sources || sources.length === 0) return null;

  // Ordered by marker when the reply used them, so the list reads in the same
  // order the customer met them in the text. Messages without markers keep
  // their original order untouched.
  const ordered = hasInlineMarkers(sources)
    ? [...sources].sort((a, b) => (a.marker ?? 99) - (b.marker ?? 99))
    : sources;

  return (
    <div className="mt-1 ml-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-neutral-400 transition hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
        aria-expanded={open}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        Sources ({ordered.length})
      </button>
      {open ? (
        <ul className="mt-1 space-y-0.5 pl-1">
          {ordered.map((s) =>
            s.url ? (
              <li key={s.chunkId ?? s.sourceId}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-neutral-500 underline decoration-dotted transition hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  {typeof s.marker === "number" ? `[${s.marker}] ` : ""}
                  {s.sourceTitle}
                </a>
              </li>
            ) : (
              <li
                key={s.chunkId ?? s.sourceId}
                className="text-[11px] text-neutral-400 dark:text-neutral-500"
              >
                {typeof s.marker === "number" ? `[${s.marker}] ` : ""}
                {s.sourceTitle}
              </li>
            ),
          )}
        </ul>
      ) : null}
    </div>
  );
}
