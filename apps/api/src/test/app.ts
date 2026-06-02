// Test-only Express app construction. Mirrors `src/index.ts` but never calls
// `listen()` — supertest drives the server in-process. We DO NOT import
// `src/index.ts` because it would start the HTTP and socket servers and would
// also call `connectDb()`, fighting with the mongoose connection that
// `test/setup.ts` already owns.
//
// `./patch-router.js` is imported first (side-effect only) to wrap async
// handlers — see that file for the full rationale.

import "./patch-router.js";

import express, { type Express } from "express";
import cors from "cors";
import routes from "../routes/index.js";
import { errorHandler } from "../middleware/error-handler.middleware.js";

export function createApp(): Express {
  const app = express();
  // helmet adds security headers but interferes with nothing supertest needs;
  // we skip it here to keep test responses small and predictable.
  app.use(cors({ origin: "*", credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/v1", routes);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Route not found." } });
  });

  app.use(errorHandler);

  return app;
}
