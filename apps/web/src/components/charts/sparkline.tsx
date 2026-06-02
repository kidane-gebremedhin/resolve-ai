"use client";

// Pure-SVG sparkline. No external deps; safe to render inside server components
// because we only mark it "use client" to enable defensive `currentColor` use.
import React from "react";

export type SparklinePoint = { date: string; value: number };

export function Sparkline({
  points,
  color = "currentColor",
  height = 48,
  width = 240,
  strokeWidth = 1.5,
  className,
}: {
  points: SparklinePoint[];
  color?: string;
  height?: number;
  width?: number;
  strokeWidth?: number;
  className?: string;
}) {
  if (points.length === 0) {
    return <svg viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden />;
  }
  const max = Math.max(1, ...points.map((p) => p.value));
  const stepX = points.length > 1 ? width / (points.length - 1) : width;
  const yFor = (v: number) => height - (v / max) * (height - 2) - 1;
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(2)},${yFor(p.value).toFixed(2)}`)
    .join(" ");
  const areaPath = `${path} L${width.toFixed(2)},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      className={className}
      role="img"
      aria-label="Sparkline chart"
    >
      <path d={areaPath} fill={color} opacity={0.12} />
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
