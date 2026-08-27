// Index health: what is weak in the knowledge base, and the repairs for it.
//
// Two reads and four repair actions. The reads are org-scoped like every other
// analytics surface. The repairs touch customer knowledge, which is why the
// rules below are structural rather than a policy someone is asked to remember:
//
//   NOTHING HERE IS AUTOMATIC. Every route is operator-initiated.
//   DELETION REQUIRES A REVIEW STEP. Not a boolean the caller sets — a token
//   issued by a preview of the EXACT set being deleted, which the delete route
//   recomputes and rejects on mismatch. A client that never previewed cannot
//   produce one, and a client that previewed a different set produces one that
//   does not verify.
//   THE SCHEDULED JOB CALLS NONE OF THIS. It re-embeds and it notifies; the
//   destructive paths are unreachable from it, and `index-health.test.ts`
//   asserts that rather than trusting it.

import crypto from "node:crypto";
import { Router, type Request } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { requireOrgRole } from "../middleware/org-role.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { enforceKnowledgeQuota } from "../middleware/plan-limit.middleware.js";
import { KbChunk, KnowledgeGap, KnowledgeSource, RagTurnMetric } from "../models/index.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { logAuditFromReq } from "../services/audit.service.js";
import { ingestSource, purgeSourceVectors } from "../services/kb/ingestion.service.js";
import { clusterGaps, scoreChunks } from "../services/kb/index-health.service.js";
import {
  orgObjectId,
  parseDateRange,
  parseLimit,
  wrap,
} from "./shared/analytics-scope.js";

const router = Router();

router.use(requireAuth, requireOrg);

/** The agent filter, validated against the caller's org before it is used. */
async function scopedAgentId(req: Request): Promise<string | null> {
  const raw = req.query.agentId;
  if (typeof raw !== "string" || !mongoose.Types.ObjectId.isValid(raw)) return null;
  const owned = await KnowledgeSource.exists({ agentId: raw, organizationId: req.orgId });
  // An agent with no sources yet is still the caller's; fall back to the
  // membership check the agents collection can answer.
  if (owned) return raw;
  const { Agent } = await import("../models/index.js");
  const agent = await Agent.exists({ _id: raw, organizationId: req.orgId });
  return agent ? raw : null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// GET /index-health/chunks — weak chunks, worst first.
router.get(
  "/chunks",
  wrap(async (req, res) => {
    const { since } = parseDateRange(req.query, env.kb.healthWindowDays);
    const report = await scoreChunks({
      organizationId: String(req.orgId),
      agentId: await scopedAgentId(req),
      since,
      limit: parseLimit(req.query.limit, 100, 500),
    });
    res.json(report);
  }),
);

// GET /index-health/gap-clusters — open gaps collapsed into topics.
router.get(
  "/gap-clusters",
  wrap(async (req, res) => {
    const { since } = parseDateRange(req.query, env.kb.healthWindowDays);
    const clusters = await clusterGaps({
      organizationId: String(req.orgId),
      agentId: await scopedAgentId(req),
      since,
      limit: parseLimit(req.query.limit, 200, 500),
    });
    res.json({ clusters, similarityThreshold: env.kb.healthGapSimilarity });
  }),
);

// ---------------------------------------------------------------------------
// Repair 1 — targeted re-ingest
// ---------------------------------------------------------------------------
//
// `POST /knowledge/:id/reingest` already does this and stays the canonical
// route. This one exists because a repair started from the health surface has
// to tear the old vectors down FIRST: the reason you are here is that the
// current vectors are wrong, and upserting over them leaves every chunk the new
// chunking no longer produces exactly where it was.
router.post(
  "/sources/:id/reindex",
  requireOrgRole("admin"),
  wrap(async (req, res) => {
    const source = await KnowledgeSource.findOne({
      _id: req.params.id,
      organizationId: req.orgId,
    });
    if (!source) throw new NotFoundError("Knowledge source not found.");

    const sourceId = source._id.toString();
    await KnowledgeSource.updateOne(
      { _id: source._id },
      {
        $set: { retryCount: 0, ingestAlerted: false, embeddingStatus: "pending" },
        $unset: { embeddingErrorCode: 1, embeddingErrorAction: 1, embeddingError: 1 },
      },
    );

    void logAuditFromReq(req, "kb.source.reindex", sourceId);

    // Fire-and-forget so the request returns, but purge-then-ingest in order so
    // a stale vector is never left behind a shorter re-chunk.
    void (async () => {
      try {
        await purgeSourceVectors(sourceId);
        await ingestSource(sourceId);
      } catch (err) {
        logger.error("[kb] targeted reindex failed", { sourceId, err: (err as Error).message });
      }
    })();

    res.status(202).json({ status: "queued", sourceId });
  }),
);

// ---------------------------------------------------------------------------
// Repair 2 — answer a gap cluster with a Q&A pair
// ---------------------------------------------------------------------------

const answerSchema = z.object({
  agentId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  question: z.string().min(3).max(500),
  answer: z.string().min(3).max(20000),
  /** The gaps this answers. They are closed only if the source is created. */
  gapIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).max(200).default([]),
  /**
   * Authority for the new source. Defaults high: a hand-written answer to a
   * question customers actually asked should outrank whatever the crawler
   * happened to pick up.
   */
  priority: z.number().int().min(-10).max(10).default(5),
});

