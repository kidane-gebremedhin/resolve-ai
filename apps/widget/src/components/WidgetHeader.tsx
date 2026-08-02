"use client";

// Shared header used by every non-error screen. Renders agent avatar + name and
// an optional status pill (e.g. "Resolved", "Connecting to a teammate").

import type { WidgetAgent } from "../lib/api-client";

export type WidgetHeaderStyle = "pinstripe" | "solid";

// Literal reference pattern (light): lavender base + fine 45° blue pinstripe.
const LAVENDER_BASE = "#E5E5F7";
const LAVENDER_LINE = "#444CF7";
// Readable dark text/elements for the light lavender header.
const LAVENDER_INK = "#312e81"; // indigo-900

export function WidgetHeader({
  agent,
  primaryColor,
  headerStyle = "pinstripe",
  status,
}: {
  agent: WidgetAgent | null;
  primaryColor: string;
  // "pinstripe" (default) → the lavender/blue pattern; "solid" → the operator's accent colour.
  headerStyle?: WidgetHeaderStyle;
  status?: { label: string; tone: "info" | "warn" | "success" } | null;
}) {
  const initials = (agent?.name ?? "?")
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const solid = headerStyle === "solid";

  // Solid → the operator's accent as the base with a faint WHITE pinstripe overlay + white text.
  // Pinstripe (default) → the literal lavender base + #444CF7 lines + dark indigo text. The
  // pattern lives on a separate overlay at 0.4 opacity (mirroring the reference CSS `opacity: 0.4`)
  // so it stays subtle while the header content (avatar/text) is fully opaque + readable.
  const base = solid ? primaryColor : LAVENDER_BASE;
  const ink = solid ? "#ffffff" : LAVENDER_INK;
  const line = solid ? "#ffffff" : LAVENDER_LINE;
  const gap = solid ? "transparent" : LAVENDER_BASE;
  const patternStyle = {
    opacity: 0.4,
    backgroundSize: "6px 6px",
    backgroundImage: `repeating-linear-gradient(45deg, ${line} 0, ${line} 0.6px, ${gap} 0, ${gap} 50%)`,
  } as const;

  return (
    <header
      className="relative flex items-center gap-3 overflow-hidden px-4 py-3 shadow-[0_1px_0_rgba(0,0,0,0.06)] dark:shadow-[0_1px_0_rgba(0,0,0,0.4)]"
      style={{ backgroundColor: base, color: ink }}
    >
      {/* Pattern overlay — 0.4 opacity, exactly matching the reference pinstripe. */}
      <span aria-hidden className="pointer-events-none absolute inset-0" style={patternStyle} />

      <div
        className="relative z-10 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full text-xs font-semibold"
        style={
          solid
            ? { background: "rgba(255,255,255,0.2)", color: "#fff", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.3)" }
            : { background: "rgba(68,76,247,0.14)", color: LAVENDER_INK, boxShadow: "inset 0 0 0 1px rgba(68,76,247,0.25)" }
        }
      >
        {agent?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={agent.avatarUrl} alt={agent.name} className="h-full w-full object-cover" />
        ) : (
          initials
        )}
      </div>
      <div className="relative z-10 min-w-0 flex-1">
        <div className="truncate text-sm font-semibold" style={{ color: ink }}>
          {agent?.name ?? "Assistant"}
        </div>
        <div className="text-[11px]" style={{ color: ink, opacity: 0.8 }}>
          Typically replies in under 2 minutes
        </div>
      </div>
      {status ? (
        <div className="relative z-10">
          <StatusPill {...status} />
        </div>
      ) : null}
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
