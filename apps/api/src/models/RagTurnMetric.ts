// Per-turn RAG telemetry: what retrieval found and what generation did with it.
//
// The offline harness (`packages/rag-eval`, __specs/39) answers "is the pipeline
// good on the golden set". This collection answers the question the harness
// structurally cannot: "is the pipeline good RIGHT NOW, on the questions real
// customers are actually asking, against the knowledge base this org actually
// wrote". A fixture set ages the moment an operator uploads a document.
//
// Shaped after `ToolCallLog`, the repo's other per-turn telemetry collection:
// same (organizationId, agentId, conversationId) scoping, same masked-before-
// persist rule, same `durationMs` + status enum, same `updatedAt: false`
// timestamps, same 90-day TTL. Two telemetry collections with two different
// sets of conventions is how a dashboard ends up joining on nothing.
//
// Every write is fire-and-forget from the reply path. See
// `services/ai/telemetry/rag-telemetry.service.ts`.

import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { env } from "../config/env.js";

const ragTurnMetricSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    agentId: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    /** The AI message this turn produced — joins a metric to the reply it scores. */
    messageId: { type: Schema.Types.ObjectId, ref: "Message", required: true },

    // ---- What was asked ----
    //
    // Both run through `piiMask` before they get here, unconditionally and
    // regardless of the org's `piiRedaction` setting. That setting governs what
    // reaches the MODEL; this is an analytics store an operator browses in a
    // dashboard, and a customer's card number has no business in it either way.
    originalQuery: { type: String, default: "" },
    rewrittenQuery: { type: String, default: "" },

    retrieval: {
      /** The final context size asked for (`AI_KB_SEARCH_TOP_K` unless overridden). */
      topK: { type: Number },
      /** The score floor stage 1 applied. */
      minScore: { type: Number },
      /** Passages that actually reached the prompt, after fusion and reranking. */
      hitCount: { type: Number, default: 0 },
      /**
       * Raw scores, always on the cosine scale: fusion keeps the best raw score
       * per passage and reranking reorders without overwriting it, so these stay
       * comparable across turns whichever stages ran.
       */
      topScore: { type: Number, default: null },
      meanScore: { type: Number, default: null },
      scoreSpread: { type: Number, default: null },
      /**
       * Normalised [0,1] retrieval quality. Derived, not a raw score — see
       * `services/ai/retrieval/retrieval-confidence.ts` and __specs/39.
       */
      retrievalConfidence: { type: Number, default: 0 },
      /** Stage 1 came back empty and the no-floor retry ran. */
      widenedOnEmpty: { type: Boolean, default: false },
      /** Distinct knowledge sources behind the retrieved passages. */
      sourceIds: { type: [String], default: [] },
      /**
       * Per-CHUNK retrieval, in rank order. Bounded by `AI_KB_SEARCH_TOP_K`.
       *
       * Source-level ids answer "which document did this turn use". They cannot
       * answer the question index health actually asks, which is "which
       * PASSAGE is pulling its weight" — a document is rarely uniformly good,
       * and the repair for one bad chunk is not the repair for a bad document.
       *
       * `cited` is the half that has to be recorded here rather than derived:
       * a chunk that was retrieved and then ignored by the model leaves no
       * trace anywhere else, and it is the single most diagnostic signal in the
       * set (it usually means the chunk is badly split rather than irrelevant).
       */
      chunks: {
        type: [
          {
            _id: false,
            chunkId: { type: String, required: true },
            sourceId: { type: String, required: true },
            /** 0-based position in the ranked list handed to the prompt. */
            rank: { type: Number, required: true },
            /** Raw similarity, always on the cosine scale. */
            score: { type: Number, default: null },
            /** Calibrated cross-encoder score, null when stage 2 did not run. */
            rerankScore: { type: Number, default: null },
            /** Whether the reply actually cited this passage. */
            cited: { type: Boolean, default: false },
          },
        ],
        default: [],
      },
      /** Every KB search this turn ran, summed. */
      latencyMs: { type: Number, default: 0 },
      /** How many `search_kb` calls the model made. 0 means it never searched. */
      searchCount: { type: Number, default: 0 },
    },

    generation: {
      confidence: { type: Number, default: null },
      action: { type: String, enum: ["reply", "escalate", "resolve"], default: "reply" },
      citationCount: { type: Number, default: 0 },
      citedSourceIds: { type: [String], default: [] },
      /** Characters, not tokens: this is a shape signal, not a billing number. */
      answerLength: { type: Number, default: 0 },
      model: { type: String },
      /**
       * Null until OpenRouter resolves the generation, then backfilled by the
       * same usage call that writes the UsageRecord. Null means UNKNOWN — a
       * fake 0 in a cost table is worse than a blank, because it reads as free.
       */
      promptTokens: { type: Number, default: null },
      completionTokens: { type: Number, default: null },
      costUsd: { type: Number, default: null },
      /** The finalize node alone: streamed reply + meta pass, run concurrently. */
      latencyMs: { type: Number, default: 0 },
    },

    flags: {
      /** Retrieval returned nothing the reply could be grounded in. */
      noHits: { type: Boolean, default: false },
      /** Below `AI_CONFIDENCE_THRESHOLD`. */
      lowConfidence: { type: Boolean, default: false },
      escalated: { type: Boolean, default: false },
      /** Two sources contradicted each other on the queried fact. */
      conflicted: { type: Boolean, default: false },
    },

    /** Agent↔tool round trips this turn spent. */
    toolTurns: { type: Number, default: 0 },

    /**
     * Sampled online faithfulness, written back out of band by the P2 judge.
     *
     * `sampled: true` with a null score means the turn was drawn but the judge
     * did not produce a verdict (over budget, judge error, or an answer with no
     * factual claims to score). That is a different fact from "not sampled" and
     * the dashboard must not average the two together.
     */
    faithfulness: {
      sampled: { type: Boolean, default: false },
      score: { type: Number, default: null },
      claimCount: { type: Number, default: null },
      /** Claims the retrieved context did not support. Masked before persisting. */
      unsupported: {
        type: [
          {
            _id: false,
            claim: { type: String },
            verdict: { type: String },
            reason: { type: String },
          },
        ],
        default: [],
      },
      judgeModel: { type: String, default: null },
      judgedAt: { type: Date, default: null },
      skippedReason: { type: String, default: null },
    },

    /** `fallback` means the graph never produced a state and the safe reply stood. */
    status: { type: String, enum: ["ok", "fallback"], required: true },
    /** The whole turn, first byte of work to persisted reply. */
    durationMs: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// TTL. Retention is configurable because __specs/12 lets an org's plan set it,
