import { Schema, model } from "mongoose";

export type KnowledgeGapDocType = {
  organizationId: Schema.Types.ObjectId;
  agentId: Schema.Types.ObjectId;
  question: string;
  queryUsed: string;
  maxKbScore: number;
  occurrenceCount: number;
  status: "open" | "addressed";
  kind: "gap" | "conflict";
  conflict?: {
    sourceIds?: string[];
    sourceTitles?: string[];
    resolvedBy?: "priority" | "recency" | "score" | "unresolved";
    winningSourceId?: string;
  };
  /**
   * Cached embedding of `queryUsed`, for gap clustering.
   *
   * Cached because the alternative is re-embedding every open gap on every
   * dashboard load — a cost that grows with exactly the thing the page exists
   * to reduce. `embeddingModel` tags which vector space it belongs to, so a
   * model change invalidates rather than silently mixing two spaces.
   */
  embedding?: number[];
  embeddingModel?: string;
  createdAt: Date;
  updatedAt: Date;
};

const schema = new Schema<KnowledgeGapDocType>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true, ref: "Organization", index: true },
    agentId: { type: Schema.Types.ObjectId, required: true, ref: "Agent", index: true },
    question: { type: String, required: true },
    queryUsed: { type: String, required: true },
    maxKbScore: { type: Number, required: true },
    occurrenceCount: { type: Number, default: 1 },
    status: { type: String, enum: ["open", "addressed"], default: "open" },
    /**
     * What kind of problem this record represents.
     *
     * `gap`   — the knowledge base has no answer (the original meaning).
     * `conflict` — it has two, and they disagree. A different failure with a
     *              different fix: a gap is filled by writing a document, a
     *              conflict is fixed by deciding which existing document is
     *              right and retiring or reprioritising the other.
     */
    kind: { type: String, enum: ["gap", "conflict"], default: "gap", index: true },
    /** Cached clustering embedding of `queryUsed`, tagged with its vector space. */
    embedding: { type: [Number], default: undefined },
    embeddingModel: { type: String },
    /** For a conflict: the sources that disagreed, and how it was resolved. */
    conflict: {
      sourceIds: { type: [String], default: undefined },
      sourceTitles: { type: [String], default: undefined },
      /** `priority` | `recency` | `score` | `unresolved` */
      resolvedBy: { type: String },
      /** The source that won, when one did. */
      winningSourceId: { type: String },
    },
  },
  { timestamps: true },
);

// Upsert key: one gap entry per (org, agent, search query).
// Upsert key. `kind` is part of it because a gap and a conflict for the SAME
// query are different problems with different fixes, and collapsing them would
// let one silently overwrite the other.
schema.index({ organizationId: 1, agentId: 1, queryUsed: 1, kind: 1 }, { unique: true });

export const KnowledgeGap = model<KnowledgeGapDocType>("KnowledgeGap", schema);
