"use client";

import { useState } from "react";
import type { MessageSource } from "../lib/api-client";

export function Citations({ sources }: { sources: MessageSource[] }) {
  const [open, setOpen] = useState(false);

  if (!sources || sources.length === 0) return null;

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
        Sources ({sources.length})
      </button>
      {open ? (
        <ul className="mt-1 space-y-0.5 pl-1">
          {sources.map((s) =>
            s.url ? (
              <li key={s.sourceId}>
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
                  {s.sourceTitle}
                </a>
              </li>
            ) : (
              <li key={s.sourceId} className="text-[11px] text-neutral-400 dark:text-neutral-500">
                {s.sourceTitle}
              </li>
            ),
          )}
        </ul>
      ) : null}
    </div>
  );
}
