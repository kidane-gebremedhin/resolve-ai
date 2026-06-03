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
  },
  // Back-compat alias — older call sites read `env.aiConfidenceThreshold`.
  aiConfidenceThreshold: Number(required("AI_CONFIDENCE_THRESHOLD")),
  // Widget attachment content-extraction caps (read by the upload handler).
  attachmentExtractMaxChars: Number(optional("ATTACHMENT_EXTRACT_MAX_CHARS", "8000")),
  attachmentExtractMaxBytes: Number(optional("ATTACHMENT_EXTRACT_MAX_BYTES", "5242880")),
};
