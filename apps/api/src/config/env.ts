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
  port: Number(optional("PORT", "4000")),
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
  // OTP expiry for identity-verification step in high-stakes tool calls (seconds).
  otpExpirySeconds: Number(optional("OTP_EXPIRY_SECONDS", "600")),
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
