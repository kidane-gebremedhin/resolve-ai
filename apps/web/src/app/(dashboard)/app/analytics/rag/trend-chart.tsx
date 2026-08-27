"use client";

// Two aligned series over the same day axis, drawn on a fixed 0..1 scale because
// both confidence and faithfulness are already normalised. Auto-scaling would
// make a flat 0.9 look like a mountain range.
//
// Faithfulness is SAMPLED, so its series has gaps. The gaps are drawn as gaps
// rather than interpolated across: a straight line between two sampled days
// asserts measurements that were never taken.

import React from "react";

export type TrendPoint = { date: string; confidence: number | null; faithfulness: number | null };

function segments(points: TrendPoint[], key: "confidence" | "faithfulness"): TrendPoint[][] {
  const out: TrendPoint[][] = [];
  let run: TrendPoint[] = [];
  for (const p of points) {
    if (p[key] === null || p[key] === undefined) {
      if (run.length > 0) out.push(run);
      run = [];
    } else {
      run.push(p);
    }
  }
  if (run.length > 0) out.push(run);
  return out;
}

export function TrendChart({
  points,
  height = 200,
  width = 720,
}: {
  points: TrendPoint[];
  height?: number;
  width?: number;
}) {
  const padding = { top: 10, right: 12, bottom: 26, left: 34 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const n = Math.max(1, points.length - 1);
  const xFor = (i: number) => padding.left + (points.length === 1 ? innerW / 2 : (i / n) * innerW);
  const yFor = (v: number) => padding.top + innerH * (1 - Math.min(Math.max(v, 0), 1));

  const series = [
    { key: "confidence" as const, className: "stroke-primary", label: "Confidence" },
    { key: "faithfulness" as const, className: "stroke-success", label: "Faithfulness (sampled)" },
  ];

  const index = new Map(points.map((p, i) => [p.date, i]));

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label="Confidence and sampled faithfulness over time"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <line
            key={g}
            x1={padding.left}
            x2={padding.left + innerW}
            y1={yFor(g)}
            y2={yFor(g)}
            stroke="currentColor"
            strokeOpacity={0.08}
            strokeDasharray={g === 0 ? undefined : "2 3"}
          />
        ))}
        {[0, 0.5, 1].map((g) => (
          <text key={g} x={padding.left - 4} y={yFor(g) + 3} fontSize={10} textAnchor="end" fill="currentColor" opacity={0.55}>
            {g.toFixed(1)}
          </text>
        ))}

        {series.map((s) =>
          segments(points, s.key).map((seg, si) => {
            if (seg.length === 1) {
              const p = seg[0]!;
              return (
                <circle
                  key={`${s.key}-${si}`}
                  cx={xFor(index.get(p.date) ?? 0)}
                  cy={yFor(p[s.key] as number)}
                  r={2.5}
                  className={s.className.replace("stroke-", "fill-")}
                />
              );
            }
            const d = seg
              .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(index.get(p.date) ?? 0).toFixed(2)},${yFor(p[s.key] as number).toFixed(2)}`)
              .join(" ");
            return (
              <path key={`${s.key}-${si}`} d={d} fill="none" className={s.className} strokeWidth={1.75} strokeLinejoin="round" />
            );
          }),
        )}

        {points.map((p, i) =>
          i % Math.max(1, Math.ceil(points.length / 6)) === 0 || i === points.length - 1 ? (
            <text key={p.date} x={xFor(i).toFixed(2)} y={height - 8} fontSize={10} textAnchor="middle" fill="currentColor" opacity={0.55}>
              {p.date.slice(5).replace("-", "/")}
            </text>
          ) : null,
        )}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className={`h-0.5 w-4 ${s.className.replace("stroke-", "bg-")}`} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
