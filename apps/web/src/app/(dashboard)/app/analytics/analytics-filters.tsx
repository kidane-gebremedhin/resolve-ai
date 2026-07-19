"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useState } from "react";

type Website = { _id: string; name: string; domain: string };

const RANGE_OPTIONS = [
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
  { label: "90 days", value: "90" },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AnalyticsFilters({
  websites,
  activeWebsiteId,
}: {
  websites: Website[];
  activeWebsiteId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const days = searchParams.get("days") ?? "30";
  const fromParam = searchParams.get("from") ?? "";
  const toParam = searchParams.get("to") ?? "";
  const websiteId = searchParams.get("websiteId") ?? activeWebsiteId ?? "";

  const isCustom = Boolean(fromParam && toParam);
  const [showCustom, setShowCustom] = useState(isCustom);
  const [localFrom, setLocalFrom] = useState(fromParam || todayIso());
  const [localTo, setLocalTo] = useState(toParam || todayIso());

  const update = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  function selectPreset(d: string) {
    setShowCustom(false);
    update({ days: d, from: "", to: "" });
  }

  function applyCustom() {
    if (!localFrom || !localTo || localFrom > localTo) return;
    update({ from: localFrom, to: localTo, days: "" });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      {/* Quick-select pills */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
        {RANGE_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => selectPreset(o.value)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              !isCustom && !showCustom && days === o.value
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom((v) => !v)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition ${
            isCustom || showCustom
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Custom
        </button>
      </div>

      {/* Custom date inputs — shown when "Custom" pill is active */}
      {showCustom && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={localFrom}
            max={localTo || todayIso()}
            onChange={(e) => setLocalFrom(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="date"
            value={localTo}
            min={localFrom}
            max={todayIso()}
            onChange={(e) => setLocalTo(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
          />
          <button
            onClick={applyCustom}
            disabled={!localFrom || !localTo || localFrom > localTo}
            className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition"
          >
            Apply
          </button>
        </div>
      )}

      {/* Website filter */}
      {websites.length > 1 && (
        <select
          value={websiteId}
          onChange={(e) => update({ websiteId: e.target.value })}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
        >
          <option value="">All websites</option>
          {websites.map((w) => (
            <option key={w._id} value={w._id}>
              {w.name || w.domain}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
