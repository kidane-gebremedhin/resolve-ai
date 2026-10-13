// A vector that outlived its source must never reach the prompt (__specs/37 R4).
//
// Vectors can survive their source: a vector delete that failed, or ids a
// partial upsert never recorded. Before the fix, hydration served such a hit
// anyway, titled "Untitled", with its stale Pinecone metadata text.

import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";

const ORG = new mongoose.Types.ObjectId();
const AGENT = new mongoose.Types.ObjectId();
const LIVE = new mongoose.Types.ObjectId();
const GONE = new mongoose.Types.ObjectId();

vi.mock("../config/pinecone.js", () => ({
  getPineconeIndex: () => ({
    upsert: async () => {},
    deleteMany: async () => {},
    query: async () => ({
      matches: [
        { id: `${GONE}:0`, score: 0.95, metadata: { sourceId: String(GONE), chunkIndex: 0, text: "old refund rule: 90 days" } },
        { id: `${LIVE}:0`, score: 0.9, metadata: { sourceId: String(LIVE), chunkIndex: 0, text: "refunds within 30 days" } },
      ],
    }),
  }),
}));

import { KnowledgeSource } from "../models/index.js";
import { searchKb } from "../services/kb/search.service.js";

describe("hydration", () => {
  it("drops hits whose knowledge source no longer exists", async () => {
    await KnowledgeSource.create({
      _id: LIVE,
      organizationId: ORG,
      agentId: AGENT,
      type: "text",
      title: "Refund policy",
      contentHash: "h-live",
      embeddingStatus: "synced",
      createdBy: new mongoose.Types.ObjectId(),
    });

    const hits = await searchKb({ query: "refund", organizationId: String(ORG), agentId: String(AGENT), minScore: 0 });

    expect(hits.map((h) => h.sourceId)).toEqual([String(LIVE)]);
    expect(hits[0]!.sourceTitle).toBe("Refund policy");
    expect(hits.some((h) => (h.text ?? "").includes("90 days"))).toBe(false);
  });
});
