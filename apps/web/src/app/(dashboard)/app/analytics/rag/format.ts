// Formatting shared by the RAG Quality panels.
//
// One rule runs through all of it: **null is not zero**. A metric with no data
// renders as an em-less dash, never as "0%" — the whole point of the null-vs-zero
// discipline in __specs/39 is lost the moment the UI paints them the same.

export const NO_DATA = "--";

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return NO_DATA;
  return `${(v * 100).toFixed(digits)}%`;
}

export function num(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return NO_DATA;
  return v.toFixed(digits);
}

export function ms(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return NO_DATA;
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
}

export function usd(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || Number.isNaN(v)) return NO_DATA;
  return `$${v.toFixed(digits)}`;
}

export function count(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return NO_DATA;
  return v.toLocaleString();
}

/**
 * A period-over-period delta badge, or null when there is nothing to compare.
 *
 * A change that rounds away at display precision is reported as "no change"
 * rather than as a signed zero. "-0.00" and "-0%" read as a real movement in a
 * direction, which is exactly the wrong thing to tell an operator watching for
 * a regression.
 */
export function deltaBadge(
  v: number | null | undefined,
  fmt: (n: number) => string,
): { text: string; raw: number } | null {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  const magnitude = fmt(Math.abs(v));
  if (/^0*$/.test(magnitude.replace(/\D/g, ""))) return { text: "no change", raw: 0 };
  return { text: `${v > 0 ? "+" : "-"}${magnitude}`, raw: v };
}
