// Inline-form construction for the reply graph.
//
// An integration tool declares its inputs as JSON Schema. Rather than have the
// model ask for each field in chat (slow, error-prone, and easy to get wrong for
// non-idempotent actions like booking or refunds), we render the schema as a
// single form block the widget collects in one submit.

import type { MessageBlock } from "../../../types/messageBlocks.js";

// Fields the system fills server-side, or that flow through another UI (booking
// slot cards) — never surfaced in a form.
const FORM_SKIP_FIELDS = new Set([
  "email", "contactEmail", "organizationId", "timeZone", "_transcript",
  "_enforceProjectKey", "projectKey", "eventTypeId", "startTime", "currentPlan",
  // NOTE: the attendee `name` for book_meeting is intentionally NOT skipped. It is
  // required by the Cal.com schema and by the "require a real attendee name"
  // guardrail, but the system does not reliably have it (ContactSession.name is
  // usually empty). Skipping it meant the guardrail blocked every booking; letting
  // the auto-form collect it when absent is what makes named-attendee booking work.
]);

// "orderId" → "Order Id", "order_number" → "Order Number".
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

// Build an inline FormBlock from an integration tool's JSON schema so the widget
// can collect all its inputs at once (request_form). Fields the system injects
// server-side (email, timezone, internal keys) are skipped — the customer only
// sees the inputs they actually need to provide.
export function buildFormBlock(
  toolKey: string,
  schema: unknown,
  title?: unknown,
  onlyKeys?: string[],
  carryArgs?: Record<string, unknown>,
  // Custom webhooks define their own input schema — every field is one the operator
  // wants collected, so we do NOT strip the system-injected field names (email,
  // timeZone, …) that only apply to built-in tools.
  skipSystemFields = true,
): MessageBlock | null {
  const s = schema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  if (!s || typeof s.properties !== "object" || s.properties === null) return null;
  const required = new Set(s.required ?? []);
  const onlySet = onlyKeys ? new Set(onlyKeys) : null;
  const fields = Object.entries(s.properties)
    .filter(([key]) => (!skipSystemFields || !FORM_SKIP_FIELDS.has(key)) && (!onlySet || onlySet.has(key)))
    .map(([key, raw]) => {
      const p = (raw ?? {}) as {
        description?: string; enum?: unknown[]; format?: string; type?: string;
        minimum?: number; maximum?: number; pattern?: string;
      };
      const isEnum = Array.isArray(p.enum) && p.enum.length > 0;
      // Booleans must be a fixed Yes/No choice, not a free-text box — otherwise the
      // customer types something like "5" that can't coerce to a boolean and the
      // submit fails schema validation ("Submission failed"). Enums render as a
      // select of their allowed values.
      const isBool = p.type === "boolean";
      const isSelect = isEnum || isBool;
      // Numeric fields become a number input (with integer step / min / max) so the
      // customer can only enter a value the schema will accept — the form enforces
      // the tool's declared datatypes client-side, not just at submit.
      const isInteger = p.type === "integer";
      const isNumber = p.type === "number" || isInteger;
      const fieldType: "text" | "email" | "tel" | "select" | "textarea" | "number" =
        isSelect ? "select" : isNumber ? "number" : p.format === "email" || p.type === "email" ? "email" : "text";
      const options = isEnum
        ? p.enum!.map((v) => ({ label: String(v), value: String(v) }))
        : isBool
          ? [{ label: "Yes", value: "true" }, { label: "No", value: "false" }]
          : undefined;
      return {
        key,
        label: humanizeKey(key),
        type: fieldType,
        placeholder: p.description,
        required: required.has(key),
        ...(options ? { options } : {}),
        ...(isNumber
          ? {
              ...(typeof p.minimum === "number" ? { min: p.minimum } : {}),
              ...(typeof p.maximum === "number" ? { max: p.maximum } : {}),
              ...(isInteger ? { step: 1, integer: true } : {}),
            }
          : {}),
        ...(!isNumber && !isSelect && typeof p.pattern === "string" ? { pattern: p.pattern } : {}),
      };
    });
  if (fields.length === 0) return null;
  // Carry forward args the model already resolved (e.g. eventTypeId/startTime for a
  // booking) that aren't shown as fields, so the widget re-submits them and the
  // tool's full schema validates on the inline-form POST.
  const visibleKeys = new Set(fields.map((f) => f.key));
  const hiddenValues: Record<string, string> = {};
  if (carryArgs) {
    for (const [k, v] of Object.entries(carryArgs)) {
      if (visibleKeys.has(k)) continue;
      if (v === undefined || v === null) continue;
      const str = String(v).trim();
      if (!str || /^\[[A-Z_]+\]$/.test(str)) continue; // skip empty / masked "[PLACEHOLDER]"
      hiddenValues[k] = str;
    }
  }
  return {
    type: "form",
    title: title ? String(title) : "Please provide a few details",
    fields,
    submitLabel: "Submit",
    toolKey,
    ...(Object.keys(hiddenValues).length > 0 ? { hiddenValues } : {}),
  };
}

// Required fields the customer still needs to provide for a tool — i.e. required,
// absent from the args, and not a field the system injects or collects elsewhere
// (email, booking slot/eventType, etc.). Used to auto-show a form instead of
// dispatching with missing/guessed values.
export function missingCustomerFields(schema: unknown, args: Record<string, unknown>): string[] {
  const s = schema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  if (!s || !Array.isArray(s.required) || typeof s.properties !== "object" || s.properties === null) return [];
  return s.required.filter((key) => {
    if (FORM_SKIP_FIELDS.has(key)) return false;
    if (!(key in s.properties!)) return false;
    const v = args[key];
    if (v === undefined || v === null) return true;
    const str = String(v).trim();
    return str === "" || /^\[[A-Z_]+\]$/.test(str); // empty or a "[PLACEHOLDER]"
  });
}
