// Ingestion failure taxonomy.
//
// Before this, a failed ingest stored one raw provider string in
// `embeddingError` and incremented `retryCount`. "It failed" was the entire
// diagnosis, and the retry loop treated every failure identically — so an
// unsupported file type burned three retries over three minutes and then sat
// silent forever, indistinguishable from a rate limit that would have succeeded
// on the next attempt.
//
// The classification exists to answer two different questions with one lookup:
// what should the OPERATOR do about this, and what should the RETRY LOOP do
// about it. Those are not the same question, which is why `retry` is a separate
// field from `message`/`action` rather than inferred from the code at each call
// site.

export type RetryPolicy =
  /** Retrying cannot help. Go to a terminal state an operator can see. */
  | "never"
  /** Bounded retry with backoff. The condition is expected to clear on its own. */
  | "backoff"
  /** Wait for an external condition (budget reset), without consuming attempts. */
  | "deferred";

export type IngestionErrorCode =
  | "unsupported_file_type"
  | "parse_failure"
  | "empty_extraction"
  | "embedding_provider_error"
  | "rate_limited"
  | "budget_exceeded"
  | "pinecone_upsert_failure"
  | "partial_upsert"
  | "timeout"
  | "unknown";

export type ClassifiedError = {
  code: IngestionErrorCode;
  /** Written for an operator, not a developer. No stack traces, no provider jargon. */
  message: string;
  /** What the operator should actually do. Empty means "nothing, it will resolve". */
  action: string;
  retry: RetryPolicy;
  /** The original provider text, kept for support and never shown as the diagnosis. */
  raw?: string;
};

const CATALOG: Record<IngestionErrorCode, Omit<ClassifiedError, "code" | "raw">> = {
  unsupported_file_type: {
    message: "This file type can't be read.",
    action:
      "Convert the file to PDF, DOCX, CSV or plain text and upload it again. Retrying this file will not help.",
    retry: "never",
  },
  parse_failure: {
    message: "The file couldn't be opened. It may be corrupt, password-protected, or not the type its extension claims.",
    action:
      "Open the file locally to confirm it works, remove any password, and re-upload. Retrying will not help until the file changes.",
    retry: "never",
  },
  empty_extraction: {
    // The silent failure this taxonomy exists for: it used to report success.
    message: "The file was read successfully but contains no selectable text.",
    action:
      "This is usually a scanned document or an image-only PDF. Run it through OCR first, or paste the text in as a text source.",
    retry: "never",
  },
  embedding_provider_error: {
    message: "The embedding provider returned an error.",
    action: "No action needed — this retries automatically. Contact support if it persists for more than an hour.",
    retry: "backoff",
  },
  rate_limited: {
    message: "The embedding provider is rate limiting us.",
    action: "No action needed — this retries automatically with increasing delays.",
    retry: "backoff",
  },
  budget_exceeded: {
    message: "This workspace has reached its monthly AI budget, so indexing is paused.",
    action:
      "Indexing resumes automatically when the budget resets, or immediately on a plan upgrade. Retries are not being consumed while it waits.",
    retry: "deferred",
  },
  pinecone_upsert_failure: {
    message: "The search index rejected the write.",
    action: "No action needed — this retries automatically.",
    retry: "backoff",
  },
  partial_upsert: {
    // Distinct from a plain upsert failure: some vectors landed, so the index
    // and our record of it disagree until this is repaired.
    message: "Indexing stopped partway through, leaving this source partially searchable.",
    action:
      "This repairs itself on the next retry, which re-indexes the whole source. Use Retry to repair it now.",
    retry: "backoff",
  },
  timeout: {
    message: "Indexing took too long and was stopped.",
    action:
      "This retries automatically. Very large files are the usual cause — splitting them into smaller sources is more reliable.",
    retry: "backoff",
  },
  unknown: {
    message: "Indexing failed for an unexpected reason.",
    action: "This retries automatically. If it keeps failing, contact support with the source id.",
    retry: "backoff",
  },
};

export function describeError(code: IngestionErrorCode, raw?: string): ClassifiedError {
  return { code, ...CATALOG[code], ...(raw ? { raw } : {}) };
}

/** Every code, for the operator dashboard and for tests that must cover all of them. */
export function allErrorCodes(): IngestionErrorCode[] {
  return Object.keys(CATALOG) as IngestionErrorCode[];
}

export function isPermanent(code: IngestionErrorCode): boolean {
  return CATALOG[code].retry === "never";
}

export function isDeferred(code: IngestionErrorCode): boolean {
  return CATALOG[code].retry === "deferred";
}

/**
 * Map a thrown error to a class.
 *
 * Order matters: the most specific patterns are tested first, because a rate
 * limit reported as "Embedding 429" would otherwise match the generic embedding
 * pattern and be retried on the wrong schedule.
 *
 * Anything unmatched is `unknown`, which retries with backoff. Defaulting an
 * unrecognised failure to permanent would strand sources on a provider error we
 * simply have not seen the wording of yet.
 */
export function classifyError(err: unknown, stage?: string): ClassifiedError {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.toLowerCase();

  if (/unsupported (file )?type|unsupported mime|cannot handle .* type/.test(m)) {
    return describeError("unsupported_file_type", raw);
  }
  if (/budget|quota (reached|exceeded)|over budget/.test(m)) {
    return describeError("budget_exceeded", raw);
  }
  if (/\b429\b|rate limit|too many requests/.test(m)) {
    return describeError("rate_limited", raw);
  }
  if (/timed? ?out|timeout|etimedout|aborted/.test(m)) {
    return describeError("timeout", raw);
  }
  if (/no (extractable |usable )?text|empty extraction|zero chunks/.test(m)) {
    return describeError("empty_extraction", raw);
  }
  if (/password|encrypted|corrupt|malformed|could not parse|parse (error|failed)|invalid pdf|bad zip/.test(m)) {
    return describeError("parse_failure", raw);
  }
  if (/partial upsert|partially indexed/.test(m)) {
    return describeError("partial_upsert", raw);
  }
  if (/pinecone|vector (store|index)|upsert/.test(m)) {
    return describeError("pinecone_upsert_failure", raw);
  }
  if (/embedding|embed /.test(m) || stage === "embed") {
    return describeError("embedding_provider_error", raw);
  }
  return describeError("unknown", raw);
}
