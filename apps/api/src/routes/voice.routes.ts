// Twilio phone bridge routes.
// POST /voice/twiml — Twilio calls this when a call hits the configured number.
// Returns TwiML instructing Twilio to open a Media Streams WebSocket back to us.
// The WebSocket handler at /voice/phone (registered in index.ts) receives μ-law
// audio, transcribes it, runs generateAiReply(), synthesises the response, and
// streams audio frames back to Twilio.
//
// Requires env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER

import express, { Router, type Request, type Response } from "express";
import { validateTwilioSignature } from "../middleware/twilio-signature.middleware.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

// Twilio posts application/x-www-form-urlencoded, but the app only mounts
// express.json() globally — without this the signed parameters never reach
// req.body and no signature could be verified. Scoped to this router so the
// rest of the API keeps rejecting form posts.
const twilioBody = express.urlencoded({ extended: false, limit: "100kb" });

// Public by necessity — Twilio posts here directly, so the signature check IS
// the authentication. It fails closed when TWILIO_AUTH_TOKEN is unset.
router.post("/twiml", twilioBody, validateTwilioSignature, (_req: Request, res: Response) => {
  const host = _req.get("host") ?? "localhost";
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${host}/voice/phone" />
  </Connect>
  <Say>Please hold while we connect you to our AI assistant.</Say>
</Response>`;
  res.setHeader("Content-Type", "application/xml");
  res.send(twiml);
});

// GET /voice/status — whether the bridge is configured. Authenticated: it
// discloses the account's provisioned phone number, which is not public data.
router.get("/status", requireAuth, (_req: Request, res: Response) => {
  const configured = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER,
  );
  res.json({ configured, phone: process.env.TWILIO_PHONE_NUMBER ?? null });
});

export default router;
