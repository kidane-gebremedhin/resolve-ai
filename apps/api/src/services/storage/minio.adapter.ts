// MinIO (S3-compatible) storage adapter.
//
// The client is lazy-initialised on first use so unit tests + processes that don't
// touch storage never pay the connection cost. The bucket is auto-created on the
// first putObject / getObject if missing (idempotent — bucketExists + makeBucket).
//
// MinIO encodes user metadata via headers prefixed `x-amz-meta-*`; the SDK strips
// the prefix on read and lowercases keys. We mirror that on write/read here so the
// adapter contract (plain Record<string, string>) is stable across implementations.

import { Client as MinioClient } from "minio";
import { Readable } from "node:stream";
import { logger } from "../../config/logger.js";
import type { GetObjectResult, PutObjectArgs, StorageAdapter } from "./index.js";

const DEFAULT_BUCKET = "csb-attachments";
const DEFAULT_PORT = 9000;
const DEFAULT_REGION = "us-east-1";

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

export class MinioAdapter implements StorageAdapter {
  private client: MinioClient | null = null;
  private bucketReady = false;
  private readonly bucket: string;

  constructor() {
    this.bucket = process.env.MINIO_BUCKET ?? DEFAULT_BUCKET;
  }

  private getClient(): MinioClient {
    if (this.client) return this.client;
    const endpoint = process.env.MINIO_ENDPOINT;
    const accessKey = process.env.MINIO_ACCESS_KEY;
    const secretKey = process.env.MINIO_SECRET_KEY;
    if (!endpoint || !accessKey || !secretKey) {
      // Defensive: the factory should never instantiate this adapter without these,
      // but surface a clear error rather than a cryptic SDK failure if it does.
      throw new Error(
        "MinioAdapter requires MINIO_ENDPOINT, MINIO_ACCESS_KEY, and MINIO_SECRET_KEY.",
      );
    }
    const port = process.env.MINIO_PORT ? Number(process.env.MINIO_PORT) : DEFAULT_PORT;
    const useSSL = parseBool(process.env.MINIO_USE_SSL, false);

    this.client = new MinioClient({
      endPoint: endpoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });
    logger.info("[storage] MinIO client initialised", {
      endpoint,
      port,
      useSSL,
      bucket: this.bucket,
    });
    return this.client;
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    const client = this.getClient();
    const exists = await client.bucketExists(this.bucket).catch(() => false);
    if (!exists) {
      await client.makeBucket(this.bucket, DEFAULT_REGION);
      logger.info("[storage] MinIO bucket created", { bucket: this.bucket });
    }
    this.bucketReady = true;
  }

  async putObject(args: PutObjectArgs): Promise<void> {
    await this.ensureBucket();
    const client = this.getClient();
    // SDK accepts a metadata object where `Content-Type` sets the object's content type,
    // and any other keys become user metadata (sent as x-amz-meta-* headers).
    const metaData: Record<string, string> = {
      "Content-Type": args.contentType,
      ...(args.metadata ?? {}),
    };
    await client.putObject(this.bucket, args.key, args.buffer, args.buffer.length, metaData);
  }

  async getObject(key: string): Promise<GetObjectResult | null> {
    await this.ensureBucket();
    const client = this.getClient();
    let stat;
    try {
      stat = await client.statObject(this.bucket, key);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "NotFound" || code === "NoSuchKey") return null;
      throw err;
    }

    let stream: Readable;
    try {
      stream = await client.getObject(this.bucket, key);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "NotFound" || code === "NoSuchKey") return null;
      throw err;
    }

    // Strip the well-known Content-Type header out of the user-metadata bag so the
    // caller sees a clean Record<string, string>.
    const raw = (stat.metaData ?? {}) as Record<string, unknown>;
    const metadata: Record<string, string> = {};
    let contentType: string | undefined;
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v !== "string") continue;
      const lower = k.toLowerCase();
      if (lower === "content-type") {
        contentType = v;
        continue;
      }
      metadata[lower] = v;
    }

    return {
      stream,
      size: stat.size,
      contentType,
      metadata,
    };
  }

  async presignGetUrl(key: string, expirySeconds = 3600): Promise<string | null> {
    await this.ensureBucket();
    const client = this.getClient();
    return client.presignedGetObject(this.bucket, key, expirySeconds);
  }
}
