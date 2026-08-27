// Tests must cost nothing and must not depend on anyone else being up.
//
// Two layers, because either one alone is a promise rather than a guarantee:
//
//   1. SCRUB THE CREDENTIALS. `config/env.ts` imports `dotenv/config`, so a
//      developer's real `.env` — with live OpenRouter, embedding, Pinecone and
//      Firecrawl keys in it — is loaded under vitest. Every provider in this
//      codebase already has a no-key path (pseudo-embeddings, a no-op Pinecone
//      index, a disabled crawler), so removing the keys makes the suite take
//      those paths instead of billing someone.
//
//   2. BLOCK THE SOCKET ANYWAY. Layer 1 depends on every current and future
//      service checking for its key before it calls out. That is a convention,
//      and conventions are exactly what a test suite should not be resting on
//      when the failure mode is a bill. So `fetch` is wrapped and anything
//      leaving the machine throws with the URL that tried.
//
// The point of layer 2 is that it fails LOUDLY. A test that silently reaches a
// third party passes on a good day, fails when their credits run out, and its
// author finds out months later — which is how `knowledge-conflict.test.ts`
// came to depend on an OpenRouter balance.

// Load `.env` HERE, before the scrub below runs.
//
// `config/env.ts` also does `import "dotenv/config"`, and dotenv only fills in
// variables that are ABSENT. Scrubbing before it loads therefore accomplishes
// nothing: the delete makes each key absent, and dotenv then helpfully puts the
// developer's real key back. Forcing the load first means the module cache makes
// `config/env.ts`'s import a no-op, and a deleted key stays deleted.
import "dotenv/config";

/** Hosts a test may legitimately talk to: itself, and the in-memory Mongo. */
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/**
 * Credentials that turn a no-op into a billable call.
 *
 * Deleted rather than blanked: several call sites read
 * `process.env.X ?? "fallback"`, and an empty string is not nullish, so blanking
 * would hand the provider a key of `""` and still make the request.
 */
const PROVIDER_CREDENTIALS = [
  // LLM + embeddings
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "EMBEDDING_API_KEY",
  // Vector store
  "PINECONE_API_KEY",
  "PINECONE_INDEX",
  // Crawling
  "FIRECRAWL_API_KEY",
  // Voice
  "TTS_API_KEY",
  "STT_API_KEY",
  // Billing (the webhook SECRET is deliberately kept: it signs payloads
  // locally and reaches no network, and the billing tests need it)
  "PADDLE_API_KEY",
  // Object storage
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_S3_BUCKET",
  // Mail. Without a host the mailer takes its "not configured" path instead of
  // opening an SMTP connection, which `fetch` would never have caught.
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  // Telemetry that phones home
  "SENTRY_DSN",
  "LANGSMITH_API_KEY",
  // Messaging
  "TWILIO_AUTH_TOKEN",
  // Not a cost, but not local either: the default points at a docker-internal
  // hostname that does not resolve from a test process, so every run pays for a
  // DNS failure and a stack of connection warnings. The rate limiter has an
  // in-memory path; this makes the suite take it.
  "REDIS_URL",
] as const;

export class ExternalCallInTestError extends Error {
  constructor(public readonly url: string) {
    super(
      `Test tried to reach ${url}.\n\n` +
        "Tests must cost nothing and must pass with the network unplugged. Stub the\n" +
        "module that made this call, e.g.:\n\n" +
        '  vi.mock("../services/ai/llm/chat-model.js", () => ({ createChatModel: () => stub }));\n' +
        '  vi.mock("../config/pinecone.js", () => ({ getPineconeIndex: () => fakeIndex }));\n\n' +
        "See __specs/14-testing-strategy.md, \"No test may call a third party\".",
    );
    this.name = "ExternalCallInTestError";
  }
}

/** Every outbound URL the guard refused, for the meta-test that proves it works. */
export const blockedCalls: string[] = [];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// `RequestInfo` comes from the DOM lib, which this package does not include.
// Deriving the parameter types from `globalThis.fetch` keeps the wrapper exactly
// as typed as the thing it replaces.
type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as { url?: string }).url ?? String(input);
}

let installed = false;

/** Wrap `fetch` so anything leaving the machine throws instead of billing. */
export function installNetworkGuard(): void {
  if (installed) return;
  installed = true;

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
    const url = urlOf(input);
    const host = hostOf(url);
    // A relative or unparseable URL cannot leave the machine on its own; let
    // whatever is doing that fail on its own terms rather than on ours.
    if (host === null || ALLOWED_HOSTS.has(host)) {
      return realFetch(input, init);
    }
    blockedCalls.push(url);
    throw new ExternalCallInTestError(url);
  }) as typeof globalThis.fetch;
}

/** Remove every credential that would turn a no-op path into a billable call. */
export function scrubProviderCredentials(): void {
  for (const key of PROVIDER_CREDENTIALS) delete process.env[key];
  // Tracing is opt-in and ships conversation content off the box. Off, loudly.
  process.env.LANGSMITH_TRACING = "false";
  process.env.LANGCHAIN_TRACING_V2 = "false";
}

export const GUARDED_CREDENTIALS: readonly string[] = PROVIDER_CREDENTIALS;
export const ALLOWED_TEST_HOSTS: ReadonlySet<string> = ALLOWED_HOSTS;
