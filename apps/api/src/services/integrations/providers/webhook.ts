import Ajv from "ajv";
import type { ProviderAdapter, RawCredentials, ToolTemplate } from "./types.js";
import type { EncryptedBlob } from "../../security/crypto.service.js";
import { assertSafeUrl } from "../ssrf.js";
import { env } from "../../../config/env.js";

// coerceTypes so numeric/boolean args arriving as strings validate and are coerced
// to the right JS type before the HTTP call. Inline-form submissions send every
// field as a string (the widget's text inputs), so a webhook whose schema declares
// `quantity: number` or `expedited: boolean` would otherwise fail validation with
// "must be number" and surface "Submission failed" to the customer.
// strict:false so a schema using a standard `format` keyword doesn't throw at
// compile time (we don't register ajv-formats).
const ajv = new Ajv({ allErrors: true, coerceTypes: true, strict: false });

// Guarantee the input schema is actually enforced at call time. Operators (or older
// connections created before schemas were hardened at save time) may store an object
// schema that declares `properties` but no `required` list — ajv would then accept a
// call missing every input, letting the model "skip" the schema. When a schema declares
// properties but no non-empty `required`, require ALL of them so the inputs are validated,
// not guessed. An explicit non-empty `required` is respected as authored.
function enforceableSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const props = schema.properties;
  const hasProps =
    props && typeof props === "object" && !Array.isArray(props) && Object.keys(props).length > 0;
  const required = schema.required;
  const hasRequired = Array.isArray(required) && required.length > 0;
  if (hasProps && !hasRequired) {
    return { ...schema, required: Object.keys(props as Record<string, unknown>) };
  }
  return schema;
}

export class WebhookAdapter implements ProviderAdapter {
  readonly provider = "webhook";

  buildAuthUrl(_orgId: string, _state: string): string | null {
    return null;
  }

  async exchangeCode(_code: string, _orgId: string): Promise<RawCredentials> {
    throw new Error("Webhook provider does not support OAuth code exchange.");
  }

  async refreshTokens(_blob: EncryptedBlob): Promise<RawCredentials | null> {
    return null;
  }