// but it defaults to the same 90 days every other telemetry collection uses.
ragTurnMetricSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: env.rag.retentionDays * 24 * 60 * 60 },
);

// The dashboard's spine: one agent's turns over a time range, newest first.
ragTurnMetricSchema.index({ organizationId: 1, agentId: 1, createdAt: -1 });
// Org-wide rollups and the rolling-window alert aggregation, which spans agents.
ragTurnMetricSchema.index({ organizationId: 1, createdAt: -1 });
// "Show me the turns that went wrong" — one partial index per flag, so the scan
// is over the matching turns rather than over every turn in the window.
ragTurnMetricSchema.index(
  { organizationId: 1, createdAt: -1 },
  { partialFilterExpression: { "flags.noHits": true }, name: "flags_noHits" },
);
ragTurnMetricSchema.index(
  { organizationId: 1, createdAt: -1 },
  { partialFilterExpression: { "flags.lowConfidence": true }, name: "flags_lowConfidence" },
);
ragTurnMetricSchema.index(
  { organizationId: 1, createdAt: -1 },
  { partialFilterExpression: { "flags.escalated": true }, name: "flags_escalated" },
);
ragTurnMetricSchema.index(
  { organizationId: 1, createdAt: -1 },
  { partialFilterExpression: { "flags.conflicted": true }, name: "flags_conflicted" },
);
// Sampled-faithfulness rollups, which read a small subset of a large collection.
ragTurnMetricSchema.index(
  { organizationId: 1, createdAt: -1 },
  { partialFilterExpression: { "faithfulness.sampled": true }, name: "faithfulness_sampled" },
);
// Drill-down from a conversation in the operator inbox, mirroring ToolCallLog.
ragTurnMetricSchema.index({ organizationId: 1, conversationId: 1 });
// Per-chunk index health unwinds `retrieval.chunks` over a window. The org +
// time match leads, so the existing compound index serves it; this multikey
// index is what keeps the chunk-id lookup for ONE chunk from scanning them all.
ragTurnMetricSchema.index({ organizationId: 1, "retrieval.chunks.chunkId": 1, createdAt: -1 });

export type RagTurnMetricDocType = InferSchemaType<typeof ragTurnMetricSchema>;
export const RagTurnMetric: Model<RagTurnMetricDocType> =
  mongoose.models.RagTurnMetric ?? mongoose.model("RagTurnMetric", ragTurnMetricSchema);
