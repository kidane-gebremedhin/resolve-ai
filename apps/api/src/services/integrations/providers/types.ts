import type { EncryptedBlob } from "../../security/crypto.service.js";

export type RawCredentials = {
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  /** Unix timestamp (seconds) */
  expiresAt?: number;
  extra?: Record<string, unknown>;
};

export type ToolTemplate = {
  key: string;
  displayName: string;
  description: string;
  /** JSON Schema for the tool's arguments */
  jsonSchema: Record<string, unknown>;
};

/**
 * The per-organization OAuth *application* credentials (client_id / client_secret)
 * an operator registered for a provider. Passed into the OAuth adapter methods so
 * each operator uses their own app instead of a single set hardcoded in the server
 * environment. `null`/`undefined` means the operator hasn't configured an app yet.
 */
export type OAuthAppCreds = {
  clientId: string;
  /** Optional — apps configured with only a Client ID (or PKCE / platform-supplied
   *  secret) leave this unset; adapters that need it send it when present. */
  clientSecret?: string;
  /** Optional redirect-URI override registered with the provider. */
  redirectUri?: string;
  /** Non-secret provider extras (e.g. Shopify shop domain). */
  extra?: Record<string, unknown>;
};

export interface ProviderAdapter {
  readonly provider: string;

  /** Returns an OAuth authorization URL, or null for non-OAuth auth modes. */
  buildAuthUrl(orgId: string, state: string, app?: OAuthAppCreds | null): string | null;

  /** Exchanges an OAuth code for raw credentials. */
  exchangeCode(code: string, orgId: string, app?: OAuthAppCreds | null): Promise<RawCredentials>;

  /** Refreshes an OAuth access token. Returns null if not supported or failed. */
  refreshTokens(blob: EncryptedBlob, app?: OAuthAppCreds | null): Promise<RawCredentials | null>;

  /** Returns the tool definitions this provider exposes. */
  getTools(): ToolTemplate[];

  /** Executes a tool call and returns the result. */
  execute(
    toolKey: string,
    args: Record<string, unknown>,
    credentials: RawCredentials,
    sandbox: boolean,
  ): Promise<unknown>;

  /**
   * Optional: make a lightweight real API call to confirm the credentials work,
   * before a connection is marked active. Returns { ok: false, error } on failure.
   */
  verifyCredentials?(
    credentials: RawCredentials,
    sandbox: boolean,
  ): Promise<{ ok: boolean; error?: string }>;
}
