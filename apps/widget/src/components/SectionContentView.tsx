"use client";

// SectionContentView — the inline "article" view for the Sections feature.
// When a visitor taps a section, its linked page is rendered INLINE inside the
// widget via an iframe (no new tab), with a back button. To defeat sites that
// refuse direct framing (X-Frame-Options / CSP frame-ancestors), the iframe
// loads the API's section-content PROXY (`/widget/sections/:id/content`), which
// fetches the page server-side and strips those headers. The header still
// carries an "Open ↗" link to the real URL as a fallback.

import type { WidgetSection } from "../lib/api-client";
import { API_URL } from "../lib/api-client";

export function SectionContentView({
  section,
  primaryColor,
  onBack,
}: {
  section: WidgetSection;
  primaryColor: string;
  onBack: () => void;
}) {
  // Render via the server-side proxy so X-Frame-Options/CSP-protected pages still
  // display inline. Falls back to nothing if the section has no link.
  const proxySrc = section.url
    ? `${API_URL}/widget/sections/${section._id}/content`
    : null;
  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-white dark:bg-neutral-900">
      <div className="flex items-center gap-2 border-b border-neutral-100 px-2 py-2 dark:border-neutral-800">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {section.title}
        </span>
        {section.url ? (
          <a
            href={section.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition hover:opacity-80"
            style={{ color: primaryColor }}
            title="Open in a new tab"
          >
            Open
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 bg-neutral-50 dark:bg-neutral-950">
        {proxySrc ? (
          <iframe
            src={proxySrc}
            title={section.title}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
            This section has no content link configured yet.
          </div>
        )}
      </div>
    </div>
  );
}
