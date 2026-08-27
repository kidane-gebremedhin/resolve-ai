// PII patterns used to mask sensitive data before logging tool call args.
// Extended in Plan 18 with SSN, NI number, and other patterns.
const PII_PATTERNS: [RegExp, string][] = [
  // Email addresses
  [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL]"],
  // Credit card numbers (13-19 digits, optionally separated)
  [/\b(?:\d[ -]?){13,19}\b/g, "[CARD]"],
  // Phone numbers (various formats)
  [/\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[PHONE]"],
  // SSN (US)
  [/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, "[SSN]"],
  // NI number (UK)
  [/\b[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/gi, "[NI]"],
];

export function maskPii(value: string): string;
export function maskPii(value: Record<string, unknown>): Record<string, unknown>;
export function maskPii(value: unknown): unknown {
  if (typeof value === "string") {
    let result = value;
    for (const [pattern, replacement] of PII_PATTERNS) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = (maskPii as (value: unknown) => unknown)(v);
    }
    return out;
  }

  return value;
}
