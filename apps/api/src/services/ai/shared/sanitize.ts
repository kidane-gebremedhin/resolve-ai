// Result/schema sanitisation for the reply graph.

/**
 * OpenAI/OpenRouter reject the ENTIRE tools array if any single function's
 * `parameters` isn't a valid JSON Schema of type "object" — one malformed
 * integration tool (e.g. a custom webhook where the operator pasted a sample
 * response instead of a schema) would then 400 every reply, forcing a toolless
 * fallback where the model hallucinates actions it can't perform. Coerce each
 * tool's schema to a safe object schema so a bad definition can never poison the
 * whole request; the worst case is that one tool accepts loosely-typed args.
 */
export function safeToolParameters(schema: unknown): Record<string, unknown> {
  const s = schema as { type?: unknown; properties?: unknown } | null | undefined;
  if (s && typeof s === "object" && s.type === "object" && typeof s.properties === "object" && s.properties !== null) {
    return s as Record<string, unknown>;
  }
  return { type: "object", properties: {}, required: [] };
}

/**
 * Recursively drop any `url`/`browseUrl` keys from a tool result before the model
 * sees it — used for ticket creation so the AI can never surface an internal
 * "track it here" link to the customer. The full result is still logged for audit
 * (integration tools log inside the dispatcher, independently of this).
 */
export function stripUrlKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUrlKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "url" || k === "browseUrl") continue;
      out[k] = stripUrlKeys(v);
    }
    return out;
  }
  return value;
}
