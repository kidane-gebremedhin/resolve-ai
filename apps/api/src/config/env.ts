import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

// All AI template params come from env vars — never inline `?? 0.7` at the
// call site. If you need a new tuning knob, add it here, document it in
// .env.example, and read it from `env.*`.
export const env = {
  nodeEnv: optional("NODE_ENV", "development"),
  // How many reverse proxies sit in front of the API, or an explicit list of
  // trusted proxy addresses. Express uses this to decide how much of
  // X-Forwarded-For to believe when computing `req.ip`.
  //
  // This USED to be `true`, meaning "trust the whole chain". That let any
  // client send their own X-Forwarded-For and be seen as whatever IP they
  // liked — which silently defeats every IP-keyed rate limit in the app (the
  // login throttle, the coupon brute-force throttle, the contact form).
  // express-rate-limit warns about exactly this: ERR_ERL_PERMISSIVE_TRUST_PROXY.
  //
  // `1` is right for the standard single reverse proxy (Coolify, nginx, a load
  // balancer). Raise it if you genuinely have more hops, or set a comma list of
  // proxy IPs/CIDRs to be explicit.
  trustProxy: optional("TRUST_PROXY", "1"),
  port: Number(optional("PORT", "4000")),
  // Sentry smoke-test endpoints (/api/v1/debug-sentry). They throw on purpose
  // and are useful right after a deploy, but they are unauthenticated, so they
  // default OFF in production and must be switched on deliberately.
  debugEndpointsEnabled:
    optional("DEBUG_ENDPOINTS_ENABLED", "").toLowerCase() === "true" ||
    (optional("DEBUG_ENDPOINTS_ENABLED", "") === "" &&
      optional("NODE_ENV", "development") !== "production"),
  // URLs come from the environment (no host hardcoded). Required so a missing
  // value fails fast instead of defaulting to a wrong host.
  apiBaseUrl: required("API_BASE_URL"),
  corsOrigins: required("CORS_ORIGINS").split(","),
  mongoUri: required("MONGODB_URI"),
  redisUrl: process.env.REDIS_URL,
  jwtSecret: required("JWT_SECRET"),
  jwtAccessExpiry: optional("JWT_ACCESS_EXPIRY", "15m"),
  jwtRefreshExpiry: optional("JWT_REFRESH_EXPIRY", "7d"),
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  sessionTokenExpiryHours: Number(optional("SESSION_TOKEN_EXPIRY_HOURS", "24")),
  ai: {
    model: required("AI_MODEL"),
    temperature: Number(required("AI_TEMPERATURE")),
    enhanceTemperature: Number(required("AI_ENHANCE_TEMPERATURE")),
    suggestionsTemperature: Number(required("AI_SUGGESTIONS_TEMPERATURE")),
    confidenceThreshold: Number(required("AI_CONFIDENCE_THRESHOLD")),
    kbSearchTopK: Number(required("AI_KB_SEARCH_TOP_K")),
    kbSearchMinScore: Number(required("AI_KB_SEARCH_MIN_SCORE")),
    kbGapScoreThreshold: Number(optional("AI_KB_GAP_SCORE_THRESHOLD", "0.65")),
    // Vision model for image attachments (defaults to AI_MODEL when unset)
    visionModel: process.env.AI_VISION_MODEL ?? null,
    // Max image size (bytes) before resizing for the vision API (default 4 MB)
    visionMaxImageBytes: Number(optional("AI_VISION_MAX_IMAGE_BYTES", "4194304")),
    // Upstream chat-completion timeout (ms) — a fire-and-forget reply must
    // never hang forever on the provider.
    llmTimeoutMs: Number(optional("AI_LLM_TIMEOUT_MS", "30000")),
    // Retries for a transient upstream failure (429 / 5xx / socket reset).
    llmMaxRetries: Number(optional("AI_LLM_MAX_RETRIES", "2")),
    // Hard ceiling on agent↔tool round trips in one turn, so a model that
    // loops on a failing tool can't spend the org's budget indefinitely.
    maxToolTurns: Number(optional("AI_MAX_TOOL_TURNS", "10")),

    // ---- Query understanding (see __specs/40-query-understanding.md) ----
    // Rewriting sits in front of every KB search: it resolves follow-ups,
    // strips filler, fixes typos and expands the query. It is an enhancement,
    // never a dependency — every failure path falls back to the raw query.
    queryRewriteEnabled: optional("AI_QUERY_REWRITE_ENABLED", "false").toLowerCase() === "true",
    // A small, fast model, NOT the answering model: this runs on the hot path
    // and its only job is to produce a better search string.
    queryRewriteModel: optional("AI_QUERY_REWRITE_MODEL", "anthropic/claude-haiku-4.5"),
    // Rewriting that takes longer than this is worse than not rewriting at all.
    queryRewriteTimeoutMs: Number(optional("AI_QUERY_REWRITE_TIMEOUT_MS", "4000")),
    // How many prior turns the rewriter sees when resolving a follow-up.
    queryRewriteHistoryTurns: Number(optional("AI_QUERY_REWRITE_HISTORY_TURNS", "6")),
    // Paraphrases generated per query, fused with RRF. 0 disables expansion.
    queryExpansionCount: Number(optional("AI_QUERY_EXPANSION_COUNT", "2")),
    // HyDE: embed a hypothetical answer instead of the question. Corpus-
    // dependent, so it stays off until the eval harness says it wins here.
    queryHydeEnabled: optional("AI_QUERY_HYDE_ENABLED", "false").toLowerCase() === "true",
    // At most ONE extra retrieval round for multi-hop questions whose second
    // query only becomes writable after seeing the first round's results.
    queryFollowUpRoundEnabled:
      optional("AI_QUERY_FOLLOWUP_ROUND_ENABLED", "false").toLowerCase() === "true",

    // ---- Grounded prompting (see __specs/43-grounded-prompting.md) ----
    /**
     * Token ceiling for the retrieved-context block. Enforced by dropping WHOLE
     * passages from the bottom of the ranked list, never by truncating one: a
     * half-passage is a citation that no longer supports its sentence.
     */
    contextTokenBudget: Number(optional("AI_CONTEXT_TOKEN_BUDGET", "3000")),
    /**
     * Share of factual sentences allowed to carry no citation before the turn's
     * confidence is lowered. This is what turns faithfulness from a metric that
     * is measured after the fact into a control that acts during the turn: past
     * this ratio, confidence drops and the existing `AI_CONFIDENCE_THRESHOLD`
     * escalation catches it.
     */
    maxUncitedRatio: Number(optional("AI_MAX_UNCITED_RATIO", "0.5")),
  },

  // ---- Hybrid retrieval (see __specs/41-hybrid-retrieval.md) ----
  kb: {
    // 1.0 = dense only, 0.0 = lexical only. 0.7 is not a guess: it is the peak
    // of a measured sweep over the eval fixture set (Recall@5 1.000 and MRR
    // 0.912 against 0.973 / 0.856 dense-only). Both extremes score worse than
    // the blend, which is what genuine fusion looks like rather than one leg
    // dominating. See __specs/41-hybrid-retrieval.md for the full curve.
    hybridAlpha: Number(optional("KB_HYBRID_ALPHA", "0.7")),
    // `rrf` fuses on rank, `weighted` on normalised score. RRF is the default
    // because cosine and MongoDB text scores are not on comparable scales.
    hybridFusion: optional("KB_HYBRID_FUSION", "rrf") as "rrf" | "weighted",
    // The lexical leg is an enhancement: past this, the turn proceeds dense-only.
    lexicalTimeoutMs: Number(optional("KB_LEXICAL_TIMEOUT_MS", "1500")),
    // Prepend the heading path to the embedded text at ingest.
    headingPathEmbedding:
      optional("KB_HEADING_PATH_EMBEDDING", "true").toLowerCase() === "true",

    // ---- Stage 2: cross-encoder reranking (see __specs/42-reranking.md) ----
    rerankEnabled: optional("KB_RERANK_ENABLED", "false").toLowerCase() === "true",
    rerankProvider: optional("KB_RERANK_PROVIDER", "pinecone") as "pinecone" | "llm",
    rerankModel: optional("KB_RERANK_MODEL", "bge-reranker-v2-m3"),
    /**
     * Stage-1 candidate count. DISTINCT from `AI_KB_SEARCH_TOP_K`, which is the
     * final context size: stage 1 optimises recall and casts wide, stage 2
     * optimises precision and cuts down. One number cannot serve both, and
     * before this existed `AI_KB_SEARCH_TOP_K` was silently doing so — which
     * meant widening the candidate pool also widened the prompt.
     */
    rerankCandidates: Number(optional("KB_RERANK_CANDIDATES", "50")),
    rerankTimeoutMs: Number(optional("KB_RERANK_TIMEOUT_MS", "3000")),
    /**
     * Relevance floor on the CALIBRATED rerank score, applied to the BEST
     * candidate rather than to each one.
     *
     * 0.0005 looks absurdly low and is the measured value. `bge-reranker-v2-m3`
     * is decisive rather than graded: it scores the passage that answers the
     * query around 0.5 and gives everything else 1e-3 or less. The useful signal
     * is therefore the gap, not the magnitude, and a floor tuned by intuition
     * (0.02 was the first guess) rejects evidence for every query phrased less
     * directly than the documents — 42 percent of the eval set came back as "no
     * evidence" against 18 percent that genuinely had none.
     *
     * Swept over the eval set: 0.02 → 0.422, 0.005 → 0.333, 0.001 → 0.222,
     * 0.0005 → 0.200, against an ideal of 0.178. See __specs/42-reranking.md.
     */
    rerankMinScore: Number(optional("KB_RERANK_MIN_SCORE", "0.0005")),

    // ---- Conflicting knowledge (see __specs/44-knowledge-conflicts.md) ----
    conflictDetectionEnabled:
      optional("KB_CONFLICT_DETECTION_ENABLED", "false").toLowerCase() === "true",
    /**
     * How close the top two sources' scores must be before a contradiction is
     * even considered possible, as a fraction of the leader's score.
     *
     * This is the budget gate. A source scoring far below the leader is not
     * making a competing claim, it is weaker evidence, and treating every long
     * tail as a potential conflict would put an LLM call on nearly every turn.
     */
    conflictScoreGap: Number(optional("KB_CONFLICT_SCORE_GAP", "0.15")),

    // ---- Ingestion recovery (see __specs/04-pinecone-firecrawl.md) ----
    /** Bounded retries for a TRANSIENT failure. Permanent classes consume none. */
    ingestMaxRetries: Number(optional("KB_INGEST_MAX_RETRIES", "3")),
    /**
     * A source in `processing` for longer than this was interrupted — almost
     * always the API restarting mid-ingest — and is re-queued.
     */
    ingestStuckProcessingMs: Number(optional("KB_INGEST_STUCK_PROCESSING_MS", String(15 * 60_000))),
    /**
     * Base delay for retry backoff, doubled per attempt. Replaces retrying on a
     * flat 60s loop, which hammered a rate-limited provider at exactly the rate
     * that got us limited.
     */
    ingestRetryBackoffMs: Number(optional("KB_INGEST_RETRY_BACKOFF_MS", "60000")),
    /**
     * Failure rate across an org's sources that raises an operator alert.
     * A single broken upload is noise; a third of the corpus failing is not.
     */
    ingestFailureAlertRate: Number(optional("KB_INGEST_FAILURE_ALERT_RATE", "0.3")),
    /** Minimum sources before the rate above means anything. */
    ingestFailureAlertMinSources: Number(optional("KB_INGEST_FAILURE_ALERT_MIN_SOURCES", "5")),

    // ---- Index health (see __specs/04-pinecone-firecrawl.md) ----
    //
    // Turning query logs and thumbs into repairs. The scheduled half is OFF by
    // default: the scoring has to be watched against real traffic before a job
    // is allowed to act on it, and a job that re-embeds customer knowledge on a
    // metric nobody has checked is a bad trade.
    indexHealthEnabled: optional("KB_INDEX_HEALTH_ENABLED", "false").toLowerCase() === "true",
    /** How often the job wakes. It only does work inside the off-peak hour below. */
    indexHealthIntervalMs: Number(optional("KB_INDEX_HEALTH_INTERVAL_MS", "1800000")),
    /**
     * UTC hour the job is allowed to work in. Re-embedding competes with live
     * retrieval for the same provider quota, so it runs when nobody is asking.
     */
    indexHealthHourUtc: Number(optional("KB_INDEX_HEALTH_HOUR_UTC", "3")),
    /**
     * Ceiling on sources re-embedded per run. A drifted corpus is repaired over
     * several nights rather than in one burst that looks like a full reindex to
     * the embedding provider and to the bill.
     */
    indexHealthMaxReembedPerRun: Number(optional("KB_INDEX_HEALTH_MAX_REEMBED_PER_RUN", "10")),

    /** Telemetry window every health metric is computed over. */
    healthWindowDays: Number(optional("KB_HEALTH_WINDOW_DAYS", "30")),
    /**
     * Retrievals a chunk needs before a RATE about it means anything. A chunk
     * retrieved twice, once downvoted, is not a 50 percent downvote rate.
     */
    healthMinRetrievals: Number(optional("KB_HEALTH_MIN_RETRIEVALS", "5")),
    /** Downvote rate among citing answers that marks a chunk misleading. */
    healthDownvoteRate: Number(optional("KB_HEALTH_DOWNVOTE_RATE", "0.3")),
    /** Citation rate at or below which a retrieved chunk counts as ignored. */
    healthUncitedRate: Number(optional("KB_HEALTH_UNCITED_RATE", "0.2")),
    /**
     * Score a chunk must reach before "never cited" reads as a chunking defect
     * rather than as a passage that merely scraped into the prompt.
     */
    healthStrongScore: Number(optional("KB_HEALTH_STRONG_SCORE", "0.5")),
    /**
     * Cosine similarity at which two gap queries are the same question.
     *
     * 0.55 is measured, not guessed, and the first guess (0.86) was wrong by a
     * lot: on a real corpus it merged one pair out of seven queries, which is
     * not clustering. Swept over the seeded gap set — 0.86 → 6 clusters from 7
     * queries, 0.75 → 5, 0.60 → 4, 0.55 → 3 with the five paraphrases of one
     * question finally together. See __specs/04-pinecone-firecrawl.md.
     *
     * The sweep was over 7 queries from one corpus, so treat it as a starting
     * point rather than a tuned optimum. It is an env var because the right
     * value depends on the embedding model and on how varied the questions are.
     */
    healthGapSimilarity: Number(optional("KB_HEALTH_GAP_SIMILARITY", "0.55")),
    /**
     * Tag stamped on cached gap embeddings. Changing the embedding model must
     * change this, or clustering silently compares two vector spaces.
     */
    healthEmbeddingModelTag: optional(
      "KB_HEALTH_EMBEDDING_MODEL_TAG",
      optional("EMBEDDING_MODEL", "default"),
    ),
  },
  // ---- Online RAG telemetry (see __specs/39-rag-evaluation.md) ----
  //
  // The offline harness scores a fixed golden set. This scores production, which
  // is the only place the knowledge base an operator actually wrote gets
  // measured. Everything here is off the reply path: one fire-and-forget
  // document write per turn, plus a sampled judge call.
  rag: {
    telemetryEnabled: optional("RAG_TELEMETRY_ENABLED", "true").toLowerCase() === "true",
    /**
     * TTL on `ragturnmetrics`, in days. Matches the 90 days `ToolCallLog` uses;
     * __specs/12 is the authority on why per-turn telemetry is not kept forever.
     */
    retentionDays: Number(optional("RAG_TELEMETRY_RETENTION_DAYS", "90")),

    /**
     * Share of turns sent to the LLM judge for an online faithfulness score.
     *
     * 5 percent, because this is a trend line, not an audit: at a few hundred
     * turns a day it is enough to move a rolling average within a day, and it
     * keeps the judge bill to a rounding error against the answering model.
     * Set 0 to disable sampling entirely without turning off telemetry.
     */
    faithfulnessSampleRate: Number(optional("RAG_FAITHFULNESS_SAMPLE_RATE", "0.05")),
    /**
     * The judge model. Must NOT be the answering model — a model grading its own
     * output is not an evaluation. Defaults to the same model the offline
     * harness uses so online and offline faithfulness stay comparable.
     */
    faithfulnessJudgeModel: optional(
      "RAG_FAITHFULNESS_JUDGE_MODEL",
      optional("RAG_EVAL_JUDGE_MODEL", "anthropic/claude-sonnet-4.5"),
    ),
    /** The judge runs out of band, but it still must not hang a worker forever. */
    faithfulnessTimeoutMs: Number(optional("RAG_FAITHFULNESS_TIMEOUT_MS", "20000")),

    // ---- Quality alerts ----
    alertsEnabled: optional("RAG_ALERT_ENABLED", "true").toLowerCase() === "true",
    /** Rolling window the rates are computed over. */
    alertWindowMinutes: Number(optional("RAG_ALERT_WINDOW_MINUTES", "60")),
    /**
     * Turns required in the window before a rate means anything. Three turns of
     * which one missed is not a 33 percent no-hit rate, it is three turns.
     */
    alertMinTurns: Number(optional("RAG_ALERT_MIN_TURNS", "20")),
    alertNoHitRate: Number(optional("RAG_ALERT_NO_HIT_RATE", "0.4")),
    alertLowConfidenceRate: Number(optional("RAG_ALERT_LOW_CONFIDENCE_RATE", "0.3")),
    alertEscalationRate: Number(optional("RAG_ALERT_ESCALATION_RATE", "0.5")),
    /** Silence per org per rate after one alert, so a bad hour is not a pager storm. */
    alertCooldownMinutes: Number(optional("RAG_ALERT_COOLDOWN_MINUTES", "360")),
    /** How often the alert job sweeps orgs with recent traffic. */
    alertIntervalMs: Number(optional("RAG_ALERT_INTERVAL_MS", "900000")),

    /**
     * Where the offline harness writes its JSON reports, read by the RAG
     * Quality page's eval-history panel.
     *
     * Relative to the API's working directory, which is `apps/api` in dev and
     * in the monorepo image. A deployment that ships only the API has no such
     * directory, and the endpoint answers `available: false` rather than 500 —
     * an offline history is a nice-to-have next to production numbers, not a
     * dependency of the page.
     */
    evalReportsDir: optional("RAG_EVAL_REPORTS_DIR", "../../packages/rag-eval/reports"),
  },

  // Optional LangSmith tracing for the LangGraph agent. Disabled unless a key is
  // present — tracing ships conversation content to LangSmith, so it must be an
  // explicit opt-in rather than something that switches on by accident.
  langsmith: {
    enabled:
      optional("LANGSMITH_TRACING", "false").toLowerCase() === "true" &&
      (process.env.LANGSMITH_API_KEY ?? "").length > 0,
    apiKey: process.env.LANGSMITH_API_KEY ?? null,
    endpoint: optional("LANGSMITH_ENDPOINT", "https://api.smith.langchain.com"),
    project: optional("LANGSMITH_PROJECT", "customer-service-chatbot"),
  },
  // Back-compat alias — older call sites read `env.aiConfidenceThreshold`.
  aiConfidenceThreshold: Number(required("AI_CONFIDENCE_THRESHOLD")),
  // Widget attachment content-extraction caps (read by the upload handler).
  attachmentExtractMaxChars: Number(optional("ATTACHMENT_EXTRACT_MAX_CHARS", "8000")),
  attachmentExtractMaxBytes: Number(optional("ATTACHMENT_EXTRACT_MAX_BYTES", "5242880")),
  // Integration credential vault — AES-256-GCM. Must be exactly 32 bytes (64 hex chars).
  credentialsEncryptionKey: (() => {
    const raw = optional("CREDENTIALS_ENCRYPTION_KEY", "");
    if (raw.length > 0 && raw.length !== 64) {
      throw new Error(
        "CREDENTIALS_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
    return raw;
  })(),
  // Base URL of the web dashboard (used by the OAuth callback redirect).
  // Falls back to localhost for local dev; override in production with the
  // public dashboard URL via WEB_INTERNAL_URL.
  webBaseUrl: optional("WEB_INTERNAL_URL", "http://localhost:3000"),
  // Integration webhook outbound call timeout (ms).
  webhookTimeoutMs: Number(optional("WEBHOOK_TIMEOUT_MS", "10000")),
  // Optional allow-list controlling which integration providers appear on the integrations
  // page. DISPLAY FILTERING ONLY — it never affects connect/execute or existing connections.
  // Comma-separated provider ids (e.g. "jira,stripe,webhook"); matching is case-insensitive and
  // whitespace-trimmed, and unknown ids are silently ignored. Unset/empty → show all providers.
  integrationAllowedTools: ((): Set<string> | null => {
    const raw = process.env.INTEGRATION_ALLOWED_TOOLS;
    if (!raw || !raw.trim()) return null;
    const set = new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
    return set.size > 0 ? set : null;
  })(),
  // OTP expiry for identity-verification step in high-stakes tool calls (seconds).
  otpExpirySeconds: Number(optional("OTP_EXPIRY_SECONDS", "600")),
  // SMTP fallback. The mailer prefers the admin panel's stored SMTP
  // (PlatformSetting.smtp), but falls back to these env vars when it isn't
  // configured — so credentials placed in .env send mail out of the box.
  // SMTP_SECURE forces TLS-on-connect (port 465); otherwise STARTTLS is used.
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(optional("SMTP_PORT", "587")),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    secure: process.env.SMTP_SECURE === "true",
    from: process.env.SMTP_FROM,
  },
  // Where public marketing "Contact Us" submissions are forwarded. When unset the
  // inquiry is still persisted (POST /public/contact) — only the notification email
  // is skipped.
  contactInboxEmail: process.env.CONTACT_INBOX_EMAIL,
  // Widget rate limiting (per contact session, in-memory + optional Redis).
  widgetRateLimit: {
    max: Number(optional("WIDGET_RATE_LIMIT_MAX", "30")),
    windowMs: Number(optional("WIDGET_RATE_LIMIT_WINDOW_MS", "60000")),
  },
  // Abuse detection: JSON array of regex pattern strings checked against
  // incoming widget messages. Default covers common prompt-injection probes.
  abusePatterns: (() => {
    const raw = process.env.ABUSE_PATTERNS;
    if (!raw) {
      return [
        /ignore\s+(previous|all)\s+(instructions?|prompts?)/i,
        /act\s+as\s+(a\s+)?different\s+(ai|model|persona|chatbot)/i,
        /you\s+are\s+now\s+(DAN|jailbroken|unrestricted)/i,
        /forget\s+(everything|your\s+instructions|your\s+guidelines)/i,
      ];
    }
    try {
      const parsed = JSON.parse(raw) as string[];
      return parsed.map((p) => new RegExp(p, "i"));
    } catch {
      return [];
    }
  })(),
};
