"use client";

// Distribution of the best retrieved score per turn, with the live
// `AI_KB_SEARCH_MIN_SCORE` drawn across it.
//
// The line is the point of the chart. Mass piled up immediately to the right of
// it is what a small increase in the floor would cut, and mass to the LEFT is
// what only reached the prompt because the widen-on-empty retry dropped the
// floor to zero. Neither is visible in a mean.

import React from "react";

export type ScoreBucket = { from: number; to: number; count: number };

export function ScoreDistribution({
  buckets,
  threshold,
  height = 200,
  width = 720,
}: {
  buckets: ScoreBucket[];
  threshold: number;
  height?: number;
  width?: number;
}) {
  const padding = { top: 10, right: 12, bottom: 30, left: 34 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(1, ...buckets.map((b) => b.count));

  // The x-axis is the score scale 0..1, not the bucket index, so the threshold
  // line lands where the score actually is even when a bucket is empty.
  const xFor = (score: number) => padding.left + Math.min(Math.max(score, 0), 1) * innerW;
  const thresholdX = xFor(threshold);
  const cut = buckets.filter((b) => b.to <= threshold).reduce((s, b) => s + b.count, 0);
  const total = buckets.reduce((s, b) => s + b.count, 0);

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Score distribution with the retrieval floor at ${threshold}`}
      >
        {[0.25, 0.5, 0.75, 1].map((g) => {
          const y = padding.top + innerH * (1 - g);
          return (
            <line
              key={g}
              x1={padding.left}
              x2={padding.left + innerW}
              y1={y}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeDasharray={g === 1 ? undefined : "2 3"}
            />
          );
        })}

        <text x={padding.left - 4} y={padding.top + 8} fontSize={10} textAnchor="end" fill="currentColor" opacity={0.55}>
          {max.toLocaleString()}
        </text>
        <text x={padding.left - 4} y={padding.top + innerH} fontSize={10} textAnchor="end" fill="currentColor" opacity={0.55}>
          0
        </text>

        {buckets.map((b) => {
          const x = xFor(b.from);
          const w = Math.max(1, xFor(b.to) - x - 1);
          const h = (b.count / max) * innerH;
          const belowFloor = b.to <= threshold;
          return (
            <rect
              key={b.from}
              x={x.toFixed(2)}
              y={(padding.top + innerH - h).toFixed(2)}
              width={w.toFixed(2)}
              height={Math.max(0, h).toFixed(2)}
              // Below the floor is drawn muted: those turns only reached the
              // prompt because widen-on-empty dropped the floor.
              className={belowFloor ? "fill-muted-foreground/40" : "fill-primary"}
              rx={1}
            >
              <title>{`${b.from.toFixed(2)}-${b.to.toFixed(2)}: ${b.count} turns`}</title>
            </rect>
          );
        })}

        <line
          x1={thresholdX}
          x2={thresholdX}
          y1={padding.top}
          y2={padding.top + innerH}
          className="stroke-destructive"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
        <text
          x={Math.min(thresholdX + 5, width - padding.right - 4)}
          y={padding.top + 10}
          fontSize={10}
          className="fill-destructive"
        >
          floor {threshold}
        </text>

        {[0, 0.25, 0.5, 0.75, 1].map((s) => (
          <text
            key={s}
            x={xFor(s).toFixed(2)}
            y={height - 8}
            fontSize={10}
            textAnchor="middle"
            fill="currentColor"
            opacity={0.55}
          >
            {s.toFixed(2)}
          </text>
        ))}
      </svg>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Best score per turn, bucketed. The dashed line is the live{" "}
        <code className="font-mono">AI_KB_SEARCH_MIN_SCORE</code> ({threshold}).{" "}
        {total > 0 ? (
          <>
            {cut} of {total} turns ({Math.round((cut / total) * 100)}%) sit below it and reached the
            prompt only through the widen-on-empty retry. Bars just above the line are what a higher
            floor would cut next.
          </>
        ) : (
          <>No scored turns in this window yet.</>
        )}
      </p>
    </div>
  );
}
