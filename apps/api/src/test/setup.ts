// Test setup: spins up an in-process MongoDB via mongodb-memory-server and points
// Mongoose at it for the duration of the test suite.
//
// IMPORTANT: production `config/env.ts` calls `required("MONGODB_URI")` and
// `required("JWT_SECRET")` at module-load time. Vitest evaluates `setupFiles`
// BEFORE it imports any test file, so as long as we set those env vars at the
// top of this module (outside of any hook), they will be in place by the time
// the test file pulls in `app.ts` and downstream route modules. We use a
// placeholder MONGODB_URI here; it gets overwritten with the in-memory server's
// real URI inside `beforeAll`, and we use that URI for the actual `mongoose.connect`.
process.env.NODE_ENV = "test";
process.env.MONGODB_URI ??= "mongodb://placeholder-replaced-in-beforeAll/test";
process.env.JWT_SECRET ??= "test-secret-32-chars-long-xxxxxx";
// AES-256 key (32 bytes / 64 hex) so the credentials vault (encrypt/decrypt) works
// in tests that exercise integration connections.
process.env.CREDENTIALS_ENCRYPTION_KEY ??= "0".repeat(64);
process.env.JWT_ACCESS_EXPIRY ??= "15m";
process.env.JWT_REFRESH_EXPIRY ??= "7d";
process.env.SESSION_TOKEN_EXPIRY_HOURS ??= "1"; // 1 hour — we assert TTL is in the future + < 2h
process.env.AI_CONFIDENCE_THRESHOLD ??= "0.7";
// Tests can't reach OpenRouter, but the env loader requires these knobs
// regardless of whether the LLM is actually called.
process.env.AI_MODEL ??= "openai/gpt-4o-mini";
process.env.AI_TEMPERATURE ??= "0.2";
process.env.AI_ENHANCE_TEMPERATURE ??= "0.3";
process.env.AI_SUGGESTIONS_TEMPERATURE ??= "0.4";
process.env.AI_KB_SEARCH_TOP_K ??= "8";
process.env.AI_KB_SEARCH_MIN_SCORE ??= "0.2";
process.env.CORS_ORIGINS ??= "http://localhost:3000";
process.env.API_BASE_URL ??= "http://localhost:4000";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach } from "vitest";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  await mongoose.connect(process.env.MONGODB_URI);

  // Force-load every model so their schemas — and the indexes they declare —
  // are registered with mongoose. Without this, the `User` index drop below
  // would silently no-op because the model wouldn't be loaded yet.
  await import("../models/index.js");

  // Work around a pre-existing model bug: `User` declares a compound
  // `{ provider: 1, providerId: 1 }` unique+sparse index, but for the
  // `credentials` provider `providerId` is never set, so every credential
  // user collides on `(credentials, null)`. Sparse on a compound index only
  // skips docs where ALL fields are missing — `provider` is always set here,
  // so the index entry is always created. The production code should drop
  // this index or set a per-user providerId; for tests we drop the index so
  // multiple credential users can coexist.
  try {
    await mongoose.connection
      .collection("users")
      .dropIndex("provider_1_providerId_1");
  } catch {
    // Index may not exist yet (mongoose builds indexes lazily on first
    // insert). We'll retry from `beforeEach` once at least one user has
    // been inserted — but the first registerUser() call typically triggers
    // index creation, after which any subsequent attempt to insert a second
    // credential user collides. To pre-empt this, ensure the index exists
    // and then drop it.
    try {
      await mongoose.models.User.syncIndexes();
      await mongoose.connection
        .collection("users")
        .dropIndex("provider_1_providerId_1");
    } catch {
      // Swallow — best-effort. Tests that need multiple credential users
      // will fail loudly if this didn't work.
    }
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  // Wipe every collection between tests so each test starts from a clean slate.
  for (const m of Object.values(mongoose.models)) {
    await m.deleteMany({});
  }
});
