// This package exists to call providers. Its TESTS must not.
//
// The harness's production path deliberately spends money — embeddings, an
// answering model, a judge. That makes its test suite the one with the most to
// lose from a stray call, and the one where "we always mock it" is least
// trustworthy as a guarantee.

import { describe, expect, it } from "vitest";
import { ExternalCallInTestError, GUARDED_CREDENTIALS } from "@api/test/no-external-calls.js";

describe("the eval harness's tests reach no provider", () => {
  it.each([
    "https://openrouter.ai/api/v1/chat/completions",
    "https://api.openai.com/v1/embeddings",
    "https://api.pinecone.io/query",
  ])("refuses %s", async (url) => {
    await expect(fetch(url)).rejects.toBeInstanceOf(ExternalCallInTestError);
  });

  it.each([...GUARDED_CREDENTIALS])("%s is absent", (key) => {
    expect(process.env[key], `${key} leaked into the eval test environment`).toBeUndefined();
  });
});
