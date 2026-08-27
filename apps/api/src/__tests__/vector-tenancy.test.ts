// Tenant isolation at the vector layer, asserted rather than assumed.
//
// __specs/12 §1.3 marked "Pinecone namespace = organizationId" as a 🔴 Critical
// control. The code has never done that: vectors go into the default namespace
// and isolation is enforced by an AND-ed metadata filter plus a hard refusal to
// run an unscoped query (`search.service.ts`). Spec and code disagreed, and the
// spec claimed the stronger guarantee.
//
// The resolution recorded in __specs/04 is to document the mechanism that
// actually exists and to pin it down here, so the weaker-but-real guarantee is
// enforced by a test instead of resting on a filter nobody checks. If the
// namespace migration is ever done, these tests should keep passing — they
// assert the outcome (no cross-tenant hit), not the mechanism.

import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every query the code sends to the vector store during a test. */
const queries: { filter?: unknown; topK?: number }[] = [];

vi.mock("../config/pinecone.js", () => ({
  getPineconeIndex: () => ({
    upsert: async () => undefined,
    deleteMany: async () => undefined,
    query: async (args: { filter?: unknown; topK?: number }) => {
      queries.push(args);
      return { matches: [] };
    },
  }),
}));

import { searchKb } from "../services/kb/search.service.js";

const ORG = new mongoose.Types.ObjectId().toString();
const AGENT = new mongoose.Types.ObjectId().toString();

describe("every vector query is scoped to one tenant", () => {
  beforeEach(() => {
    queries.length = 0;
  });

  it("filters on the organization AND the agent, not just one of them", async () => {
    await searchKb({ query: "refund policy", organizationId: ORG, agentId: AGENT });

    expect(queries).toHaveLength(1);
    const filter = queries[0]!.filter as { $and: Record<string, unknown>[] };
    // AND-ed, so a vector missing either field cannot match. Filtering on the
    // org alone would leak between agents in the same workspace; on the agent
    // alone, between organizations if an id were ever reused.
    expect(filter.$and).toEqual(
      expect.arrayContaining([
        { agentId: { $eq: AGENT } },
        { organizationId: { $eq: ORG } },
      ]),
    );
  });

  it("refuses to run at all without an agent, rather than widening the filter", async () => {
    // The dangerous failure: an empty agentId silently becomes "every agent in
    // this organization". The service refuses instead.
    const hits = await searchKb({ query: "anything", organizationId: ORG, agentId: "" });
    expect(hits).toEqual([]);
    expect(queries, "an unscoped query reached the vector store").toHaveLength(0);
  });

  it("never sends a query with no filter", async () => {
    await searchKb({ query: "a", organizationId: ORG, agentId: AGENT });
    for (const q of queries) {
      expect(q.filter, "a vector query went out unfiltered").toBeTruthy();
    }
  });

  it("degrades to no hits rather than throwing when the store is unreachable", async () => {
    // A retrieval outage must not fail the customer's turn — but it also must
    // not fall back to an unfiltered query.
    const { getPineconeIndex } = await import("../config/pinecone.js");
    const index = getPineconeIndex();
    const spy = vi.spyOn(index, "query").mockRejectedValue(new Error("pinecone down"));
    try {
      await expect(
        searchKb({ query: "a", organizationId: ORG, agentId: AGENT }),
      ).resolves.toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the documented mechanism matches the code", () => {
  it("says metadata filtering, not namespaces", async () => {
    // The spec used to claim per-org namespaces. If someone implements them,
    // this test should be updated in the same change — and the isolation tests
    // above should keep passing untouched.
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const spec = readFileSync(
      path.resolve(process.cwd(), "../../__specs/12-security-compliance.md"),
      "utf8",
    );
    expect(spec).toMatch(/metadata filter/i);
  });
});
