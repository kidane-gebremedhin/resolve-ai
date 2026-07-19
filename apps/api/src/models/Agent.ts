import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const agentSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    // One agent per website — every website has its own agent with its own
    // persona + model config, so different sites can behave differently.
    websiteId: { type: Schema.Types.ObjectId, ref: "Website", required: true },
    name: { type: String, required: true },
    description: { type: String },
    avatarUrl: { type: String },
    welcomeMessage: { type: String },
    suggestedQuestions: { type: [String], default: [] },
    systemPromptOverride: { type: String },
    model: { type: String },
    // No hardcoded defaults — when these are unset on the document, the
    // agent runtime reads `env.ai.temperature` / `env.ai.confidenceThreshold`
    // so all model-tuning lives in env vars (see apps/api/src/config/env.ts).
    temperature: { type: Number },
    confidenceThreshold: { type: Number, min: 0, max: 1 },
    // Operator-configured Jira project key for tickets this agent files (e.g.
    // "KAN", "SUPPORT"). When set, the dispatcher routes create_support_ticket to
    // this project instead of the AI's guessed/default one.
    jiraProjectKey: { type: String },
    // When several connections expose the SAME tool key (similar-capability tools,
    // e.g. Jira + Linear both `create_support_ticket`), this fixes which one the agent
    // calls first and the order to fall back through on error/low confidence. One entry
    // per tool key; `connectionIds` is ordered primary → fallbacks.
    toolPriority: {
      type: [
        new Schema(
          {
            key: { type: String, required: true },
            connectionIds: { type: [Schema.Types.ObjectId], default: [] },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

agentSchema.index({ organizationId: 1 });
// One agent per website. Partial so the index can build while a migration is
// still backfilling `websiteId` on legacy agents (nulls are excluded).
agentSchema.index(
  { websiteId: 1 },
  { unique: true, partialFilterExpression: { websiteId: { $exists: true } } },
);

export type AgentDocType = InferSchemaType<typeof agentSchema>;
export const Agent: Model<AgentDocType> =
  mongoose.models.Agent ?? mongoose.model("Agent", agentSchema);
