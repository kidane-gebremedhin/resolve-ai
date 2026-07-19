import { Schema, model } from "mongoose";

export type KnowledgeGapDocType = {
  organizationId: Schema.Types.ObjectId;
  agentId: Schema.Types.ObjectId;
  question: string;
  queryUsed: string;
  maxKbScore: number;
  occurrenceCount: number;
  status: "open" | "addressed";
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
  },
  { timestamps: true },
);

// Upsert key: one gap entry per (org, agent, search query).
schema.index({ organizationId: 1, agentId: 1, queryUsed: 1 }, { unique: true });

export const KnowledgeGap = model<KnowledgeGapDocType>("KnowledgeGap", schema);
