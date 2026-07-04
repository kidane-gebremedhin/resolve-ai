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

export interface ProviderAdapter {
  readonly provider: string;

  /** Returns an OAuth authorization URL, or null for non-OAuth auth modes. */
  buildAuthUrl(orgId: string, state: string): string | null;

  /** Exchanges an OAuth code for raw credentials. */
  exchangeCode(code: string, orgId: string): Promise<RawCredentials>;

  /** Refreshes an OAuth access token. Returns null if not supported or failed. */
  refreshTokens(blob: EncryptedBlob): Promise<RawCredentials | null>;

  /** Returns the tool definitions this provider exposes. */
  getTools(): ToolTemplate[];

  /** Executes a tool call and returns the result. */
  execute(
    toolKey: string,
    args: Record<string, unknown>,
    credentials: RawCredentials,
    sandbox: boolean,
  ): Promise<unknown>;
}
