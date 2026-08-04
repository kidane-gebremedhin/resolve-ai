// Sentry smoke-test endpoints. These run WITHOUT a DSN (the test env sets
// none), which is the case that matters most: a deployment that forgot the DSN
// must still serve, must still return the standard error envelope, and must
// report `configured: false` rather than pretending everything is wired.

import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../test/app.js";

describe("sentry debug endpoints", () => {
  let app: Express;
  beforeAll(() => {
    app = createApp();
  });

  it("GET /debug-sentry throws and returns the standard 500 envelope", async () => {
    const res = await request(app).get("/api/v1/debug-sentry");

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("internal_error");
    // No DSN in tests → no event id. In production this carries `res.sentry`.
    expect(res.body.error.eventId).toBeUndefined();
  });

  it("GET /debug-sentry/message reports that Sentry is not configured", async () => {
    const res = await request(app).get("/api/v1/debug-sentry/message");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, configured: false });
    expect(typeof res.body.ts).toBe("string");
  });

  it("rate limits the debug endpoints at 5 requests/minute", async () => {
    // The limiter is shared by both routes and keyed per IP; the two requests
    // above already count, so the 6th call in this window is the one rejected.
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app).get("/api/v1/debug-sentry/message");
      statuses.push(res.status);
    }

    expect(statuses).toContain(429);
  });
});
