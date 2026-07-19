// Storage adapter factory. Picks MinIO when the necessary env vars are present,
// otherwise falls back to the local disk adapter. The choice is cached for the
// process lifetime — callers always call `getStorage()` and don't hold a reference.
//
// Env vars consumed (read by the adapters themselves):
//   MINIO_ENDPOINT      - hostname (e.g. "minio.local")
//   MINIO_PORT          - default 9000
//   MINIO_USE_SSL       - default false
//   MINIO_ACCESS_KEY    - required for MinIO
//   MINIO_SECRET_KEY    - required for MinIO
//   MINIO_BUCKET        - default "csb-attachments"
// If MINIO_ENDPOINT or MINIO_ACCESS_KEY is missing → DiskAdapter is used.

import { logger } from "./logger.js";
import { DiskAdapter, MinioAdapter, type StorageAdapter } from "../services/storage/index.js";

let cached: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (cached) return cached;
  if (process.env.MINIO_ENDPOINT && process.env.MINIO_ACCESS_KEY) {
    logger.info("[storage] Using MinIO adapter");
    cached = new MinioAdapter();
  } else {
    const localPath = process.env.STORAGE_LOCAL_PATH;
    logger.info("[storage] Using local-disk adapter", { path: localPath ?? "uploads/ (default)" });
    cached = new DiskAdapter(localPath);
  }
  return cached;
}

/** Test-only: clear the cached adapter so a different one can be picked up. */
export function resetStorageForTests(): void {
  cached = null;
}
