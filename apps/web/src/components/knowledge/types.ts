// Shared types for the knowledge client components. Mirrors the API model
// (apps/api/src/models/KnowledgeSource.ts) — keep in sync if that schema
// changes. We intentionally don't import from the API package; the web app
// stays decoupled from server internals.

export type KbType = "text" | "pdf" | "docx" | "excel" | "csv" | "image" | "html" | "website";
export type KbStatus = "pending" | "processing" | "synced" | "error" | "deleting";

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
  embeddingStatus: KbStatus;
  embeddingError?: string;
  lastSyncedAt?: string;
  retryCount?: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};