router.post(
  "/gap-clusters/answer",
  requireOrgRole("admin"),
  enforceKnowledgeQuota,
  validateBody(answerSchema),
  wrap(async (req, res) => {
    const body = req.body as z.infer<typeof answerSchema>;

    const { Agent } = await import("../models/index.js");
    const agent = await Agent.findOne({ _id: body.agentId, organizationId: req.orgId });
    if (!agent) throw new NotFoundError("Agent not found.");

    // Stored as one Q&A block rather than as a bare answer: retrieval embeds
    // the whole chunk, and the question carries the customer's own vocabulary,
    // which is precisely the vocabulary that failed to match anything.
    const content = `Q: ${body.question.trim()}\n\nA: ${body.answer.trim()}`;
    const contentHash = crypto
      .createHash("sha256")
      .update(content.toLowerCase().replace(/\s+/g, " ").trim())
      .digest("hex");

    const dup = await KnowledgeSource.findOne({ agentId: agent._id, contentHash });
    if (dup) throw new ValidationError("That exact Q&A is already in this agent's knowledge base.");

    const source = await KnowledgeSource.create({
      organizationId: req.orgId,
      agentId: agent._id,
      type: "text",
      title: body.question.trim().slice(0, 200),
      content,
      extractedText: content,
      contentHash,
      embeddingStatus: "pending",
      priority: body.priority,
      createdBy: req.auth!.userId,
      version: 1,
    });

    // Close the gaps only after the source exists, and only the caller's own.
    let addressed = 0;
    if (body.gapIds.length > 0) {
      const result = await KnowledgeGap.updateMany(
        { _id: { $in: body.gapIds }, organizationId: req.orgId },
        { $set: { status: "addressed" } },
      );
      addressed = result.modifiedCount ?? 0;
    }

    void logAuditFromReq(req, "kb.gap.answered", source._id.toString(), {
      gapsAddressed: addressed,
    });

    void ingestSource(source._id.toString()).catch((err: Error) =>
      logger.error("[kb] Q&A ingestion failed", { sourceId: source._id, err: err.message }),
    );

    res.status(201).json({ source, gapsAddressed: addressed });
  }),
);

// ---------------------------------------------------------------------------
// Repair 3 — mark stale / lower priority
// ---------------------------------------------------------------------------

const markSchema = z.object({
  stale: z.boolean().optional(),
  priority: z.number().int().min(-10).max(10).optional(),
});

router.post(
  "/sources/:id/mark",
  requireOrgRole("admin"),
  validateBody(markSchema),
  wrap(async (req, res) => {
    const body = req.body as z.infer<typeof markSchema>;
    if (body.stale === undefined && body.priority === undefined) {
      throw new ValidationError("Nothing to change: pass `stale`, `priority`, or both.");
    }

    const source = await KnowledgeSource.findOne({
      _id: req.params.id,
      organizationId: req.orgId,
    });
    if (!source) throw new NotFoundError("Knowledge source not found.");

    if (body.stale !== undefined) {
      source.stale = body.stale;
      source.staleAt = body.stale ? new Date() : undefined;
    }
    if (body.priority !== undefined && body.priority !== (source.priority ?? 0)) {
      source.priority = body.priority;
      // Mirrored onto the chunks, which is where conflict resolution reads it
      // on the hot path. Metadata only: this must never trigger a re-ingest or
      // move `sourceUpdatedAt`.
      await KbChunk.updateMany({ sourceId: source._id }, { $set: { priority: body.priority } });
    }
    source.updatedBy = req.auth!.userId as unknown as typeof source.updatedBy;
    await source.save();

    void logAuditFromReq(req, "kb.source.marked", source._id.toString(), {
      stale: source.stale,
      priority: source.priority,
    });

    res.json(source);
  }),
);

// ---------------------------------------------------------------------------
// Repair 4 — bulk delete never-retrieved sources, behind a review step
// ---------------------------------------------------------------------------

/**
 * How long a review token stays valid.
 *
 * Short, because the set it approves is a claim about the world: "these sources
 * were retrieved by nothing". Leave it valid for a day and an operator can
 * confirm a deletion against evidence that has since stopped being true.
 */
const REVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * A token over the EXACT set being deleted, the org, and the moment it was
 * reviewed.
 *
 * Stateless on purpose: a `pendingDeletions` collection would be one more thing
 * to expire, scope and keep in sync, to express something an HMAC already says.
 * Keyed on `JWT_SECRET`, so a token cannot be minted outside this server.
 */
function reviewToken(orgId: string, sourceIds: string[], issuedAt: number): string {
  const canonical = [...sourceIds].sort().join(",");
  const mac = crypto
    .createHmac("sha256", env.jwtSecret)
    .update(`${orgId}|${issuedAt}|${canonical}`)
    .digest("hex");
  return `${issuedAt}.${mac}`;
}

