"use client";

// Boot screen — shown while we fetch settings/session. Intentionally minimal so
// the iframe doesn't flash a heavy skeleton for the typical sub-200ms init.

export function BootScreen({ primaryColor }: { primaryColor?: string }) {
  const color = primaryColor ?? "#1e40af"; // blue-800
  return (
    <div className="flex h-full w-full items-center justify-center bg-white dark:bg-neutral-900">
      <div className="flex flex-col items-center gap-3 text-neutral-500 dark:text-neutral-400">
        <span
          className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-neutral-200 dark:border-neutral-700"
          style={{ borderTopColor: color }}
          aria-hidden
        />
        <span className="text-xs">Loading chat…</span>
      </div>
    </div>
  );
}
