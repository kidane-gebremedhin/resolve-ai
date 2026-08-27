import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { KnowledgeSource, Agent, KbChunk, IngestionEvent } from "../models/index.js";
import { ingestionHealth } from "../services/kb/ingestion-health.service.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { enforceKnowledgeQuota } from "../middleware/plan-limit.middleware.js";
import { requireOrgRole } from "../middleware/org-role.middleware.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import { ingestSource, purgeSourceVectors } from "../services/kb/ingestion.service.js";
import { startCrawl } from "../services/kb/firecrawl.service.js";
import { parseFile, sourceTypeFor } from "../services/kb/parsers.js";
import { assertSignatureMatches, FileSignatureError } from "../services/kb/file-signature.js";
import { logger } from "../config/logger.js";
import { logAuditFromReq } from "../services/audit.service.js";
import type { Server as IoServer } from "socket.io";

const router = Router();
router.use(requireAuth, requireOrg);
// Knowledge curation is agent-level work; viewers are read-only.
router.use(requireOrgRole("agent"));

// 25 MB upload cap aligns with __specs/04-pinecone-firecrawl.md per-plan limits.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a 24-char id");

const createTextSchema = z.object({
  agentId: objectId,
  title: z.string().min(1),
  content: z.string().min(1),
});

const createUrlSchema = z.object({
  agentId: objectId,
  title: z.string().min(1),
  url: z.string().url(),
});

// Resolve + authorize the target agent (knowledge is keyed by (org, agentId)).
// `value` comes from the request body (JSON or multipart field).
async function resolveAgentId(orgId: string, value: unknown): Promise<string> {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{24}$/.test(value)) {
    throw new ValidationError("A valid agentId is required for knowledge sources.");
  }
  const agent = await Agent.findOne({ _id: value, organizationId: orgId });
  if (!agent) throw new NotFoundError("Agent not found for this organization.");
  return agent._id.toString();
}

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  /**
   * Authority when two sources contradict each other. Higher wins.
   *
   * Bounded to a small range on purpose: this is a coarse "which document do we
   * stand behind" dial, not a score to be tuned. An unbounded integer invites
   * operators to encode an ordering they will not remember in six months.
   */
  priority: z.number().int().min(-10).max(10).optional(),
});

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function hashContent(text: string): string {
  return crypto.createHash("sha256").update(normalize(text)).digest("hex");
}

router.get("/", async (req: Request, res: Response) => {
  const { type, status, agentId } = req.query as Record<string, string>;
  // Knowledge is per-agent. With an agentId, list just that agent's sources;
  // without one ("All websites" scope) list the whole org's so the operator can
  // still see everything.
  const filter: Record<string, unknown> = { organizationId: req.orgId };
  if (agentId) filter.agentId = agentId;
  if (type) filter.type = type;
  if (status) filter.embeddingStatus = status;
  const sources = await KnowledgeSource.find(filter).sort({ createdAt: -1 });
  res.json(sources);
});

router.post("/text", enforceKnowledgeQuota, validateBody(createTextSchema), async (req: Request, res: Response) => {
  const agentId = await resolveAgentId(req.orgId!, req.body.agentId);
  const contentHash = hashContent(req.body.content);
  const dup = await KnowledgeSource.findOne({ agentId, contentHash });
  if (dup) throw new ConflictError("Duplicate content already exists in this agent's knowledge base.");
  const source = await KnowledgeSource.create({
    organizationId: req.orgId,
    agentId,
    type: "text",
    title: req.body.title,
    content: req.body.content,
    extractedText: req.body.content,
    contentHash,
    embeddingStatus: "pending",
    createdBy: req.auth!.userId,
    version: 1,
  });
  // Kick off async ingestion — don't await so the request can return immediately.
  ingestSource(source._id.toString()).catch((err) =>
    logger.error("[kb] async ingestion failed", { sourceId: source._id, err }),
  );
  res.status(201).json(source);
});

