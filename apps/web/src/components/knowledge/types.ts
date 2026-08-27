// Shared types for the knowledge client components. Mirrors the API model
// (apps/api/src/models/KnowledgeSource.ts) — keep in sync if that schema
// changes. We intentionally don't import from the API package; the web app
// stays decoupled from server internals.

export type KbType = "text" | "pdf" | "docx" | "excel" | "csv" | "image" | "html" | "website";
/**
 * `empty` is distinct from `synced`: the file was read but produced no
 * searchable text (a scanned PDF, an empty crawl). It used to report as synced,
 * which made a source that retrieves nothing look like a working one.
 */
export type KbStatus =
  | "pending"
  | "processing"
  | "synced"
  | "empty"
  | "error"
  | "deleting";

export type KnowledgeSource = {
  _id: string;
  organizationId: string;
  type: KbType;
  title: string;
  content?: string;
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  sourceUrl?: string;
  contentHash: string;
  extractedText?: string;
  chunkCount?: number;
  /**
   * Authority when two sources contradict each other. Higher wins.
   * Optional: sources created before conflict resolution existed have none,
   * and are treated as 0.
   */
  priority?: number;
  /** When the source's CONTENT last changed. Breaks a priority tie. */
  sourceUpdatedAt?: string;
  embeddingStatus: KbStatus;
  embeddingError?: string;
  /** Taxonomy code for the failure, e.g. `parse_failure`. */
  embeddingErrorCode?: string;
  /** What the operator should do about it. */
  embeddingErrorAction?: string;
  lastSyncedAt?: string;
  retryCount?: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};