  // "Test connection" for a custom webhook. Previously the verify route had nothing to call for
  // webhooks and reported success unconditionally — even for a URL with no server behind it.
  // This calls the endpoint with its CONFIGURED method + auth and only reports success on an
  // actual 2xx response, so a non-existent endpoint (unreachable OR a URL that answers 4xx/5xx,
  // e.g. a wrong path returning 404) fails. Non-GET methods send a minimal `{}` JSON body — the
  // test does invoke the endpoint (that's the point: it must return success), so operators should
  // expect a test request to arrive.
  async verifyCredentials(
    credentials: RawCredentials,
    _sandbox: boolean,
  ): Promise<{ ok: boolean; error?: string }> {
    const { url, method, authHeader, authValue } = (credentials.extra ?? {}) as {
      url?: string;
      method?: string;
      authHeader?: string;
      authValue?: string;
    };
    if (!url) return { ok: false, error: "No endpoint URL is configured for this environment." };
    try {
      await assertSafeUrl(url);
    } catch {
      return { ok: false, error: "The endpoint URL isn't allowed (use a public http(s) address)." };
    }
    const httpMethod = (method ?? "POST").toUpperCase();
    const headers: Record<string, string> = {};
    if (authHeader && authValue) headers[authHeader] = authValue;
    let body: string | undefined;
    if (httpMethod !== "GET" && httpMethod !== "HEAD") {
      headers["Content-Type"] = "application/json";
      body = "{}";
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.webhookTimeoutMs);
    try {
      const res = await fetch(url, { method: httpMethod, headers, body, signal: controller.signal, redirect: "follow" });
      if (res.ok) return { ok: true }; // 2xx from the real endpoint
      // Reachable but did NOT return success — surface why so the operator can fix it.
      const reason =
        res.status === 401 || res.status === 403
          ? "the endpoint rejected the request — check the auth header/value"
          : res.status === 404
            ? "the endpoint URL was not found (HTTP 404)"
            : res.status === 405
              ? "the endpoint doesn't allow this method (HTTP 405)"
              : res.status >= 500
                ? `the endpoint returned a server error (HTTP ${res.status})`
                : `the endpoint returned HTTP ${res.status}`;
      return { ok: false, error: `Connection test failed — ${reason}.` };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return { ok: false, error: "The endpoint didn't respond in time — check the URL." };
      }
      return { ok: false, error: "Couldn't reach the endpoint — check the URL is correct and publicly reachable." };
    } finally {
      clearTimeout(timer);
    }
  }

  getTools(): ToolTemplate[] {
    // Tool definitions for webhooks are created dynamically per-connection.
    return [];
  }

  async execute(
    _toolKey: string,
    args: Record<string, unknown>,
    credentials: RawCredentials,
    _sandbox: boolean,
  ): Promise<unknown> {
    const { url, method, authHeader, authValue, inputSchema, outputSchema } =
      (credentials.extra ?? {}) as {
        url?: string;
        method?: string;
        authHeader?: string;
        authValue?: string;
        inputSchema?: Record<string, unknown>;
        outputSchema?: Record<string, unknown>;
      };

    if (!url) throw new Error("Webhook: missing url in credentials");

    // SSRF guard
    await assertSafeUrl(url);

    // Validate args against inputSchema if provided. Surface WHICH fields are wrong
    // in plain language (not the raw ajv error objects) so the model can ask the
    // customer for the right value instead of echoing internals or looping.
    if (inputSchema) {
      const validate = ajv.compile(enforceableSchema(inputSchema));
      if (!validate(args)) {
        const problems = (validate.errors ?? [])
          .map((e) => {
            const field = (e.instancePath || "").replace(/^\//, "") ||
              (e.params as { missingProperty?: string })?.missingProperty || "input";
            return `${field} ${e.message ?? "is invalid"}`;
          })
          .slice(0, 5)
          .join("; ");
        throw new Error(`The details provided don't match what this tool needs: ${problems}.`);
      }
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authHeader && authValue) {
      headers[authHeader] = authValue;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.webhookTimeoutMs);

    const httpMethod = (method ?? "POST").toUpperCase();
    // GET/HEAD cannot carry a body — encode args as query params instead. Other
    // methods send args as a JSON body.
    let requestUrl = url;
    let body: string | undefined;
    if (httpMethod === "GET" || httpMethod === "HEAD") {
      const u = new URL(url);
      for (const [k, v] of Object.entries(args)) {
        u.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
      }
      requestUrl = u.toString();
    } else {
      body = JSON.stringify(args);
    }

    let result: unknown;
    try {
      const res = await fetch(requestUrl, {
        method: httpMethod,
        headers,
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        // 4xx = the request was wrong (bad/expired auth, missing field); 5xx/timeout =
        // the operator's endpoint is down. Give the model a clear, customer-safe reason
        // without leaking the endpoint's raw error body.
        const reason =
          res.status === 401 || res.status === 403
            ? "the integration rejected the request (check the connection's auth)"
            : res.status === 404
              ? "the integration endpoint was not found"
              : res.status >= 500
                ? "the integration service is temporarily unavailable"
                : `the integration returned an error (HTTP ${res.status})`;
        throw new Error(`Could not complete that action — ${reason}.`);
      }

      // Enforce max response size (100 kB)
      const text = await res.text();
      if (text.length > 102_400) {
        throw new Error("The integration returned too much data to process.");
      }

      // Tolerate endpoints that reply with a non-JSON body (plain text / empty 200).
      // Wrap it so the model still gets a usable, truthful result instead of an
      // opaque parse crash it might paper over with a hallucinated answer.
      const trimmed = text.trim();
      if (!trimmed) {
        result = { ok: true };
      } else {
        try {
          result = JSON.parse(trimmed);
        } catch {
          result = { ok: true, message: trimmed.slice(0, 2_000) };
        }
      }
    } catch (err) {
      // Turn an aborted fetch (timeout) into a clear message rather than a raw
      // "The operation was aborted" DOM error.
      if ((err as Error).name === "AbortError") {
        throw new Error("The integration took too long to respond and timed out.");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    // Validate response against outputSchema if provided
    if (outputSchema && result !== undefined) {
      const validate = ajv.compile(outputSchema);
      if (!validate(result)) {
        throw new Error("The integration returned an unexpected response format.");
      }
    }

    return result;
  }
}
