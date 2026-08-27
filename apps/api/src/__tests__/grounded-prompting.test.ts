// Grounded prompting: the context block, citation validation, and the controls
// they feed.
//
// The snapshot test is the important one and is meant to be READ, not just run.
// The context block is what the model sees and therefore what it can cite; a
// diff in it is a change to every reply the product produces, so it should
// require a human to look at the new text and agree with it.

import { describe, expect, it } from "vitest";
import {
  applyTokenBudget,
  assertVerbatim,
  buildContextBlock,
  dedupePassages,
  orderForAttention,
} from "../services/ai/context-block.js";
import {
  isFactualSentence,
  splitSentences,
  validateCitations,
} from "../services/ai/citation-validator.js";
import { buildSystemPrompt } from "../services/ai/prompts.js";
import type { KbHit } from "../services/kb/search.service.js";

const hit = (
  id: string,
  text: string,
  score: number,
  extra: Partial<KbHit> = {},
): KbHit => ({
  sourceId: `src-${id}`,
  sourceTitle: `Doc ${id}`,
  chunkIndex: 0,
  chunkId: `src-${id}:0`,
  text,
  score,
  ...extra,
});

describe("context block", () => {
  describe("deduplication", () => {
    it("collapses the same chunk retrieved by both legs, keeping the better score", () => {
      const { kept, removed } = dedupePassages([
        hit("a", "Refunds are issued within 30 days.", 0.4),
        hit("a", "Refunds are issued within 30 days.", 0.8),
      ]);
      expect(kept).toHaveLength(1);
      expect(kept[0]!.score).toBe(0.8);
      expect(removed).toBe(1);
    });

    it("collapses different chunks carrying the same content", () => {
      // A re-crawled page produces a new chunk id for text that already exists.
      // Without this the model sees one fact three times and another not at all.
      const { kept, removed } = dedupePassages([
        hit("a", "Refunds are issued within 30 days.", 0.9),
        hit("b", "refunds   are ISSUED within 30 days.", 0.5),
        hit("c", "Support runs Monday to Friday.", 0.7),
      ]);
      expect(kept).toHaveLength(2);
      expect(removed).toBe(1);
      expect(kept.map((k) => k.sourceId)).toEqual(["src-a", "src-c"]);
    });

    it("keeps genuinely different passages", () => {
      const { kept, removed } = dedupePassages([
        hit("a", "Refunds take 30 days.", 0.9),
        hit("b", "The Team plan is $99.", 0.8),
      ]);
      expect(kept).toHaveLength(2);
      expect(removed).toBe(0);
    });
  });

  describe("ordering for attention", () => {
    it("puts the strongest at the start and the end, weakest in the middle", () => {
      // Attention degrades in the middle of a long context, so the weakest
      // passages are the ones to bury there.
      expect(orderForAttention([1, 2, 3, 4, 5])).toEqual([1, 3, 5, 4, 2]);
    });

    it("is a no-op for one or two passages", () => {
      expect(orderForAttention([1])).toEqual([1]);
      expect(orderForAttention([1, 2])).toEqual([1, 2]);
    });
  });

  describe("token budget", () => {
    it("drops whole passages from the bottom, never truncating one", () => {
      const long = "x".repeat(1200); // ~300 tokens each
      const { kept, dropped } = applyTokenBudget(
        [hit("a", long, 0.9), hit("b", long, 0.8), hit("c", long, 0.7)],
        700,
      );
      expect(kept).toHaveLength(2);
      expect(dropped).toHaveLength(1);
      expect(dropped[0]!.sourceId).toBe("src-c");
      // Every kept passage is whole. A half-passage is a citation that no longer
      // supports the sentence attached to it.
      for (const k of kept) expect(k.text).toBe(long);
    });

    it("always keeps at least one passage", () => {
      // An empty block for a question that DID retrieve evidence reads as "no
      // evidence" and triggers a refusal for a question we can answer.
      const huge = "x".repeat(40_000);
      const { kept } = applyTokenBudget([hit("a", huge, 0.9)], 10);
      expect(kept).toHaveLength(1);
    });
  });

  describe("rendering", () => {
    it("emits every passage byte-identical to the stored chunk", () => {
      // The moment context assembly can edit text, a citation stops pointing at
      // evidence and starts pointing at our paraphrase of it — and nothing else
      // in the system would notice.
      const hits = [
        hit("a", "Refunds are issued  within 30 days.\nEven with odd   whitespace.", 0.9),
        hit("b", "The Team plan is $99/month.", 0.8),
      ];
      const block = buildContextBlock(hits, { budgetTokens: 5000 });

      for (const h of hits) expect(block.text).toContain(h.text);
      expect(() => assertVerbatim(block, hits)).not.toThrow();
    });

    it("throws if a passage was altered", () => {
      const hits = [hit("a", "Refunds take 30 days.", 0.9)];
      const block = buildContextBlock(hits, { budgetTokens: 5000 });
      const tampered = { ...block, text: block.text.replace("30", "45") };
      expect(() => assertVerbatim(tampered, hits)).toThrow(/altered passage/);
    });

    it("numbers markers by display position, not by score", () => {
      // Ordering puts rank 2 last. If markers followed score, the block would
      // read [1] … [3] … [2] and a model asked for [1] would reach for whatever
      // it saw first.
      const block = buildContextBlock(
        [hit("a", "first", 0.9), hit("b", "second", 0.8), hit("c", "third", 0.7)],
        { budgetTokens: 5000 },
      );
      expect(block.text.indexOf("[1]")).toBeLessThan(block.text.indexOf("[2]"));
      expect(block.text.indexOf("[2]")).toBeLessThan(block.text.indexOf("[3]"));
      expect(block.citations.map((c) => c.marker)).toEqual([1, 2, 3]);
    });

    it("returns an empty block for no hits, not an empty header", () => {
      const block = buildContextBlock([]);
      expect(block.text).toBe("");
      expect(block.citations).toEqual([]);
    });

    it("GOLDEN SNAPSHOT — the block the model actually sees", () => {
      // Reviewed by a human before committing. A diff here changes every reply
      // the product produces.
      const block = buildContextBlock(
        [
          hit("billing", "The Team plan is $99 per month or $990 annually.", 0.91, {
            sourceTitle: "Billing and Plans",
            headingPath: ["Billing and Plans", "Plans"],
            url: "https://support.example.com/billing",
          }),
          hit("refunds", "Any plan can be refunded in full within 30 days of purchase.", 0.84, {
            sourceTitle: "Refund Policy",
            headingPath: ["Refund Policy", "The 30-day window"],
            url: "https://support.example.com/refunds",
          }),
          hit("security", "Data is encrypted at rest with AES-256.", 0.55, {
            sourceTitle: "Security",
            headingPath: ["Security and Data Handling", "Encryption"],
          }),
        ],
        { budgetTokens: 5000 },
      );

      expect(block.text).toBe(
        `[1] Billing and Plans > Plans — https://support.example.com/billing
The Team plan is $99 per month or $990 annually.

[2] Security and Data Handling > Encryption
Data is encrypted at rest with AES-256.

[3] Refund Policy > The 30-day window — https://support.example.com/refunds
Any plan can be refunded in full within 30 days of purchase.`,
      );
    });
  });
});

