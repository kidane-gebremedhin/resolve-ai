import Ajv from "ajv";
import type { ProviderAdapter, RawCredentials, ToolTemplate } from "./types.js";
import type { EncryptedBlob } from "../../security/crypto.service.js";
import { assertSafeUrl } from "../ssrf.js";
import { env } from "../../../config/env.js";

const ajv = new Ajv({ allErrors: true, coerceTypes: false });

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

    // Validate args against inputSchema if provided
    if (inputSchema) {
      const validate = ajv.compile(inputSchema);
      if (!validate(args)) {
        throw new Error(
          `Webhook: args failed schema validation: ${JSON.stringify(validate.errors)}`,
        );
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
        throw new Error(`Webhook: upstream returned ${res.status}`);
      }

      // Enforce max response size (100 kB)
      const text = await res.text();
      if (text.length > 102_400) {
        throw new Error("Webhook: response exceeds 100 kB limit");
      }

      result = JSON.parse(text);
    } finally {
      clearTimeout(timer);
    }

    // Validate response against outputSchema if provided
    if (outputSchema && result !== undefined) {
      const validate = ajv.compile(outputSchema);
      if (!validate(result)) {
        throw new Error(
          `Webhook: response failed output schema validation: ${JSON.stringify(validate.errors)}`,
        );
      }
    }

    return result;
  }
}
