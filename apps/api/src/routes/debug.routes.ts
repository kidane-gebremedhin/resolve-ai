// Sentry smoke-test endpoints. Unauthenticated on purpose: they are the fastest
// way to confirm that a freshly deployed API can actually reach Sentry, and they
// are driven from the web app's /sentry-example-page. They expose no data — the
// throwing route just produces a 500 — and are rate limited so nobody can flood
// the Sentry project (or the error log) with them.
//
// They are still an unauthenticated way for a stranger to burn your error budget
// and confirm the stack in use, so in production they are OFF unless
// DEBUG_ENDPOINTS_ENABLED=true is set deliberately. Outside production they stay
// on, because that is where the smoke test is actually run.
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import * as Sentry from "@sentry/node";
import { env } from "../config/env.js";

const router = Router();

// Registered before the handlers so a disabled deployment answers a plain 404 —
// indistinguishable from a build that never had these routes at all.
router.use("/debug-sentry", (_req, res, next) => {
  if (!env.debugEndpointsEnabled) {
    res.status(404).json({ error: { code: "not_found", message: "Not found." } });
    return;
  }
  next();
});

// 5 requests/minute per IP. Enough to smoke-test a deploy, far too few to be
// worth abusing. Uses the default (IPv6-safe) key generator.
const debugLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: { code: "rate_limited", message: "Sentry debug limit: 5/minute per IP." },
  },
});

/**
 * Throws on purpose. The error reaches `Sentry.setupExpressErrorHandler()` in
 * index.ts, which reports it, and then the normal error handler returns the
 * standard 500 envelope (with `eventId` when Sentry is configured).
 */
router.get("/debug-sentry", debugLimiter, function debugSentryHandler(_req: Request, _res: Response) {
  throw new Error("Sentry backend test error (GET /api/v1/debug-sentry)");
});

/**
 * Non-throwing counterpart: reports a handled message and returns its event id,
 * so the test page can prove connectivity even when a 500 would be disruptive.
 * `eventId: null` means no DSN is configured on this deployment.
 *
 * `isInitialized()` — not `process.env.SENTRY_DSN` — is the source of truth:
 * an uninitialised SDK still hands back a freshly generated event id from
 * `captureMessage()`, which would read as "delivered" when nothing was sent.
 */
router.get("/debug-sentry/message", debugLimiter, (_req: Request, res: Response) => {
  const configured = Sentry.isInitialized();
  const eventId = Sentry.captureMessage("Sentry backend test message", "info");
  res.json({
    ok: true,
    configured,
    eventId: configured ? (eventId ?? null) : null,
    ts: new Date().toISOString(),
  });
});

export default router;