describe("citation validation", () => {
  const available = [
    { marker: 1, sourceId: "a", sourceTitle: "Billing", score: 0.9 },
    { marker: 2, sourceId: "b", sourceTitle: "Refunds", score: 0.8 },
  ];

  it("strips a marker that points at nothing", () => {
    // A citation the customer can click that resolves to nothing looks MORE
    // like evidence than no citation, which is why this is stripped rather than
    // merely counted.
    const result = validateCitations(
      "The Team plan is $99 [1]. Refunds take 30 days [2]. Support is 24/7 [7].",
      available,
    );
    expect(result.invalidMarkers).toEqual([7]);
    expect(result.text).not.toContain("[7]");
    expect(result.text).toContain("[1]");
    expect(result.text).toContain("[2]");
  });

  it("reports only the citations actually used", () => {
    const result = validateCitations("The Team plan is $99 [1].", available);
    expect(result.used.map((c) => c.marker)).toEqual([1]);
  });

  it("counts uncited factual sentences", () => {
    const result = validateCitations(
      "The Team plan is $99 [1]. Support is available 24 hours a day worldwide.",
      available,
    );
    expect(result.factualSentences).toBe(2);
    expect(result.uncitedSentences).toHaveLength(1);
    expect(result.uncitedRatio).toBe(0.5);
  });

  it("does not count pleasantries or questions as factual", () => {
    // A friendly reply must not score as badly as a fabricated one.
    const result = validateCitations(
      "Hi there! Would you like me to connect you with a human? I'm happy to help with that.",
      available,
    );
    expect(result.factualSentences).toBe(0);
    expect(result.uncitedRatio).toBe(0);
  });

  it("does not penalise an honest refusal", () => {
    // This is the behaviour we WANT on a negative case. Counting it against the
    // ratio would lower confidence for exactly the right response.
    const result = validateCitations(
      "I don't have that information in our knowledge base. Would you like me to connect you with a teammate?",
      available,
    );
    expect(result.factualSentences).toBe(0);
    expect(result.uncitedRatio).toBe(0);
  });

  it("treats a fully cited answer as clean", () => {
    const result = validateCitations(
      "The Team plan is $99 per month [1]. Refunds are issued within 30 days [2].",
      available,
    );
    expect(result.uncitedRatio).toBe(0);
    expect(result.invalidMarkers).toEqual([]);
    expect(result.used).toHaveLength(2);
  });

  describe("sentence handling", () => {
    it("treats markdown list items as sentences", () => {
      // A list of facts is exactly where citations go missing.
      const sentences = splitSentences("Here you go:\n- First fact\n- Second fact");
      expect(sentences).toHaveLength(3);
    });

    it("is conservative about what counts as factual", () => {
      expect(isFactualSentence("The Team plan costs $99 per month")).toBe(true);
      expect(isFactualSentence("Sure!")).toBe(false);
      expect(isFactualSentence("Would you like help with that")).toBe(false);
      expect(isFactualSentence("I'll connect you with a teammate")).toBe(false);
    });
  });
});

