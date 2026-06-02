// Knowledge-base file parsers — extract plain text from uploaded files.
// Per __specs/04-pinecone-firecrawl.md (sections: PDF/DOCX/Excel/CSV/Plain-Text).
//
// Each parser receives a Buffer + mimetype + filename and returns extracted
// text plus optional meta (page count, sheet names, etc.). The dispatcher
// (`parseFile`) routes by mimetype first, then falls back to filename
// extension so tools that send `application/octet-stream` (curl, etc.)
// still work.

import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { PDFParse } from "pdf-parse";
import { ValidationError } from "../../utils/errors.js";

export type ParseInput = {
  buffer: Buffer;
  mimetype: string;
  filename: string;
};

export type ParseOutput = {
  text: string;
  meta?: Record<string, unknown>;
};

const PDF_MIMES = new Set(["application/pdf"]);
const DOCX_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const EXCEL_MIMES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/x-csv",
  "text/csv",
]);
const TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);
const HTML_MIMES = new Set(["text/html", "application/xhtml+xml"]);

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

async function parsePdf(buffer: Buffer): Promise<ParseOutput> {
  // pdf-parse v2 exposes a PDFParse class; convert Buffer to Uint8Array first.
  const data = new Uint8Array(buffer);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return {
      text: result.text ?? "",
      meta: { pages: result.total },
    };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function parseDocx(buffer: Buffer): Promise<ParseOutput> {
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: result.value ?? "",
    meta: result.messages?.length ? { warnings: result.messages.length } : undefined,
  };
}

function parseSpreadsheet(buffer: Buffer): ParseOutput {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetNames = workbook.SheetNames;
  const parts: string[] = [];
  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    parts.push(`# ${name}\n${csv}`);
  }
  return {
    text: parts.join("\n\n---\n\n"),
    meta: { sheets: sheetNames },
  };
}

function parseText(buffer: Buffer): ParseOutput {
  return { text: buffer.toString("utf8") };
}

function parseHtml(buffer: Buffer): ParseOutput {
  const raw = buffer.toString("utf8");
  // Strip <script>/<style> blocks first, then all remaining tags, then collapse whitespace.
  const noScripts = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  const stripped = noScripts.replace(/<[^>]+>/g, " ");
  // Decode the handful of common entities we'll see.
  const decoded = stripped
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return { text: decoded.replace(/\s+/g, " ").trim() };
}

export async function parseFile(input: ParseInput): Promise<ParseOutput> {
  const { buffer, mimetype, filename } = input;
  const ext = extOf(filename);

  if (PDF_MIMES.has(mimetype) || ext === "pdf") {
    return parsePdf(buffer);
  }
  if (DOCX_MIMES.has(mimetype) || ext === "docx") {
    return parseDocx(buffer);
  }
  if (EXCEL_MIMES.has(mimetype) || ext === "xlsx" || ext === "xls" || ext === "csv") {
    return parseSpreadsheet(buffer);
  }
  if (HTML_MIMES.has(mimetype) || ext === "html" || ext === "htm") {
    return parseHtml(buffer);
  }
  if (TEXT_MIMES.has(mimetype) || ext === "txt" || ext === "md" || ext === "markdown") {
    return parseText(buffer);
  }

  throw new ValidationError(
    `Unsupported file type for knowledge ingestion: ${mimetype || ext || "unknown"}`,
    { filename, mimetype },
  );
}

/** Map a parsed file to a KnowledgeSource `type` enum value. */
export function sourceTypeFor(input: ParseInput): "pdf" | "docx" | "excel" | "csv" | "html" | "text" {
  const ext = extOf(input.filename);
  const { mimetype } = input;
  if (PDF_MIMES.has(mimetype) || ext === "pdf") return "pdf";
  if (DOCX_MIMES.has(mimetype) || ext === "docx") return "docx";
  if (ext === "csv" || mimetype === "text/csv" || mimetype === "application/x-csv") return "csv";
  if (EXCEL_MIMES.has(mimetype) || ext === "xlsx" || ext === "xls") return "excel";
  if (HTML_MIMES.has(mimetype) || ext === "html" || ext === "htm") return "html";
  return "text";
}
