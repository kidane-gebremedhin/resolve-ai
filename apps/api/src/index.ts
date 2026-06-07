import "express-async-errors";
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import mongoose from "mongoose";
import { env } from "./config/env.js";
import { connectDb } from "./config/db.js";
import { logger } from "./config/logger.js";
import routes from "./routes/index.js";
import { errorHandler } from "./middleware/error-handler.middleware.js";
import { attachSocketServer } from "./socket/index.js";
import { startJobs } from "./jobs/index.js";

async function main() {
  await connectDb();

  const app = express();
  // Trust the reverse proxy (nginx / load balancer) so `req.ip` reflects the
  // real client address (from X-Forwarded-For) instead of the proxy's.
  app.set("trust proxy", true);
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
  app.use(express.json({ limit: "1mb" }));
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

  app.use(errorHandler);

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