describe("the grounding contract in the system prompt", () => {
  const prompt = buildSystemPrompt({
    agent: { name: "Ada" } as never,
    organization: null,
    conversation: {} as never,
    controls: { allowHumanEscalation: true, requireResolveConfirmation: true },
    activeToolKeys: [],
    integrationTools: [],
    contact: { hasEmail: false },
  });

  it("states the rules that make citations checkable", () => {
    expect(prompt).toContain("Answering from retrieved passages");
    expect(prompt).toMatch(/ONLY source for factual claims/);
    expect(prompt).toMatch(/Attach the passage's marker/);
    expect(prompt).toMatch(/Never cite a passage because it is nearby/);
  });

  it("distinguishes an empty knowledge base from an empty account", () => {
    // Different failures with different right answers: one is "we don't know",
    // the other is a definite factual answer the tools already provide.
    // The phrases span a line wrap in the prompt source, so match the halves.
    expect(prompt).toMatch(/KNOWLEDGE BASE not covering/);
    expect(prompt).toMatch(/CUSTOMER'S ACCOUNT not having/);
  });

  it("keeps the persona and tone rules intact", () => {
    // Grounding is an addition, not a rewrite. These are a contract.
    expect(prompt).toContain("Match the customer's tone");
    expect(prompt).toContain("you are an AI assistant");
    expect(prompt).toContain("Be concise");
    expect(prompt).toContain("Safety boundaries");
    expect(prompt).toContain("Escalation policy");
  });

  it("no longer tells the model to summarise weak hits", () => {
    // The old instruction pushed the model to answer from 0.2-0.5 score hits
    // "rather than claiming the KB is empty" — the opposite of grounding, and
    // now reranking makes that call properly.
    expect(prompt).not.toMatch(/summarize what's there rather than claiming/);
  });
});
