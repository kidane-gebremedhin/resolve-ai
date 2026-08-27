// What happens when the knowledge base contradicts itself.
//
// This starts with a reproduction of the OLD behaviour, kept in the suite
// permanently. It is the clearest statement of why the rest of this file exists:
// without a conflict policy, two documents giving different refund windows both
// reach the prompt, ranked only by relevance, with nothing telling the model
// they disagree. What it does next is its own business, and that is the problem.

import { describe, expect, it, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { KbChunk, KnowledgeGap } from "../models/index.js";
import { understoodSearch } from "../services/ai/retrieval/understood-search.js";
import { env } from "../config/env.js";
import {
  candidatesFromHits,
  checkForConflict,
  conflictPossible,
  orderByAuthority,
  resolveConflict,
  type ConflictCandidate,
} from "../services/kb/conflict.js";
import { buildContextBlock } from "../services/ai/context-block.js";
import { buildSystemPrompt } from "../services/ai/prompts.js";
import type { KbHit } from "../services/kb/search.service.js";

const OLD = new Date("2024-01-01");
const NEW = new Date("2026-06-01");

const hit = (
  sourceId: string,
  sourceTitle: string,
  text: string,
  score: number,
  extra: Partial<KbHit> = {},
): KbHit => ({
  sourceId,
  sourceTitle,
  chunkIndex: 0,
  chunkId: `${sourceId}:0`,
  text,
  score,
  ...extra,
});

/** The scenario the whole prompt is about: an old refund policy and a new one. */
const STALE = hit(
  "policy-2024",
  "Refund Policy (2024)",
  "Refunds are issued within 14 days of the original purchase.",
  0.88,
  { priority: 0, sourceUpdatedAt: OLD },
);
const CURRENT = hit(
  "policy-2026",
  "Refund Policy",
  "Any plan can be refunded in full within 30 days of purchase.",
  0.86,
  { priority: 0, sourceUpdatedAt: NEW },
);

describe("PART A — what happened before a conflict policy existed", () => {
  it("both contradictory passages clear the floor and reach the prompt together", () => {
    // Neither is filtered: they are both highly relevant to "refund window",
    // which is exactly what makes them dangerous. Relevance cannot separate a
    // correct answer from a stale one.
    const above = [STALE, CURRENT].filter((h) => h.score >= env.ai.kbSearchMinScore);
    expect(above).toHaveLength(2);

    const block = buildContextBlock([STALE, CURRENT], { budgetTokens: 5000 });
    expect(block.citations).toHaveLength(2);
    expect(block.text).toContain("14 days");
    expect(block.text).toContain("30 days");
  });

  it("ranks them by relevance alone, which puts the STALE one first here", () => {
    // The stale document happens to score higher. Nothing in retrieval knows or
    // cares that it was superseded, so "most relevant" and "most correct" point
    // in opposite directions and the model is handed the wrong one first.
    const candidates = candidatesFromHits([STALE, CURRENT]);
    expect(candidates[0]!.sourceTitle).toBe("Refund Policy (2024)");
  });

  it("the model was told nothing about conflicting sources, recency or authority", () => {
    // The audit finding, pinned so a future prompt rewrite that drops these
    // rules fails loudly instead of silently regressing to guessing.
    const prompt = buildSystemPrompt({
      agent: { name: "Ada" } as never,
      organization: null,
      conversation: {} as never,
      controls: { allowHumanEscalation: true, requireResolveConfirmation: true },
      activeToolKeys: [],
      integrationTools: [],
      contact: { hasEmail: false },
    });

    // These are the rules added BY this prompt. Their presence is the fix; the
    // reproduction above is what they fix.
    expect(prompt).toMatch(/When the knowledge base contradicts itself/);
    expect(prompt).toMatch(/do NOT blend the two/i);
    expect(prompt).toMatch(/Guessing here is worse than escalating/);
  });
});

describe("conflict is possible", () => {
  const c = (score: number, id = String(score)): ConflictCandidate => ({
    sourceId: id,
    sourceTitle: `S${id}`,
    priority: 0,
    sourceUpdatedAt: null,
    score,
    text: "t",
  });

  it("is false for a single source, which cannot contradict itself", () => {
    expect(conflictPossible([c(0.9)])).toBe(false);
  });

  it("is true when two sources score closely", () => {
    // Both are answering the question. That is what a contradiction looks like
    // — and also what a well-covered topic looks like, which is why this only
    // gates the real check rather than being it.
    expect(conflictPossible([c(0.9), c(0.85)], 0.15)).toBe(true);
  });

  it("is false when the second source is far behind", () => {
    // Weaker evidence, not a competing claim. Without this gate nearly every
    // turn would pay for an LLM call.
    expect(conflictPossible([c(0.9), c(0.3)], 0.15)).toBe(false);
  });

  it("does not divide by a zero leading score", () => {
    expect(conflictPossible([c(0), c(0)], 0.15)).toBe(false);
  });
});

describe("resolution order", () => {
  const c = (
    id: string,
    priority: number,
    updated: Date | null,
    score: number,
  ): ConflictCandidate => ({
    sourceId: id,
    sourceTitle: `Source ${id}`,
    priority,
    sourceUpdatedAt: updated,
    score,
    text: "t",
  });

  it("explicit priority beats everything, even a newer and better-scoring rival", () => {
    // An operator who marked the canonical page authoritative has said something
    // no heuristic should override.
    const r = resolveConflict([c("new", 0, NEW, 0.95), c("canonical", 5, OLD, 0.60)]);
    expect(r.winner!.sourceId).toBe("canonical");
    expect(r.resolvedBy).toBe("priority");
    expect(r.losers.map((l) => l.sourceId)).toEqual(["new"]);
  });

  it("falls to recency when priority ties", () => {
    const r = resolveConflict([c("stale", 0, OLD, 0.95), c("current", 0, NEW, 0.60)]);
    expect(r.winner!.sourceId).toBe("current");
    expect(r.resolvedBy).toBe("recency");
  });

  it("does not let an undated source win on recency", () => {
    // An unknown date is not evidence of being current.
    const r = resolveConflict([c("undated", 0, null, 0.95), c("dated", 0, OLD, 0.60)]);
    expect(r.winner!.sourceId).toBe("dated");
    expect(r.resolvedBy).toBe("recency");
  });

  it("falls to relevance only when priority and recency both tie", () => {
    const same = new Date("2026-01-01");
    const r = resolveConflict([c("a", 0, same, 0.70), c("b", 0, same, 0.90)]);
    expect(r.winner!.sourceId).toBe("b");
    expect(r.resolvedBy).toBe("score");
  });

  describe("the tie that cannot be broken", () => {
    it("returns unresolved rather than picking one", () => {
      // The case the whole policy exists to handle honestly. Two documents,
      // equal authority, equal age, equal relevance, incompatible answers.
      // Picking one would be a coin flip presented as an answer.
      const same = new Date("2026-01-01");
      const r = resolveConflict([c("a", 0, same, 0.8), c("b", 0, same, 0.8)]);
      expect(r.winner).toBeNull();
      expect(r.resolvedBy).toBe("unresolved");
      expect(r.losers).toHaveLength(2);
    });

    it("leaves the hit order untouched when it cannot resolve", () => {
      const same = new Date("2026-01-01");
      const r = resolveConflict([c("a", 0, same, 0.8), c("b", 0, same, 0.8)]);
      const ordered = orderByAuthority([STALE, CURRENT], r);
      expect(ordered.map((h) => h.sourceId)).toEqual(["policy-2024", "policy-2026"]);
    });
  });

  it("puts the winner's passages first without dropping the loser's", () => {
    // The losing passages stay: removing them would hide from the operator that
    // a contradiction was ever there.
    const r = resolveConflict(candidatesFromHits([STALE, CURRENT]));
    const ordered = orderByAuthority([STALE, CURRENT], r);
    expect(ordered[0]!.sourceId).toBe("policy-2026");
    expect(ordered).toHaveLength(2);
  });
});

describe("conflict detection", () => {
  const candidates = candidatesFromHits([STALE, CURRENT]);

  it("flags two sources that answer the same question incompatibly", async () => {
    const invoke = vi.fn(async () =>
      JSON.stringify({ conflicted: true, reason: "the refund window" }),
    );
    const check = await checkForConflict({ query: "refund window", candidates }, { invoke });
    expect(check.conflicted).toBe(true);
    expect(check.reason).toBe("the refund window");
  });

  it("does not flag sources that merely differ in detail", async () => {
    // Different is not contradictory. A looser check would flag every
    // well-covered topic and escalate turns that were answered correctly.
    const invoke = vi.fn(async () => JSON.stringify({ conflicted: false, reason: "" }));
    const check = await checkForConflict({ query: "refunds", candidates }, { invoke });
    expect(check.conflicted).toBe(false);
  });

  it("treats a failed check as NO conflict, not as a conflict", async () => {
    // "We do not know" must not become "they disagree", or a provider hiccup
    // escalates turns that were fine.
    const invoke = vi.fn(async () => {
      throw new Error("502 from provider");
    });
    const check = await checkForConflict({ query: "q", candidates }, { invoke });
    expect(check.conflicted).toBe(false);
    expect(check.checked).toBe(false);
  });

  it("treats a malformed response as no conflict", async () => {
    const invoke = vi.fn(async () => "I think they might disagree?");
    const check = await checkForConflict({ query: "q", candidates }, { invoke });
    expect(check.conflicted).toBe(false);
  });

  it("does not call the model for a single source", async () => {
    const invoke = vi.fn();
    const check = await checkForConflict(
      { query: "q", candidates: [candidates[0]!] },
      { invoke },
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(check.checked).toBe(false);
  });
});

describe("candidates", () => {
  it("groups by source, keeping each source's best passage", () => {
    // Conflict is a property of SOURCES. Two chunks of one document elaborating
    // on each other are not in conflict, however different they look.
    const candidates = candidatesFromHits([
      hit("a", "Doc A", "first chunk", 0.7),
      { ...hit("a", "Doc A", "second chunk", 0.9), chunkId: "a:1", chunkIndex: 1 },
      hit("b", "Doc B", "other doc", 0.8),
    ]);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.sourceId).toBe("a");
    expect(candidates[0]!.score).toBe(0.9);
  });

  it("defaults priority to 0 and date to null for sources that predate the fields", () => {
    const [c] = candidatesFromHits([hit("a", "Doc A", "text", 0.5)]);
    expect(c!.priority).toBe(0);
    expect(c!.sourceUpdatedAt).toBeNull();
  });
});


describe("INTEGRATION — a seeded contradiction, end to end", () => {
  // The test the whole prompt exists for. Two documents in one agent's KB give
  // incompatible refund windows. The stale one scores HIGHER on relevance, so
  // ranking alone hands the model the wrong answer first.
  const ORG = new mongoose.Types.ObjectId();
  const AGENT = new mongoose.Types.ObjectId();
  const STALE_SRC = new mongoose.Types.ObjectId();
  const CURRENT_SRC = new mongoose.Types.ObjectId();

  /** Flip config for one test and restore it. */
  function withKb<T extends Record<string, unknown>>(flags: T, fn: () => Promise<void>) {
    return async () => {
      const kb = env.kb as unknown as Record<string, unknown>;
      const previous: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(flags)) {
        previous[k] = kb[k];
        kb[k] = v;
      }
      try {
        await fn();
      } finally {
        for (const [k, v] of Object.entries(previous)) kb[k] = v;
      }
    };
  }

  beforeEach(async () => {
    await KbChunk.insertMany([
      {
        organizationId: ORG,
        agentId: AGENT,
        sourceId: STALE_SRC,
        chunkIndex: 0,
        chunkId: `${STALE_SRC}:0`,
        text: "Refunds are issued within 14 days of the original purchase.",
        // Lower authority, older content — but it will score higher.
        priority: 0,
        sourceUpdatedAt: OLD,
      },
      {
        organizationId: ORG,
        agentId: AGENT,
        sourceId: CURRENT_SRC,
        chunkIndex: 0,
        chunkId: `${CURRENT_SRC}:0`,
        text: "Any plan can be refunded in full within 30 days of purchase.",
        priority: 5,
        sourceUpdatedAt: NEW,
      },
    ]);
  });

  /** Retrieval that returns the stale passage FIRST, as relevance alone would. */
  const retriever = {
    searchHits: async (): Promise<KbHit[]> => [
      hit(
        String(STALE_SRC),
        "Refund Policy (2024)",
        "Refunds are issued within 14 days of the original purchase.",
        0.88,
        { priority: 0, sourceUpdatedAt: OLD, chunkId: `${STALE_SRC}:0` },
      ),
      hit(
        String(CURRENT_SRC),
        "Refund Policy",
        "Any plan can be refunded in full within 30 days of purchase.",
        0.86,
        { priority: 5, sourceUpdatedAt: NEW, chunkId: `${CURRENT_SRC}:0` },
      ),
    ],
  };

  /**
   * The contradiction judge, decided locally.
   *
   * These cases used to reach a real model, which meant they passed on a good
   * day and failed when someone's OpenRouter balance ran out — and the failure
   * looked like a conflict-detection bug rather than a billing one. The verdict
   * below is what a judge reaches on THIS fixture, derived from the passages it
   * is shown rather than hardcoded, so a case that stops containing a
   * contradiction stops being flagged as one.
   */
  const conflictDeps = {
    invoke: async (_system: string, user: string): Promise<string> => {
      const windows = [...new Set(user.match(/\d+\s*days/g) ?? [])];
      const conflicted = windows.length > 1;
      return JSON.stringify({
        conflicted,
        reason: conflicted ? `sources state ${windows.join(" and ")}` : "",
      });
    },
  };

  it(
    "promotes the higher-priority source over the higher-scoring stale one",
    withKb({ conflictDetectionEnabled: true, rerankEnabled: false }, async () => {
      const result = await understoodSearch({
        query: "what is your refund window",
        conversationId: "conflict-test",
        retriever,
        conflictDeps,
        topK: 5,
      });

      expect(result.conflict.conflicted).toBe(true);
      expect(result.conflict.resolution?.resolvedBy).toBe("priority");
      expect(result.conflict.resolution?.winner?.sourceTitle).toBe("Refund Policy");

      // The authoritative passage now leads, despite scoring lower.
      expect(result.hits[0]!.text).toContain("30 days");
      // And the stale one is still present, so the operator can see the
      // contradiction rather than having it silently hidden.
      expect(result.hits.map((h) => h.text).join(" ")).toContain("14 days");
    }),
  );

  it(
    "does nothing when the flag is off, reproducing the old behaviour exactly",
    withKb({ conflictDetectionEnabled: false, rerankEnabled: false }, async () => {
      const result = await understoodSearch({
        query: "what is your refund window",
        conversationId: "conflict-test",
        retriever,
        conflictDeps,
        topK: 5,
      });

      expect(result.conflict.conflicted).toBe(false);
      // Relevance order stands: the stale 14-day answer leads.
      expect(result.hits[0]!.text).toContain("14 days");
    }),
  );

  it(
    "escalates rather than guessing when nothing separates the sources",
    withKb({ conflictDetectionEnabled: true, rerankEnabled: false }, async () => {
      const same = new Date("2026-01-01");
      const tied = {
        searchHits: async (): Promise<KbHit[]> => [
          hit(String(STALE_SRC), "Policy A", "Refunds take 14 days.", 0.8, {
            priority: 0,
            sourceUpdatedAt: same,
            chunkId: `${STALE_SRC}:0`,
          }),
          hit(String(CURRENT_SRC), "Policy B", "Refunds take 30 days.", 0.8, {
            priority: 0,
            sourceUpdatedAt: same,
            chunkId: `${CURRENT_SRC}:0`,
          }),
        ],
      };

      const result = await understoodSearch({
        query: "refund window",
        conversationId: "conflict-tie",
        retriever: tied,
        conflictDeps,
        topK: 5,
      });

      expect(result.conflict.conflicted).toBe(true);
      // No winner: the tool instruction tells the model to escalate rather than
      // pick, and the resolution says why.
      expect(result.conflict.resolution?.winner).toBeNull();
      expect(result.conflict.resolution?.resolvedBy).toBe("unresolved");
    }),
  );

  it("records a conflict as its own kind, separate from a knowledge gap", async () => {
    // A gap is filled by writing a document; a conflict is fixed by deciding
    // which existing document is right. Sharing a record kind would bury the
    // conflicts inside a list of missing topics.
    await KnowledgeGap.create({
      organizationId: ORG,
      agentId: AGENT,
      question: "what is your refund window",
      queryUsed: "refund window",
      maxKbScore: 1,
      kind: "conflict",
      conflict: {
        sourceIds: [String(CURRENT_SRC), String(STALE_SRC)],
        sourceTitles: ["Refund Policy", "Refund Policy (2024)"],
        resolvedBy: "priority",
        winningSourceId: String(CURRENT_SRC),
      },
    });

    const conflicts = await KnowledgeGap.find({ organizationId: ORG, kind: "conflict" }).lean();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.conflict?.resolvedBy).toBe("priority");
    expect(conflicts[0]!.conflict?.sourceTitles).toContain("Refund Policy (2024)");

    // And it does not pollute the gap list.
    const gaps = await KnowledgeGap.find({ organizationId: ORG, kind: "gap" }).lean();
    expect(gaps).toHaveLength(0);
  });
});
