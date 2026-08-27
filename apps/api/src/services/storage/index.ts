// Storage adapter abstraction for binary attachments.
//
// Two implementations live alongside this file:
//   - MinioAdapter (S3-compatible, used when MINIO_* env vars are configured)
//   - DiskAdapter  (local `uploads/` directory, fallback for dev / single-node deploys)
//
// The factory in `../../config/storage.ts` picks one at process start.
//
// Object keys are tenant-scoped: callers MUST prefix with `org/<orgId>/` so future
// bucket-policy-based isolation works. Adapters are storage-only — they don't enforce
// tenant rules; the route handler verifies `metadata.organizationId` on every GET.

export interface PutObjectArgs {
  key: string;
  buffer: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface GetObjectResult {
  stream: NodeJS.ReadableStream;
  size: number;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface StorageAdapter {
  putObject(args: PutObjectArgs): Promise<void>;
  getObject(key: string): Promise<GetObjectResult | null>;
  /**
   * Optional: return a presigned GET URL for direct-from-storage download.
   * MinIO supports this; the disk adapter returns null and the caller falls back
   * to streaming the object through the API route.
   */
  presignGetUrl?(key: string, expirySeconds?: number): Promise<string | null>;
  /**
   * Delete every object under a key prefix, returning how many went.
   *
   * Exists for account deletion. Keys are `org/<orgId>/…` by contract, so a
   * prefix delete is how "erase this tenant's files" is expressed — and without
   * it, `DELETE /orgs/current` could purge the database and the vector store
   * while leaving every uploaded attachment on disk, which is not a deletion.
   */
  deleteByPrefix(prefix: string): Promise<number>;
}

export { MinioAdapter } from "./minio.adapter.js";
export { DiskAdapter } from "./disk.adapter.js";
