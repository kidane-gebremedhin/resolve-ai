// Guard: the harness must measure production, not a copy of it.
//
// The failure mode this prevents is gradual and invisible. Someone hits an
// awkward dependency, calls Pinecone directly "just for the eval", and from
// that moment the numbers describe a pipeline no customer ever touches. The
// harness keeps reporting, the graphs keep moving, and they mean nothing.
//
// So the rule is mechanical: retrieval comes from `searchKb`, generation from
// `generateAiReply`, and no module here may reach for an embedding client, a
// vector store, or a prompt builder of its own.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : sourceFiles(full);
    return e.name.endsWith(".ts") ? [full] : [];
  });
}

const files = sourceFiles(SRC);
const sources = files.map((f) => ({ file: path.relative(SRC, f), text: readFileSync(f, "utf8") }));
const all = sources.map((s) => s.text).join("\n");

describe("the harness measures production", () => {
  it("retrieves through searchKb", () => {
    expect(all).toContain("searchKb");
  });

  it("generates through generateAiReply", () => {
    expect(all).toContain("generateAiReply");
  });

  const FORBIDDEN: [RegExp, string][] = [
    [/@pinecone-database|from ["']pinecone/i, "talks to the vector store directly"],
    [/embedding\.service|embedQuery|createEmbedding/i, "embeds queries itself"],
    [/buildSystemPrompt|prompts\.js|prompts\.ts/i, "builds its own answering prompt"],
    [/getReplyGraph|agent\.graph/i, "drives the graph directly instead of via generateAiReply"],
  ];

  for (const [pattern, why] of FORBIDDEN) {
    it(`no module ${why}`, () => {
      const offenders = sources.filter((s) => pattern.test(s.text)).map((s) => s.file);
      expect(offenders, `${offenders.join(", ")} ${why}`).toEqual([]);
    });
  }

  it("builds every model through the shared factory", () => {
    // `createChatModel` exists because the umbrella ChatOpenAI class 404s on
    // newer OpenRouter model ids. A fresh client here would reintroduce that.
    const constructsOwnClient = sources.filter((s) =>
      /new\s+(ChatOpenAI|ChatAnthropic|OpenAI)\s*\(/.test(s.text),
    );
    expect(constructsOwnClient.map((s) => s.file)).toEqual([]);
    // Every model call reaches the provider through the API: either the factory
    // directly, or the shared judge, which uses it. The harness no longer
    // constructs the judge's model itself — online faithfulness sampling scores
    // production turns with the same judge, and two copies of it would make the
    // online and offline numbers incomparable the first time one was edited.
    expect(all).toMatch(/createChatModel|@api\/services\/ai\/eval\/judge/);
  });

  it("uses the shared judge rather than a local copy of its prompt", () => {
    const definesOwnJudgePrompt = sources.filter((s) =>
      /You are a strict evaluator/.test(s.text),
    );
    expect(definesOwnJudgePrompt.map((s) => s.file)).toEqual([]);
    expect(all).toContain("@api/services/ai/eval/judge.js");
  });
});