function verifyReviewToken(orgId: string, sourceIds: string[], token: string): boolean {
  const [issuedRaw, mac] = token.split(".");
  const issuedAt = Number(issuedRaw);
  if (!Number.isFinite(issuedAt) || !mac) return false;
  if (Date.now() - issuedAt > REVIEW_TOKEN_TTL_MS) return false;
  const expected = reviewToken(orgId, sourceIds, issuedAt);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Sources with no chunk retrieved anywhere in the window. */
async function neverRetrievedSources(
  req: Request,
  since: Date,
): Promise<{ _id: mongoose.Types.ObjectId; title: string; chunkCount: number }[]> {
  const agentId = await scopedAgentId(req);
  const match: Record<string, unknown> = {
    organizationId: orgObjectId(req),
    createdAt: { $gte: since },
  };
  if (agentId) match.agentId = new mongoose.Types.ObjectId(agentId);

  const retrieved = await RagTurnMetric.distinct("retrieval.sourceIds", match);
  const retrievedSet = new Set(retrieved.map(String));

  const filter: Record<string, unknown> = {
    organizationId: req.orgId,
    embeddingStatus: "synced",
  };
  if (agentId) filter.agentId = agentId;

  const sources = await KnowledgeSource.find(filter, { title: 1, chunkCount: 1 })
    .limit(5000)
    .lean();

  return sources
    .filter((s) => !retrievedSet.has(String(s._id)))
    .map((s) => ({
      _id: s._id as mongoose.Types.ObjectId,
      title: s.title as string,
      chunkCount: (s.chunkCount as number | undefined) ?? 0,
    }));
}

// The review step. Read-only; it deletes nothing.
router.post(
  "/sources/bulk-delete/preview",
  requireOrgRole("admin"),
  wrap(async (req, res) => {
    const { since } = parseDateRange(req.query, env.kb.healthWindowDays);
    const candidates = await neverRetrievedSources(req, since);
    const ids = candidates.map((c) => String(c._id));
    const issuedAt = Date.now();

    res.json({
      windowSince: since,
      sources: candidates.map((c) => ({
        _id: String(c._id),
        title: c.title,
        chunkCount: c.chunkCount,
      })),
      token: ids.length > 0 ? reviewToken(String(req.orgId), ids, issuedAt) : null,
      expiresInMs: REVIEW_TOKEN_TTL_MS,
    });
  }),
);

const bulkDeleteSchema = z.object({
  sourceIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).min(1).max(500),
  /** The token from the preview of this exact set. */
  token: z.string().min(1),
  /** A second, deliberate gate. Both are required; neither implies the other. */
  confirm: z.literal(true),
});

router.post(
  "/sources/bulk-delete",
  requireOrgRole("admin"),
  validateBody(bulkDeleteSchema),
  wrap(async (req, res) => {
    const body = req.body as z.infer<typeof bulkDeleteSchema>;

    if (!verifyReviewToken(String(req.orgId), body.sourceIds, body.token)) {
      throw new ValidationError(
        "Review token is missing, expired, or does not match this exact set of sources. Re-run the preview and confirm the list you were shown.",
      );
    }

    // Re-check the claim the token approved, against the world as it is NOW. A
    // source that started being retrieved between the preview and the confirm
    // is no longer dead weight, and a token is a receipt for a review, not a
    // licence to delete something that has since changed.
    const { since } = parseDateRange(req.query, env.kb.healthWindowDays);
    const stillDead = new Set(
      (await neverRetrievedSources(req, since)).map((c) => String(c._id)),
    );
    const changed = body.sourceIds.filter((id) => !stillDead.has(id));
    if (changed.length > 0) {
      throw new ValidationError(
        `${changed.length} of these sources have been retrieved since you reviewed them. Re-run the preview.`,
      );
    }

    const sources = await KnowledgeSource.find({
      _id: { $in: body.sourceIds },
      organizationId: req.orgId,
    }).lean();
    if (sources.length !== body.sourceIds.length) {
      throw new ValidationError("One or more sources do not belong to this organization.");
    }

    const deleted: string[] = [];
    for (const s of sources) {
      const id = String(s._id);
      try {
        await purgeSourceVectors(id);
        await KnowledgeSource.deleteOne({ _id: s._id, organizationId: req.orgId });
        deleted.push(id);
      } catch (err) {
        logger.error("[kb] bulk delete failed for source", { sourceId: id, err: (err as Error).message });
      }
    }

    void logAuditFromReq(req, "kb.sources.bulk_deleted", deleted.join(","), {
      count: deleted.length,
    });
    logger.warn("[kb] bulk-deleted never-retrieved sources", {
      organizationId: String(req.orgId),
      count: deleted.length,
    });

    res.json({ deleted: deleted.length, sourceIds: deleted });
  }),
);

export default router;
export { reviewToken, verifyReviewToken, REVIEW_TOKEN_TTL_MS };
