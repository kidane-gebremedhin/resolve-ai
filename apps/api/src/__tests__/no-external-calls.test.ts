// The guarantee that tests cost nothing, asserted rather than intended.
//
// Every other test file in this suite is only free because of what
// `test/setup.ts` does before it loads. That is exactly the kind of guarantee
// that quietly stops holding — a new service reads a new env var, someone adds
// a `.env` key, and six months later the suite is billing someone on every CI
// run. So the guard checks itself here.

import { describe, expect, it } from "vitest";
import {
  ALLOWED_TEST_HOSTS,
  ExternalCallInTestError,
  GUARDED_CREDENTIALS,
} from "../test/no-external-calls.js";
import { getPineconeIndex } from "../config/pinecone.js";
import { embed } from "../services/ai/embedding.service.js";
import { env } from "../config/env.js";

describe("tests cannot reach a third party", () => {
  it.each([
    "https://openrouter.ai/api/v1/chat/completions",
    "https://api.openai.com/v1/embeddings",
    "https://api.pinecone.io/rerank",
    "https://api.firecrawl.dev/v1/crawl",
    "https://api.paddle.com/transactions",
    "https://example.com/",
  ])("refuses %s", async (url) => {
    await expect(fetch(url)).rejects.toBeInstanceOf(ExternalCallInTestError);
  });

  it("names the URL and how to stub it, so the failure is actionable", async () => {
    // A test that fails with "fetch failed" sends its author looking for a
    // network problem. This one has to say what to do.
    const err = await fetch("https://openrouter.ai/api/v1/chat/completions").catch((e) => e);
    expect(String(err.message)).toContain("https://openrouter.ai/api/v1/chat/completions");
    expect(String(err.message)).toContain("vi.mock");
    expect(String(err.message)).toContain("cost nothing");
  });

  it("still allows the loopback, which is where the test server lives", () => {
    for (const host of ["localhost", "127.0.0.1", "::1"]) {
      expect(ALLOWED_TEST_HOSTS.has(host)).toBe(true);
    }
  });

  it("leaves a relative URL to fail on its own terms", async () => {
    // Not our business, and swallowing it would disguise a real bug as a
    // network-policy violation.
    await expect(fetch("/api/v1/health")).rejects.not.toBeInstanceOf(ExternalCallInTestError);
  });
});

describe("no provider credential survives into a test", () => {
  it.each([...GUARDED_CREDENTIALS])("%s is absent", (key) => {
    // Absent, not blank: several call sites read `process.env.X ?? "fallback"`,
    // where an empty string is not nullish and would still be sent as a key.
    expect(process.env[key], `${key} leaked into the test environment`).toBeUndefined();
  });

  it("scrubs the developer's real .env, not just a clean checkout", () => {
    // The repo's `.env` is symlinked into apps/api and IS loaded by dotenv
    // under vitest. If this ever passes for the wrong reason — because no .env
    // exists — the assertion below still holds, but the one above is what
    // catches a live key.
    expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
    expect(process.env.EMBEDDING_API_KEY).toBeUndefined();
  });

  it("turns off tracing, which ships conversation content off the box", () => {
    expect(env.langsmith.enabled).toBe(false);
  });
});

describe("providers take their no-key path instead of failing", () => {
  it("embeds deterministically without a provider", async () => {
    // The fallback has to actually work, or every ingestion test would be
    // asserting against an exception rather than against behaviour.
    const [a, b] = await embed(["refund policy", "refund policy"]);
    expect(a).toHaveLength(1536);
    expect(a).toEqual(b);
    expect(a!.some((v) => v !== 0)).toBe(true);
  });

  it("hands back a no-op vector index rather than a live one", async () => {
    const index = getPineconeIndex();
    // Tolerates every operation and reaches nothing.
    await expect(index.upsert([{ id: "x:0", values: [0.1], metadata: {} }])).resolves.toBeUndefined();
    await expect(index.deleteMany(["x:0"])).resolves.toBeUndefined();
    await expect(index.query({ vector: [0.1], topK: 3, filter: {} })).resolves.toEqual({ matches: [] });
  });
});
