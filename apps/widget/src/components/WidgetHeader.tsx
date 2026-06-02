"use client";

// Shared header used by every non-error screen. Renders agent avatar + name and
// an optional status pill (e.g. "Resolved", "Connecting to a teammate").

import type { WidgetAgent } from "../lib/api-client";

export function WidgetHeader({
  agent,
  primaryColor,
  status,
}: {
  agent: WidgetAgent | null;
  primaryColor: string;
  status?: { label: string; tone: "info" | "warn" | "success" } | null;
}) {
  const initials = (agent?.name ?? "?")
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="flex items-center gap-3 border-b border-neutral-100 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full text-xs font-semibold text-white"
        style={{ background: primaryColor }}
      >
        {agent?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={agent.avatarUrl} alt={agent.name} className="h-full w-full object-cover" />
        ) : (
          initials
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {agent?.name ?? "Assistant"}
        </div>
        <div className="text-[11px] text-neutral-500 dark:text-neutral-400">Typically replies in under 2 minutes</div>
      </div>
      {status ? <StatusPill {...status} /> : null}
    </header>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "info" | "warn" | "success" }) {
  const styles =
    tone === "warn"
      ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
      : tone === "success"
        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
        : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles}`}>{label}</span>;
}
