// Sentry first — it patches http/express/mongoose as they load, so nothing may
// be imported above this line.
import "./instrument.js";
import "express-async-errors";
import net from "node:net";
import dns from "node:dns";
import { createServer } from "node:http";
import express from "express";
import * as Sentry from "@sentry/node";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import mongoose from "mongoose";
import { env } from "./config/env.js";
import { connectDb } from "./config/db.js";
import { logger } from "./config/logger.js";
import routes from "./routes/index.js";
import { errorHandler } from "./middleware/error-handler.middleware.js";
import { ApiError } from "./utils/errors.js";
import { attachSocketServer } from "./socket/index.js";
import { startJobs } from "./jobs/index.js";
import { initLangSmithTracing } from "./services/ai/llm/tracing.js";

// Network hardening: on hosts with broken/absent IPv6 routing, Node's
// Happy-Eyeballs (`autoSelectFamily`, default-on since Node 20) stalls when it
// races an unreachable IPv6 address rather than falling back to IPv4 — causing
// "fetch failed" (ETIMEDOUT) on dual-stack APIs (Google OAuth token exchange,
// Google APIs, etc.) even though IPv4-only hosts and curl work. Prefer IPv4 and
// disable the racing so outbound integration/auth calls connect reliably.
try {
  dns.setDefaultResultOrder("ipv4first");
  net.setDefaultAutoSelectFamily(false);
} catch {
  /* older/newer Node without these APIs — best effort */
}

async function main() {
  await connectDb();

  const app = express();
  // Trust the reverse proxy (nginx / load balancer) so `req.ip` reflects the
  // real client address (from X-Forwarded-For) instead of the proxy's — but
  // only as many hops as actually exist. See the TRUST_PROXY note in
  // config/env.ts: trusting the entire chain lets a client forge their own
  // source IP and walk straight through the IP-based rate limits.
  const trustProxy = /^\d+$/.test(env.trustProxy)
    ? Number(env.trustProxy)
    : env.trustProxy.includes(",")
      ? env.trustProxy.split(",").map((v) => v.trim()).filter(Boolean)
      : env.trustProxy;
  app.set("trust proxy", trustProxy);
  app.use(helmet());
  // Public widget endpoints are embedded on arbitrary customer sites, so they
  // must accept ANY origin (the embed loader calls /widget/appearance from the
  // host page). They authenticate via bearer session tokens, not cookies, so
  // credentialless reflect-any-origin CORS is safe. Registered BEFORE the
  // global allowlist so it owns the widget routes' preflight.
  app.use("/api/v1/widget", cors({ origin: true }));
  // Everything else (dashboard/admin, cookie-authed) uses the configured
  // allowlist with credentials.
  app.use(cors({ origin: env.corsOrigins, credentials: true }));
  // Capture the raw request body alongside JSON parsing so webhook handlers can
  // verify provider HMAC signatures (Paddle/Stripe sign the exact bytes). Stashing
  // it here — rather than mounting a separate raw parser per route — keeps the
  // global json parser as the single body reader (a second parser would see an
  // already-consumed stream and yield an empty buffer).
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    }),
  );
  app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));

  app.get("/health", async (_req, res) => {
    res.json({
      ok: true,
      mongo: mongoose.connection.readyState === 1 ? "up" : "down",
      uptime: process.uptime(),
      ts: new Date().toISOString(),
    });
  });

  app.use("/api/v1", routes);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Route not found." } });
  });

  // Sentry's error handler must sit after every controller and before our own
  // error middleware. It only reports genuine faults: `ApiError`s below 500 are
  // expected client-side outcomes (401/404/validation) and would drown the
  // project in noise. Mongoose `CastError`s are malformed client input (a
  // non-ObjectId `:id`) that `errorHandler` turns into a 400 — also not a fault.
  // It stashes the event id on `res.sentry`, which `errorHandler` returns to the
  // caller for support lookups.
  Sentry.setupExpressErrorHandler(app, {
    shouldHandleError: (error) =>
      (error as { name?: string }).name !== "CastError" &&
      (!(error instanceof ApiError) || error.status >= 500),
  });

  app.use(errorHandler);

  // Must run before any LangChain runnable is invoked — the SDK reads its
  // tracing configuration straight from process.env at call time.
  initLangSmithTracing();

  const httpServer = createServer(app);
  const io = attachSocketServer(httpServer);
  app.set("io", io);

  httpServer.listen(env.port, () => {
    logger.info(`[api] listening on port ${env.port}`);
  });

  startJobs();

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info(`[api] received ${signal}, closing.`);
    httpServer.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[api] failed to start", err);
  process.exit(1);
});
