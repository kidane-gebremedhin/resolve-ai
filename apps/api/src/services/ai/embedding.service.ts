// Embedding service — calls OpenAI-compatible embedding endpoint.
// Large documents produce hundreds/thousands of chunks; sending them all in one
// request blows past the provider's per-request input/token limits (so a big
// upload would silently embed only part, or fail). We therefore split into
// fixed-size batches and concatenate the results in order.

const baseUrl = process.env.EMBEDDING_BASE_URL ?? "https://api.openai.com/v1";
const model = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";

const TIMEOUT_MS = Number(process.env.EMBEDDING_TIMEOUT_MS ?? 20_000);
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;
// Inputs per embedding request. OpenAI allows up to 2048, but smaller batches
// keep each request well under token/size limits and make retries cheaper.
const MAX_BATCH = Number(process.env.EMBEDDING_BATCH_SIZE ?? 96);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isTransient(err: unknown): boolean {
  const message = (err as Error)?.message ?? "";
  if (/Embedding (429|5\d\d)/.test(message)) return true;
  return /aborted|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|fetch failed|network/i.test(
    message,
  );
}

/**
 * Deterministic pseudo-embeddings — ONLY for tests / local runs without an
 * embedding key. These are NOT semantically meaningful, so if real KB data is
 * ingested with them, similarity search returns noise. We therefore only allow
 * this path outside production (and when no key is configured).
 */
function pseudoEmbed(texts: string[]): number[][] {
  return texts.map((t) => {
    const buf = new Float32Array(1536);
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    for (let i = 0; i < buf.length; i++) {
      h = (h * 1664525 + 1013904223) >>> 0;
      buf[i] = (h / 0xffffffff) * 2 - 1;
    }
    return Array.from(buf);
  });
}

// One embedding request for a single batch (already size-bounded by `embed`).
async function embedBatch(apiKey: string, texts: string[]): Promise<number[][]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: texts }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Embedding ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as { data: { embedding: number[]; index: number }[] };
      // Sort by `index` so the order matches `texts` even if the API reorders.
      const sorted = [...body.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const out = sorted.map((d) => d.embedding);
      if (out.length !== texts.length) {
        throw new Error(
          `Embedding count mismatch: requested ${texts.length}, got ${out.length}`,
        );
      }
      return out;
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS || !isTransient(err)) break;
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "EMBEDDING_API_KEY is not set — refusing to use pseudo-embeddings in production (KB search would return noise).",
      );
    }
    return pseudoEmbed(texts);
  }

  // Split into size-bounded batches and run them sequentially (keeps us well
  // under provider rate limits), concatenating results in input order.
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const embeddings = await embedBatch(apiKey, batch);
    out.push(...embeddings);
  }
  return out;
}