router.post(
  "/upload",
  enforceKnowledgeQuota,
  upload.single("file"),
  async (req: Request, res: Response) => {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) throw new ValidationError("No file uploaded. Expected field name: 'file'.");

    // Check the BYTES before handing the buffer to a parser. Content-Type and
    // the filename are both caller-supplied and neither is evidence
    // (__specs/12 §5).
    const declaredType = sourceTypeFor({
      buffer: file.buffer,
      mimetype: file.mimetype,
      filename: file.originalname,
    });
    try {
      assertSignatureMatches({
        buffer: file.buffer,
        declaredType,
        filename: file.originalname,
      });
    } catch (err) {
      if (err instanceof FileSignatureError) throw new ValidationError(err.message);
      throw err;
    }

    const parsed = await parseFile({
      buffer: file.buffer,
      mimetype: file.mimetype,
      filename: file.originalname,
    });
    if (!parsed.text || parsed.text.trim().length === 0) {
      throw new ValidationError("Could not extract any text from the uploaded file.");
    }

    const agentId = await resolveAgentId(req.orgId!, req.body?.agentId);
    const contentHash = hashContent(parsed.text);
    const dup = await KnowledgeSource.findOne({ agentId, contentHash });
    if (dup) throw new ConflictError("Duplicate content already exists in this agent's knowledge base.");

    const title =
      typeof req.body?.title === "string" && req.body.title.trim().length > 0
        ? req.body.title.trim()
        : file.originalname;

    const source = await KnowledgeSource.create({
      organizationId: req.orgId,
      agentId,
      type: declaredType,
      title,
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      extractedText: parsed.text,
      contentHash,
      embeddingStatus: "pending",
      createdBy: req.auth!.userId,
      version: 1,
    });

    // Fire-and-forget ingestion — text is already extracted, so the worker
    // just chunks/embeds/upserts.
    ingestSource(source._id.toString()).catch((err) =>
      logger.error("[kb] async file ingestion failed", { sourceId: source._id, err }),
    );
    res.status(201).json(source);
  },
);

router.post("/website", enforceKnowledgeQuota, validateBody(createUrlSchema), async (req: Request, res: Response) => {
  const agentId = await resolveAgentId(req.orgId!, req.body.agentId);
  const source = await KnowledgeSource.create({
    organizationId: req.orgId,
    agentId,
    type: "website",
    title: req.body.title,
    sourceUrl: req.body.url,
    contentHash: hashContent(req.body.url),
    embeddingStatus: "pending",
    createdBy: req.auth!.userId,
    version: 1,
  });
  try {
    const { id: crawlId } = await startCrawl(req.body.url);
    source.embeddingStatus = "processing";
    // Stash crawl ID on embeddingError until completion; the firecrawl polling
    // job reads it back via `extractCrawlId(source.embeddingError)`.
    source.embeddingError = `firecrawl:${crawlId}`;
    await source.save();
  } catch (err) {
    source.embeddingStatus = "error";
    source.embeddingError = (err as Error).message;
    await source.save();
  }
  res.status(201).json(source);
});

router.get("/:id", async (req: Request, res: Response) => {
  const source = await KnowledgeSource.findOne({ _id: req.params.id, organizationId: req.orgId });
  if (!source) throw new NotFoundError("Knowledge source not found.");
  res.json(source);
});

router.put("/:id", validateBody(updateSchema), async (req: Request, res: Response) => {
  const source = await KnowledgeSource.findOne({ _id: req.params.id, organizationId: req.orgId });
  if (!source) throw new NotFoundError("Knowledge source not found.");

  const { title, content, priority } = req.body as {
    title?: string;
    content?: string;
    priority?: number;
  };

  if (content !== undefined && source.type !== "text") {
    throw new ValidationError(
      "Content can only be edited for text-type knowledge sources. Re-upload the file or re-crawl the website to refresh other types.",
    );
  }

  let needsReingest = false;

  if (typeof title === "string") {
    source.title = title;
  }

  // Priority is metadata, not content: changing it must NOT trigger a reingest
  // or move `sourceUpdatedAt`. It is mirrored onto the source's chunks directly,
  // because retrieval reads it from there on the hot path.
  if (typeof priority === "number" && priority !== (source.priority ?? 0)) {
    source.priority = priority;
    await KbChunk.updateMany({ sourceId: source._id }, { $set: { priority } });
  }

  if (typeof content === "string" && source.type === "text") {
    const newHash = hashContent(content);
    if (newHash !== source.contentHash) {
      // Make sure the new content doesn't collide with another source.
      const dup = await KnowledgeSource.findOne({
        organizationId: req.orgId,
        contentHash: newHash,
        _id: { $ne: source._id },
      });
      if (dup) throw new ConflictError("Another knowledge source already has this content.");

      source.content = content;
      source.extractedText = content;
      source.contentHash = newHash;
      source.embeddingStatus = "pending";
      source.embeddingError = undefined;
      source.version = (source.version ?? 1) + 1;
      needsReingest = true;
    }
  }

  source.updatedBy = req.auth!.userId as unknown as typeof source.updatedBy;
  await source.save();

  if (needsReingest) {
    // Tear down old vectors first, then re-ingest. Both run fire-and-forget so
    // the request can return immediately.
    (async () => {
      try {
        await purgeSourceVectors(source._id.toString());
        await ingestSource(source._id.toString());
      } catch (err) {
        logger.error("[kb] async update reingest failed", { sourceId: source._id, err });
      }
    })();
  }

  res.json(source);
});

