"use client";

// Click-to-highlight for plan grids. Wraps a set of plan cards (each marked with
// `data-plan-card`) and, on click, rings the selected card and clears the others.
// Uses event delegation so it works with server-rendered card children (pricing,
// billing) as well as client ones (checkout) — no per-card state needed.

import { useRef } from "react";

const RING = ["ring-2", "ring-primary", "ring-offset-2", "ring-offset-background"];

export function PlanHighlighter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const root = ref.current;
    if (!root) return;
    const card = (e.target as HTMLElement).closest("[data-plan-card]");
    if (!card || !root.contains(card)) return;
    root.querySelectorAll("[data-plan-card]").forEach((el) => el.classList.remove(...RING));
    card.classList.add(...RING);
  }

  return (
    <div ref={ref} className={className} onClick={handleClick}>
      {children}
    </div>
  );
}
