import { Pinecone, type Index, type RecordMetadata } from "@pinecone-database/pinecone";
import { logger } from "./logger.js";

type PineconeVector = {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
};

type QueryArgs = {
  vector: number[];
  topK: number;
  filter?: Record<string, unknown>;
  includeMetadata?: boolean;
};

type QueryResult = {
  matches: { id: string; score: number; metadata?: Record<string, unknown> }[];
};

export interface PineconeIndex {
  upsert(vectors: PineconeVector[]): Promise<void>;
  query(args: QueryArgs): Promise<QueryResult>;
  deleteMany(ids: string[]): Promise<void>;
}

let cached: PineconeIndex | null = null;

/**
 * Pinecone's serverless edge closes idle keep-alive sockets; Node's undici
 * connection pool can then reuse a dead socket, surfacing as a transient
 * `PineconeConnectionError` ("Request failed to reach Pinecone") that succeeds
 * on a fresh connection. Retry those (and other transient network/5xx) errors a
 * few times with backoff before giving up.
 */
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;

function isRetryable(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  const message = (err as Error)?.message ?? "";
  const status = (err as { status?: number })?.status;
  if (name === "PineconeConnectionError") return true;
  if (typeof status === "number" && status >= 500) return true;
  return /failed to reach Pinecone|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|other side closed/i.test(
    message,
  );
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(op: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS || !isRetryable(err)) break;
      const wait = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      logger.warn(
        `[pinecone] ${op} failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${wait}ms: ${(err as Error).message}`,
      );
      await delay(wait);
    }
  }
  throw lastErr;
}

function noopIndex(reason: string): PineconeIndex {
  logger.warn(`[pinecone] running with no-op index: ${reason}`);
  return {
    async upsert() {},
    async query() {
      return { matches: [] };
    },
    async deleteMany() {},
  };
}

function sanitizeMetadata(input: Record<string, unknown> | undefined): RecordMetadata {
  const out: RecordMetadata = {};
  if (!input) return out;
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      out[k] = v as string[];
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

// Pinecone caps each request: ~1000 vectors / 2MB per upsert, and 1000 ids per
// delete. Large documents (hundreds/thousands of chunks) exceed this, so we
// split into batches. Without this a big upload silently lands only partially
// (or the whole request is rejected) and a delete of a large source throws,
// leaving it stuck in `deleting`.
const UPSERT_BATCH = 100;
const DELETE_BATCH = 1000;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// The data-plane host for direct HTTP delete (see deleteMany below). Resolved
// once via the control plane and cached for the process.
let cachedHost: string | null = null;
async function resolveHost(pc: Pinecone, indexName: string): Promise<string> {
  if (cachedHost) return cachedHost;
  const desc = await pc.describeIndex(indexName);
  if (!desc.host) throw new Error(`Pinecone index "${indexName}" has no host`);
  cachedHost = desc.host;
  return cachedHost;
}

function realIndex(
  index: Index,
  pc: Pinecone,
  apiKey: string,
  indexName: string,
): PineconeIndex {
  return {
    async upsert(vectors) {
      if (vectors.length === 0) return;
      for (const batch of chunk(vectors, UPSERT_BATCH)) {
        await withRetry("upsert", () =>
          index.upsert({
            records: batch.map((v) => ({
              id: v.id,
              values: v.values,
              metadata: sanitizeMetadata(v.metadata),
            })),
          }),
        );
      }
    },
    async query({ vector, topK, filter, includeMetadata }) {
      const res = await withRetry("query", () =>
        index.query({
          vector,
          topK,
          filter: filter,
          includeMetadata: includeMetadata ?? true,
        }),
      );
      return {
        matches: (res.matches ?? []).map((m) => ({
          id: String(m.id),
          score: typeof m.score === "number" ? m.score : 0,
          metadata: m.metadata as Record<string, unknown> | undefined,
        })),
      };
    },
    async deleteMany(ids) {
      if (ids.length === 0) return;
      // The SDK's `index.deleteMany(ids)` (v7.2.0) drops the `ids` from the
      // request body — it posts only `{namespace}`, which the server rejects
      // with "Invalid request" (leaving sources stuck in `deleting`). We POST
      // to the data-plane delete endpoint directly, which works reliably.
      const host = await resolveHost(pc, indexName);
      for (const batch of chunk(ids, DELETE_BATCH)) {
        await withRetry("deleteMany", async () => {
          const res = await fetch(`https://${host}/vectors/delete`, {
            method: "POST",
            headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ ids: batch }),
          });
          if (!res.ok) {
            throw new Error(`Pinecone delete ${res.status}: ${await res.text()}`);
          }
        });
      }
    },
  };
}

export function getPineconeIndex(): PineconeIndex {
  if (cached) return cached;
  const apiKey = process.env.PINECONE_API_KEY;
  const indexName = process.env.PINECONE_INDEX;
  if (!apiKey || !indexName) {
    cached = noopIndex("PINECONE_API_KEY or PINECONE_INDEX not set");
    return cached;
  }
  try {
    const pc = new Pinecone({ apiKey });
    cached = realIndex(pc.index(indexName), pc, apiKey, indexName);
    logger.info(`[pinecone] connected to index "${indexName}"`);
    return cached;
  } catch (err) {
    cached = noopIndex(`init failed: ${(err as Error).message}`);
    return cached;
  }
}