router.post("/:id/reingest", async (req: Request, res: Response) => {
  const source = await KnowledgeSource.findOne({ _id: req.params.id, organizationId: req.orgId });
  if (!source) throw new NotFoundError("Knowledge source not found.");

  // An operator pressing Retry is a deliberate decision to try again, so it
  // clears the automatic retry budget and the alert latch. Without this, a
  // source that exhausted its three attempts could be retried from the UI once
  // and then never again by the reconcile job, and would never re-alert.
  await KnowledgeSource.updateOne(
    { _id: source._id },
    {
      $set: { retryCount: 0, ingestAlerted: false },
      $unset: { embeddingErrorCode: 1, embeddingErrorAction: 1 },
    },
  );

  ingestSource(source._id.toString()).catch((err) =>
    logger.error("[kb] async reingest failed", { sourceId: source._id, err }),
  );
  res.status(202).json({ status: "queued" });
});

/**
 * The stage timeline for one source: what happened, when, and what to do.
 *
 * Grouped by run so an operator sees "this was re-ingested four times" rather
 * than twenty ungrouped rows.
 */
router.get("/:id/events", async (req: Request, res: Response) => {
  const source = await KnowledgeSource.findOne({ _id: req.params.id, organizationId: req.orgId })
    .select({ _id: 1 })
    .lean();
  if (!source) throw new NotFoundError("Knowledge source not found.");

  const events = await IngestionEvent.find({ sourceId: req.params.id })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const runs = new Map<string, typeof events>();
  for (const e of events) {
    const list = runs.get(e.runId) ?? [];
    list.push(e);
    runs.set(e.runId, list);
  }

  res.json({
    runs: [...runs.entries()].map(([runId, stages]) => ({
      runId,
      attempt: stages[0]?.attempt ?? 1,
      startedAt: stages[stages.length - 1]?.createdAt ?? null,
      failed: stages.some((s) => s.status === "error"),
      stages: [...stages].reverse().map((s) => ({
        stage: s.stage,
        status: s.status,
        durationMs: s.durationMs ?? null,
        chunkCount: s.chunkCount ?? null,
        errorCode: s.errorCode ?? null,
        errorMessage: s.errorMessage ?? null,
        errorAction: s.errorAction ?? null,
        createdAt: s.createdAt,
      })),
    })),
  });
});

/** Org-level ingestion health, for the operator dashboard. */
router.get("/health/ingestion", async (req: Request, res: Response) => {
  res.json(await ingestionHealth(req.orgId!));
});

router.delete("/:id", async (req: Request, res: Response) => {
  const source = await KnowledgeSource.findOne({
    _id: req.params.id,
    organizationId: req.orgId,
  });
  if (!source) throw new NotFoundError("Knowledge source not found.");
  const id = source._id.toString();

  // Vector purge is BEST-EFFORT and must never block deletion. Failed/processing
  // sources may have no vectors (or Pinecone may be briefly unreachable); either
  // way the document must always be removed so the UI drops it. Any orphaned
  // vectors get cleaned up by the reconcile job.
  try {
    await purgeSourceVectors(id);
  } catch (err) {
    logger.warn("[kb] vector purge failed during delete (continuing)", {
      sourceId: id,
      err: (err as Error).message,
    });
  }
  await KnowledgeSource.deleteOne({ _id: source._id });
  const io = req.app.get("io") as IoServer | undefined;
  io?.to(`org:${req.orgId}`).emit("knowledge:deleted", { sourceId: id });
  await logAuditFromReq(req, "knowledge.deleted", id, { title: source.title, type: source.type });
  res.json({ _id: id, deleted: true });
});

export default router;
