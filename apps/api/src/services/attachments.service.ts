// Shared attachment storage helpers, used by both the widget (contact-session
// auth) and the operator inbox (operator JWT auth) upload/serve routes. Keeping
// the MIME allow-list, key scheme, text extraction, and streaming in one place
// means both surfaces accept the same files and serve them identically.

import crypto from "node:crypto";
import multer from "multer";
import type { Response } from "express";
import { getStorage } from "../config/storage.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { NotFoundError } from "../utils/errors.js";
import { parseFile } from "./kb/parsers.js";

export const ALLOWED_MIME_PREFIXES = ["image/"];
// Widened to match what `parseFile` can extract (PDF/DOCX/Excel/CSV/text/markdown/HTML).
export const ALLOWED_MIME_EXACT = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export function isAllowedAttachmentMime(mimetype: string): boolean {
  return (
    ALLOWED_MIME_PREFIXES.some((p) => mimetype.startsWith(p)) || ALLOWED_MIME_EXACT.has(mimetype)
  );
}

// Object keys are tenant-scoped — `org/<orgId>/<sha>.bin` — so future
// bucket-policy isolation can rely on the prefix. Downloads still verify
// `metadata.organizationId` as defence-in-depth.
export function attachmentKey(orgId: string, sha: string): string {
  return `org/${orgId}/${sha}.bin`;
}

// Shared multer config (in-memory, 10 MB cap) for both upload routes.
export const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Best-effort text extraction so the AI can read the attachment. Never throws —
// an unreadable/oversized file just yields no text (the upload still succeeds).
export async function extractAttachmentText(
  buffer: Buffer,
  mimetype: string,
  filename: string,
): Promise<string | undefined> {
  if (mimetype.startsWith("image/")) return undefined; // no OCR in this bundle
  if (buffer.length > env.attachmentExtractMaxBytes) return "[file too large to read]";
  try {
    const { text } = await parseFile({ buffer, mimetype, filename });
    const trimmed = (text ?? "").trim();
    if (!trimmed) return undefined;
    return trimmed.length > env.attachmentExtractMaxChars
      ? trimmed.slice(0, env.attachmentExtractMaxChars)
      : trimmed;
  } catch (err) {
    logger.warn("[attachments] extraction failed", {
      filename,
      mimetype,
      err: (err as Error).message,
    });
    return undefined;
  }
}

// Stores an uploaded file and returns the content-addressed sha. Callers build
// the surface-specific download URL from the sha.
export async function storeAttachment(args: {
  buffer: Buffer;
  mimetype: string;
  orgId: string;
  metadata: Record<string, string>;
}): Promise<string> {
  const sha = crypto.createHash("sha256").update(args.buffer).digest("hex");
  await getStorage().putObject({
    key: attachmentKey(args.orgId, sha),
    buffer: args.buffer,
    contentType: args.mimetype,
    metadata: { ...args.metadata, organizationId: args.orgId },
  });
  return sha;
}

// Streams a stored attachment to the response, enforcing the cross-tenant guard.
// `Cross-Origin-Resource-Policy: cross-origin` lets <img>/links on a different
// origin (widget iframe, dashboard) load it; helmet's default `same-origin`
// would otherwise break them.
export async function streamStoredAttachment(
  res: Response,
  orgId: string,
  hashParam: string | string[] | undefined,
): Promise<void> {
  const sha = Array.isArray(hashParam) ? hashParam[0] : hashParam;
  if (!sha || !/^[a-f0-9]{64}$/i.test(sha)) {
    throw new NotFoundError("Attachment not found.");
  }
  const obj = await getStorage().getObject(attachmentKey(orgId, sha));
  if (!obj) throw new NotFoundError("Attachment not found.");

  // MinIO lowercases user-metadata keys on read; the disk adapter preserves the
  // case we wrote. Check both spellings to be safe.
  const meta = obj.metadata ?? {};
  const metaOrg = meta.organizationId ?? meta.organizationid;
  if (!metaOrg || metaOrg !== orgId) {
    throw new NotFoundError("Attachment not found.");
  }
  const fileName = meta.fileName ?? meta.filename;

  res.setHeader("Content-Type", obj.contentType ?? "application/octet-stream");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (fileName) {
    res.setHeader("Content-Disposition", `inline; filename="${fileName.replace(/"/g, "")}"`);
  }
  obj.stream.pipe(res);
}
