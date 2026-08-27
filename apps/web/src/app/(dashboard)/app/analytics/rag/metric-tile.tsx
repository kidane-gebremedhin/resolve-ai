"use client";

// A KPI tile with its definition attached.
//
// The definition opens on CLICK rather than hover. A hover tooltip is invisible
// on a touch screen, and this page is explicitly checked at a narrow viewport —
// a definition an operator cannot reach on their phone is the same as no
// definition. Click also gives keyboard users the same affordance for free.

import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@csb/ui";

export type MetricDefinition = {
  label: string;
  definition: string;
  note?: string;
  example?: string;
};

export function DefinitionPopover({
  title,
  definition,
}: {
  title: string;
  definition?: MetricDefinition;
}) {
  if (!definition) return null;
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`What is ${title}?`}
        className="rounded-full p-0.5 text-muted-foreground/60 transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-xs leading-relaxed">
        <div className="font-display text-sm font-semibold">{title}</div>
        <p className="mt-1.5 text-muted-foreground">{definition.definition}</p>
        {definition.example && (
          <p className="mt-2 rounded-md bg-muted px-2 py-1.5 text-muted-foreground">
            {definition.example}
          </p>
        )}
        {definition.note && (
          <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground/80">
            {definition.note}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function MetricTile({
  label,
  value,
  sub,
  delta,
  /** Which direction of change is an improvement. `null` renders the delta neutral. */
  betterWhen = "up",
  definition,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: { text: string; raw: number } | null;
  betterWhen?: "up" | "down" | null;
  definition?: MetricDefinition;
}) {
  const tone =
    !delta || delta.raw === 0 || betterWhen === null
      ? "text-muted-foreground"
      : (delta.raw > 0) === (betterWhen === "up")
        ? "text-success"
        : "text-warning";

  return (
    <div className="bg-card p-5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{label}</span>
        <DefinitionPopover title={label} definition={definition} />
      </div>
      <div className="mt-2 font-display text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        {sub && <span>{sub}</span>}
        {delta && (
          <span className={tone} title="Change against the previous period of equal length">
            {delta.text} vs prev
          </span>
        )}
      </div>
    </div>
  );
}
