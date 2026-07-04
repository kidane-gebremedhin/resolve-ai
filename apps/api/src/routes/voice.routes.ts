// Twilio phone bridge routes.
// POST /voice/twiml — Twilio calls this when a call hits the configured number.
// Returns TwiML instructing Twilio to open a Media Streams WebSocket back to us.
// The WebSocket handler at /voice/phone (registered in index.ts) receives μ-law
// audio, transcribes it, runs generateAiReply(), synthesises the response, and
// streams audio frames back to Twilio.
//
// Requires env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER

import { Router, type Request, type Response } from "express";

const router = Router();

// No auth — Twilio posts to this URL directly. In production, validate the
// X-Twilio-Signature header with twilio.validateRequest() before proceeding.
router.post("/twiml", (_req: Request, res: Response) => {
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

// Stub: GET /voice/status — returns whether the Twilio bridge is configured.
router.get("/status", (_req: Request, res: Response) => {
  const configured = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER,
  );
  res.json({ configured, phone: process.env.TWILIO_PHONE_NUMBER ?? null });
});

export default router;
