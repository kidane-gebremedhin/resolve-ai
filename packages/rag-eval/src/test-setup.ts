/**
 * Test bootstrap.
 *
 * Some modules under test import production code that validates its environment
 * at module load (`apps/api/src/config/env.ts` throws on the first missing
 * variable). Loading the repository-root `.env` here keeps those imports
 * resolvable without any test needing to know about it.
 *
 * Placeholders fill in anything the root file lacks, so the suite runs on a
 * clean checkout.
 *
 * The root `.env` carries real provider keys, and this package's whole job in
 * production IS to call those providers — so its tests are the ones with the
 * most to lose from a stray call. The credentials are scrubbed and `fetch` is
 * guarded with the same module the API suite uses, rather than relying on the
 * convention that "every test that touches a model mocks it". That convention
 * held right up until it did not.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../../.env") });

const placeholders: Record<string, string> = {
  MONGODB_URI: "mongodb://placeholder-not-connected/rag-eval-test",
  JWT_SECRET: "test-secret-32-chars-long-xxxxxx",
  API_BASE_URL: "http://localhost:4000",
  CORS_ORIGINS: "http://localhost:3000",
  AI_MODEL: "openai/gpt-4o-mini",
  AI_TEMPERATURE: "0.2",
  AI_ENHANCE_TEMPERATURE: "0.3",
  AI_SUGGESTIONS_TEMPERATURE: "0.4",
  AI_KB_SEARCH_TOP_K: "8",
  AI_KB_SEARCH_MIN_SCORE: "0.2",
  AI_CONFIDENCE_THRESHOLD: "0.7",
  CREDENTIALS_ENCRYPTION_KEY: "0".repeat(64),
};
for (const [k, v] of Object.entries(placeholders)) process.env[k] ??= v;

// One implementation, shared with the API suite. Two copies of "which keys are
// dangerous" would drift the first time a provider was added.
const { installNetworkGuard, scrubProviderCredentials } = await import(
  "@api/test/no-external-calls.js"
);
scrubProviderCredentials();
installNetworkGuard();
