"use client";

// Pure-SVG bar chart with light grid lines and a sparse x-axis label every
// `labelEvery` (default 5) points. Designed for short daily series (~30 days).
import React from "react";

export type BarChartPoint = { date: string; value: number };

export function BarChart({
  points,
  color = "currentColor",
  height = 180,
  width = 720,
  labelEvery = 5,
  className,
  valueLabel,
}: {
  points: BarChartPoint[];
  color?: string;
  height?: number;
  width?: number;
  labelEvery?: number;
  className?: string;
  valueLabel?: string;
}) {
  const padding = { top: 8, right: 8, bottom: 22, left: 28 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(1, ...points.map((p) => p.value));
  const n = Math.max(1, points.length);
  const barGap = 2;
  const barW = Math.max(1, innerW / n - barGap);

  // 4 horizontal grid lines (incl. baseline)
  const gridLines = [0.25, 0.5, 0.75, 1];

  function formatDay(iso: string): string {
    // "YYYY-MM-DD" -> "M/D"
    const parts = iso.split("-");
    if (parts.length !== 3) return iso;
    return `${Number(parts[1])}/${Number(parts[2])}`;
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label={valueLabel ? `Bar chart: ${valueLabel}` : "Bar chart"}
    >
      {/* gridlines */}
      {gridLines.map((g) => {
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

      {/* y-axis max label */}
      <text
        x={padding.left - 4}
        y={padding.top + 8}
        fontSize={10}
        textAnchor="end"
        fill="currentColor"
        opacity={0.55}
      >
        {max.toLocaleString()}
      </text>
      <text
        x={padding.left - 4}
        y={padding.top + innerH}
        fontSize={10}
        textAnchor="end"
        fill="currentColor"
        opacity={0.55}
      >
        0
      </text>

      {/* bars */}
      {points.map((p, i) => {
        const h = (p.value / max) * innerH;
        const x = padding.left + i * (innerW / n) + barGap / 2;
        const y = padding.top + innerH - h;
        return (
          <rect
            key={p.date + i}
            x={x.toFixed(2)}
            y={y.toFixed(2)}
            width={barW.toFixed(2)}
            height={Math.max(0, h).toFixed(2)}
            fill={color}
            rx={1}
          >
            <title>{`${p.date}: ${p.value.toLocaleString()}`}</title>
          </rect>
        );
      })}

      {/* x-axis labels (sparse) */}
      {points.map((p, i) => {
        if (i % labelEvery !== 0 && i !== points.length - 1) return null;
        const x = padding.left + i * (innerW / n) + barW / 2;
        return (
          <text
            key={`l-${p.date}-${i}`}
            x={x.toFixed(2)}
            y={height - 6}
            fontSize={10}
            textAnchor="middle"
            fill="currentColor"
            opacity={0.55}
          >
            {formatDay(p.date)}
          </text>
        );
      })}
    </svg>
  );
}
