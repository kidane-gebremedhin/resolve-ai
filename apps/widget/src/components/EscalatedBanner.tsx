"use client";

// EscalatedBanner — inline notice rendered above the message list while the
// conversation is in the `escalated` state. Per spec 09 the AI no longer
// auto-replies; this banner reassures the customer that a human is on the way.
// Once a teammate has actually replied (`operatorJoined`), it flips to a
// "connected" message so the customer isn't left staring at "Connecting…".

export function EscalatedBanner({ operatorJoined = false }: { operatorJoined?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 border-b px-3 py-2 text-[12px] ${
        operatorJoined
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
      }`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="shrink-0"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>
        {operatorJoined
          ? "You're connected with a teammate."
          : "Connecting you to a teammate — they'll join in a moment."}
      </span>
    </div>
  );
}
