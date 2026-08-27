// Local-disk storage adapter — the dev / single-node fallback when MinIO is unset.
//
// Layout (under <repo>/uploads/):
//   <key>           -> raw bytes (key may contain `/`, dirs are created on demand)
//   <key>.json      -> sidecar with { contentType, metadata } so getObject can
//                       reconstruct the same shape the MinIO adapter returns
//
// presignGetUrl returns null — callers must stream via the API route.

import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { GetObjectResult, PutObjectArgs, StorageAdapter } from "./index.js";

interface Sidecar {
  contentType: string;
  metadata: Record<string, string>;
}

export class DiskAdapter implements StorageAdapter {
  private readonly root: string;

  constructor(root?: string) {
    // Always resolve to absolute so the path-traversal guard (which uses
    // path.resolve) and path.join produce comparable strings.
    this.root = path.resolve(root ?? path.join(process.cwd(), "uploads"));
  }

  private resolveKey(key: string): { filePath: string; metaPath: string } {
    // Strip any leading slash so the key never escapes the root via `path.resolve`.
    const safe = key.replace(/^[/\\]+/, "");
    const filePath = path.join(this.root, safe);
    const metaPath = `${filePath}.json`;
    // Final guard — make sure the resolved path is still under root.
    if (!filePath.startsWith(path.resolve(this.root) + path.sep) && filePath !== this.root) {
      throw new Error(`Invalid storage key (path traversal): ${key}`);
    }
    return { filePath, metaPath };
  }

  async putObject(args: PutObjectArgs): Promise<void> {
    const { filePath, metaPath } = this.resolveKey(args.key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Idempotent write: content-hashed keys mean we can skip rewriting identical blobs.
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, args.buffer);
    }
    const sidecar: Sidecar = {
      contentType: args.contentType,
      metadata: args.metadata ?? {},
    };
    await fs.writeFile(metaPath, JSON.stringify(sidecar, null, 2));
  }

  async getObject(key: string): Promise<GetObjectResult | null> {
    const { filePath, metaPath } = this.resolveKey(key);
    let sidecar: Sidecar;
    try {
      const raw = await fs.readFile(metaPath, "utf8");
      sidecar = JSON.parse(raw) as Sidecar;
    } catch {
      return null;
    }
    let size: number;
    try {
      const stat = await fs.stat(filePath);
      size = stat.size;
    } catch {
      return null;
    }
    return {
      stream: createReadStream(filePath),
      size,
      contentType: sidecar.contentType,
      metadata: sidecar.metadata ?? {},
    };
  }

  async presignGetUrl(): Promise<string | null> {
    // Local disk can't presign — caller streams via the API route.
    return null;
  }

  /**
   * Remove a whole key prefix, sidecars included.
   *
   * Goes through `resolveKey` so the same path-traversal guard that protects
   * reads and writes protects this too: a recursive delete is the last place to
   * trust a caller-supplied path.
   */
  async deleteByPrefix(prefix: string): Promise<number> {
    const { filePath: dir } = this.resolveKey(prefix.replace(/\/+$/, ""));
    let removed = 0;
    const walk = async (current: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        return; // Nothing stored under this prefix.
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else {
          await fs.rm(full, { force: true });
          // Sidecars are bookkeeping, not objects; only count real blobs.
          if (!entry.name.endsWith(".json")) removed += 1;
        }
      }
      await fs.rm(current, { recursive: true, force: true });
    };
    await walk(dir);
    return removed;
  }
}
