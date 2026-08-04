// Sentry smoke-test endpoints. Public on purpose: they are the fastest way to
// confirm that a freshly deployed API can actually reach Sentry, and they are
// driven from the web app's /sentry-example-page. They expose no data — the
// throwing route just produces a 500 — and are rate limited so nobody can flood
// the Sentry project (or the error log) with them.
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import * as Sentry from "@sentry/node";

const router = Router();

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
