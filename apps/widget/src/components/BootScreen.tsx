"use client";

// Boot screen — shown while we fetch settings/session. Subtle skeleton so the
// iframe doesn't flash a hard spinner; degrades gracefully to a tiny spinner
// after the animation cycles if init is slow.

export function BootScreen({ primaryColor }: { primaryColor?: string }) {
  const color = primaryColor ?? "#1e40af"; // blue-800
  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-neutral-900">
      {/* Header skeleton — same height as the real header so there's no jump on load. */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ backgroundColor: color }}
      >
        <span className="h-8 w-8 animate-pulse rounded-full bg-white/30" aria-hidden />
        <span className="flex flex-1 flex-col gap-1.5">
          <span className="h-3 w-24 animate-pulse rounded-full bg-white/30" aria-hidden />
          <span className="h-2 w-32 animate-pulse rounded-full bg-white/20" aria-hidden />
        </span>
      </div>

      {/* Body skeleton — a couple of placeholder bubbles. */}
      <div className="flex-1 space-y-3 overflow-hidden px-3 py-4">
        <span className="block h-9 w-3/5 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-800" aria-hidden />
        <span className="ml-auto block h-9 w-2/5 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-800" aria-hidden />
        <span className="block h-9 w-1/2 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-800" aria-hidden />
      </div>

      {/* Composer skeleton. */}
      <div className="flex items-center gap-2 border-t border-neutral-100 p-3 dark:border-neutral-800">
        <span className="h-9 flex-1 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-800" aria-hidden />
        <span
          className="h-10 w-10 animate-pulse rounded-full"
          style={{ backgroundColor: `${color}33` }}
          aria-hidden
        />
      </div>

      <span className="sr-only" role="status">
        Loading chat
      </span>
    </div>
  );
}
