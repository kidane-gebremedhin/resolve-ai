"use client";

// Generic error screen. Per spec 09, we never expose technical details to the
// customer — the friendly message stays the same regardless of the underlying
// failure; the raw message is logged to the console for debugging.

import { useEffect } from "react";

export function ErrorScreen({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry: () => void;
}) {
  useEffect(() => {
    if (message) {
      // eslint-disable-next-line no-console
      console.error("[widget] error state:", message);
    }
  }, [message]);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-white p-6 text-center dark:bg-neutral-900">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500 dark:bg-red-500/10 dark:text-red-400">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">We couldn&apos;t load the chat</p>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Please check your connection and try again.
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full bg-neutral-900 px-4 py-2 text-xs font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        Try again
      </button>
    </div>
  );
}
