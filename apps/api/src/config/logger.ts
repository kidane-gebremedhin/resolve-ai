import winston from "winston";
import { env } from "./env.js";

// Log redaction (__specs/12 §5.6, §10).
//
// Logs are shipped, aggregated and retained, and every one of those is a place
// a secret can outlive the request that carried it. The formatter below runs
// over every log entry's metadata and replaces the VALUE of any field whose
// NAME looks like a credential or a piece of personal data.
//
// Keyed on the field name rather than on the value's shape on purpose. Pattern
// matching a value ("does this look like a JWT?") fails open on anything the
// pattern did not anticipate; a name-based rule fails CLOSED — an unfamiliar
// field called `apiSecret` is redacted because of what it is called, without
// anyone having to predict its format.
//
// This is the last line, not the first. Call sites should still avoid logging
// secrets, and `services/integrations/piiMask.ts` masks customer text before it
// is ever persisted. This catches what those miss.

/** Field names whose values never belong in a log. */
const REDACTED_KEY = /^(.*_)?(password|passwordhash|secret|token|apikey|api_key|authorization|cookie|credential|privatekey|private_key|accesstoken|refreshtoken|clientsecret|webhooksecret|totpsecret|recoverycode)s?$/i;

/** Personal data that is fine to hold in the database and not in a log. */
const PII_KEY = /^(email|phone|phonenumber|ssn|creditcard|card|cardnumber|iban)s?$/i;

export const REDACTED = "[REDACTED]";

/**
 * Deep-redact a log payload.
 *
 * Depth- and breadth-limited: a formatter that can be made to recurse forever
 * by a cyclic or enormous object turns a log line into an outage.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 6) return "[Object]";
  if (value === null || typeof value !== "object") return value;

  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((v) => redact(v, depth + 1, seen));
  }
  // Errors are logged for their message and stack, and carry no fields to walk.
  if (value instanceof Error) return value.message;
  if (value instanceof Date) return value.toISOString();

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_KEY.test(key)) {
      out[key] = REDACTED;
    } else if (PII_KEY.test(key)) {
      // Keep enough to correlate a support report, not enough to identify.
      out[key] = typeof v === "string" && v.length > 0 ? `${REDACTED}(${v.length})` : REDACTED;
    } else {
      out[key] = redact(v, depth + 1, seen);
    }
  }
  return out;
}

/**
 * MUTATES `info` rather than returning a new object.
 *
 * This is not a style choice. Winston carries the level and the rendered
 * message on SYMBOL keys (`Symbol.for("level")`, `Symbol.for("message")`), and
 * a formatter that rebuilds the object from its string keys silently drops
 * them. The transport then has nothing to print and the process logs NOTHING —
 * no error, no warning, just silence. Returning the same object keeps the
 * symbols attached.
 */
const redactionFormat = winston.format((info) => {
  const { level: _level, message: _message, timestamp: _timestamp, ...meta } = info;
  const cleaned = redact(meta) as Record<string, unknown>;
  for (const key of Object.keys(meta)) delete (info as Record<string, unknown>)[key];
  Object.assign(info, cleaned);
  return info;
});

export const logger = winston.createLogger({
  level: env.nodeEnv === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    redactionFormat(),
    winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
});
