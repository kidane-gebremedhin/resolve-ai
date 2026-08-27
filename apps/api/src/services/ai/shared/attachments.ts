// Attachment handling for the reply graph: extracted document text is
// appended to the customer turn as plain text, while images are downscaled and
// inlined as base64 data URIs for the vision model.

import { env } from "../../../config/env.js";
import { getAttachmentBuffer } from "../../attachments.service.js";
import { logger } from "../../../config/logger.js";

export type CurrentAttachment = {
  fileName?: string;
  fileUrl?: string;
  mimeType?: string;
  size?: number;
  extractedText?: string;
};

/** A vision content part in OpenAI chat-completions shape (what LangChain forwards verbatim). */
export type VisionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "auto" } };

// Resize an image buffer to fit within the vision API byte budget.
// Returns a base64 data URI (JPEG) ready to embed in a content block.
export async function toVisionDataUrl(
  buffer: Buffer,
  contentType: string,
  maxBytes: number,
): Promise<string> {
  let out = buffer;
  if (buffer.length > maxBytes) {
    try {
      const { default: sharp } = await import("sharp");
      out = await sharp(buffer)
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch {
      // sharp unavailable or unsupported format — use original, capped at limit
      out = buffer.length > maxBytes ? buffer.subarray(0, maxBytes) : buffer;
    }
  }
  const mime = out === buffer ? contentType : "image/jpeg";
  return `data:${mime};base64,${out.toString("base64")}`;
}

// Append extracted attachment text to a customer turn so the model can answer
// from the file contents (PDFs, docs, sheets). Images carry no extracted text.
export function withAttachmentText(
  content: string,
  attachments?: { fileName?: string | null; extractedText?: string | null }[] | null,
): string {
  if (!attachments || attachments.length === 0) return content;
  const blocks = attachments
    .filter((a) => a.extractedText && a.extractedText.trim().length > 0)
    .map((a) => `\n\n[Attachment: ${a.fileName ?? "file"}]\n${a.extractedText}`);
  return blocks.length ? content + blocks.join("") : content;
}

/**
 * Load every image attachment on the current turn and return it as a vision
 * content part. A single attachment that fails to load is skipped with a warning
 * rather than failing the turn — the customer still gets an answer to the text.
 */
export async function buildImageParts(
  organizationId: string,
  attachments: CurrentAttachment[] | undefined,
): Promise<VisionContentPart[]> {
  if (!attachments || attachments.length === 0) return [];
  const parts: VisionContentPart[] = [];
  for (const att of attachments) {
    if (!(att.mimeType ?? "").startsWith("image/")) continue;
    // Extract sha from the URL: /widget/attachments/<sha>
    const shaMatch = /\/attachments\/([a-f0-9]{64})/i.exec(att.fileUrl ?? "");
    if (!shaMatch) continue;
    try {
      const bufResult = await getAttachmentBuffer(organizationId, shaMatch[1]);
      if (!bufResult) continue;
      const dataUrl = await toVisionDataUrl(
        bufResult.buffer,
        bufResult.contentType,
        env.ai.visionMaxImageBytes,
      );
      parts.push({ type: "image_url", image_url: { url: dataUrl, detail: "auto" } });
    } catch (err) {
      logger.warn("[ai] vision attachment load failed", { err: (err as Error).message });
    }
  }
  return parts;
}
