// The /voice/twiml webhook is unauthenticated by necessity — Twilio posts to it
// directly — so its signature check IS its authentication. These tests pin that
// behaviour: without them, a refactor that drops the middleware would look
// green, because the handler itself returns valid TwiML either way.
import crypto from "node:crypto";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../test/app.js";

const AUTH_TOKEN = "test-twilio-auth-token";

// Twilio's scheme: full URL, then each POST param appended as key+value with
// keys sorted, HMAC-SHA1 with the auth token, base64.
function sign(url: string, params: Record<string, string>): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return crypto.createHmac("sha1", AUTH_TOKEN).update(Buffer.from(payload, "utf-8")).digest("base64");
}

describe("voice webhook security", () => {
  let app: Express;
  const original = process.env.TWILIO_AUTH_TOKEN;

  beforeAll(async () => {
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    app = await createApp();
  });

  afterAll(() => {
    if (original === undefined) delete process.env.TWILIO_AUTH_TOKEN;
    else process.env.TWILIO_AUTH_TOKEN = original;
  });

  it("rejects a request with no signature", async () => {
    const res = await request(app)
      .post("/api/v1/voice/twiml")
      .type("form")
      .send({ CallSid: "CA123" });

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("invalid_signature");
  });

  it("rejects a forged signature", async () => {
    const res = await request(app)
      .post("/api/v1/voice/twiml")
      .type("form")
      .set("X-Twilio-Signature", "definitely-not-a-valid-signature")
      .send({ CallSid: "CA123" });

    expect(res.status).toBe(403);
  });

  it("rejects a valid signature computed over DIFFERENT params (replay/tamper)", async () => {
    const url = "http://127.0.0.1/api/v1/voice/twiml";
    // Signed for one call, replayed with another CallSid.
    const signature = sign(url, { CallSid: "CA-original" });

    const res = await request(app)
      .post("/api/v1/voice/twiml")
      .type("form")
      .set("Host", "127.0.0.1")
      .set("X-Twilio-Signature", signature)
      .send({ CallSid: "CA-tampered" });

    expect(res.status).toBe(403);
  });

  it("accepts a correctly signed request and returns TwiML", async () => {
    const url = "http://127.0.0.1/api/v1/voice/twiml";
    const params = { CallSid: "CA123", From: "+15551234567" };

    const res = await request(app)
      .post("/api/v1/voice/twiml")
      .type("form")
      .set("Host", "127.0.0.1")
      .set("X-Twilio-Signature", sign(url, params))
      .send(params);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("xml");
    expect(res.text).toContain("<Response>");
    expect(res.text).toContain("wss://127.0.0.1/voice/phone");
  });

  it("fails closed when TWILIO_AUTH_TOKEN is unset", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const res = await request(app)
      .post("/api/v1/voice/twiml")
      .type("form")
      .set("X-Twilio-Signature", "anything")
      .send({ CallSid: "CA123" });
    process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;

    expect(res.status).toBe(503);
    expect(res.body.error?.code).toBe("voice_not_configured");
  });

  it("requires authentication for GET /voice/status (it discloses the phone number)", async () => {
    const res = await request(app).get("/api/v1/voice/status");
    expect(res.status).toBe(401);
  });
});
