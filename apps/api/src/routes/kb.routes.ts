import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { KnowledgeSource, Agent } from "../models/index.js";
import { requireAuth, requireOrg } from "../middleware/auth.middleware.js";
import { validateBody } from "../middleware/validation.middleware.js";
import { enforceKnowledgeQuota } from "../middleware/plan-limit.middleware.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import { ingestSource, purgeSourceVectors } from "../services/kb/ingestion.service.js";
import { startCrawl } from "../services/kb/firecrawl.service.js";
import { parseFile, sourceTypeFor } from "../services/kb/parsers.js";
import { logger } from "../config/logger.js";
import type { Server as IoServer } from "socket.io";

function emitKbStatus(req: Request, source: {
  _id: { toString(): string };
  organizationId: { toString(): string };
  embeddingStatus?: string | null;
  chunkCount?: number | null;
  lastSyncedAt?: Date | null;
  embeddingError?: string | null;
}): void {
  const io = req.app.get("io") as IoServer | undefined;
  if (!io) return;
  io.to(`org:${source.organizationId.toString()}`).emit("knowledge:updated", {
    sourceId: source._id.toString(),
    embeddingStatus: source.embeddingStatus ?? undefined,
    chunkCount: source.chunkCount ?? undefined,
    lastSyncedAt: source.lastSyncedAt ?? undefined,
    embeddingError: source.embeddingError ?? undefined,
  });
}

const router = Router();
router.use(requireAuth, requireOrg);

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
      type: sourceTypeFor({ buffer: file.buffer, mimetype: file.mimetype, filename: file.originalname }),
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

  const { title, content } = req.body as { title?: string; content?: string };

  if (content !== undefined && source.type !== "text") {
    throw new ValidationError(
      "Content can only be edited for text-type knowledge sources. Re-upload the file or re-crawl the website to refresh other types.",
    );
  }

  let needsReingest = false;

  if (typeof title === "string") {
    source.title = title;
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
  ingestSource(source._id.toString()).catch((err) =>
    logger.error("[kb] async reingest failed", { sourceId: source._id, err }),
  );
  res.status(202).json({ status: "queued" });
});

router.delete("/:id", async (req: Request, res: Response) => {
  const source = await KnowledgeSource.findOne({
    _id: req.params.id,
    organizationId: req.orgId,
  });
  if (!source) throw new NotFoundError("Knowledge source not found.");
  const id = source._id.toString();

  // Purge the Pinecone vectors and drop the document synchronously so the
  // deletion completes within the request (no lingering "deleting" state).
  // `purgeSourceVectors` batches the delete, so large sources are handled too.
  // Only if the purge fails do we fall back to the "deleting" status, which the
  // reconcile job retries — that's what previously left sources stuck forever.
  try {
    await purgeSourceVectors(id);
    await KnowledgeSource.deleteOne({ _id: source._id });
    const io = req.app.get("io") as IoServer | undefined;
    io?.to(`org:${req.orgId}`).emit("knowledge:deleted", { sourceId: id });
    res.json({ _id: id, deleted: true });
  } catch (err) {
    logger.error("[kb] inline vector purge failed; deferring to reconcile job", {
      sourceId: id,
      err: (err as Error).message,
    });
    source.embeddingStatus = "deleting";
    await source.save();
    emitKbStatus(req, source);
    res.json(source);
  }
});

export default router;
