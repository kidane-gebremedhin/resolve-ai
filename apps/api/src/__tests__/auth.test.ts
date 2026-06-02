// Auth flow: register → login → access protected route → refresh.
// We construct a fresh app per suite so module-level state from other test
// files cannot leak through.

import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../test/app.js";
import { createOrgWithOwner } from "../test/factories.js";

describe("auth flow", () => {
  let app: Express;
  beforeAll(() => {
    app = createApp();
  });

  it("POST /auth/register creates user + org + membership and returns tokens", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      email: "owner@example.com",
      password: "supersecret",
      name: "Owner One",
      organizationName: "Owner Org",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      user: {
        email: "owner@example.com",
        name: "Owner One",
        role: "user",
        membershipRole: "owner",
      },
    });
    expect(typeof res.body.user.organizationId).toBe("string");
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");
    expect(res.body.expiresIn).toBe(900);
  });

  it("POST /auth/register with duplicate email → 409", async () => {
    await createOrgWithOwner(app, { email: "dup@example.com" });
    const res = await request(app).post("/api/v1/auth/register").send({
      email: "dup@example.com",
      password: "anothersecret",
      name: "Dup User",
      organizationName: "Dup Org",
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("conflict");
  });

  it("POST /auth/login with wrong password → 401", async () => {
    await createOrgWithOwner(app, {
      email: "loginer@example.com",
      password: "correctpass1",
    });
    const res = await request(app).post("/api/v1/auth/login").send({
      email: "loginer@example.com",
      password: "wrongpassword",
    });
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("unauthorized");
  });

  it("POST /auth/login with correct password issues fresh tokens", async () => {
    await createOrgWithOwner(app, {
      email: "ok@example.com",
      password: "rightpass1",
    });
    const res = await request(app).post("/api/v1/auth/login").send({
      email: "ok@example.com",
      password: "rightpass1",
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");
  });

  it("POST /auth/refresh issues a new access token", async () => {
    const { refreshToken } = await createOrgWithOwner(app, {
      email: "refresh@example.com",
    });
    const res = await request(app).post("/api/v1/auth/refresh").send({ refreshToken });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe("string");
    expect(res.body.expiresIn).toBe(900);
  });

  it("POST /auth/refresh with missing token → 401", async () => {
    const res = await request(app).post("/api/v1/auth/refresh").send({});
    expect(res.status).toBe(401);
  });

  it("GET /websites without an auth header → 401", async () => {
    const res = await request(app).get("/api/v1/websites");
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("unauthorized");
  });

  it("GET /websites with a valid access token → 200 and returns an array", async () => {
    const { accessToken } = await createOrgWithOwner(app, { email: "listing@example.com" });
    const res = await request(app)
      .get("/api/v1/websites")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // Regression: SSO first-login used to skip org provisioning. The issued JWT
  // then had no `organizationId`, and every protected request 403'd with
  // "No organization context in token." Now /auth/google auto-creates an
  // Organization + owner Membership so the token is immediately usable.
  it("POST /auth/google for a new email auto-provisions an organization + owner membership", async () => {
    const res = await request(app).post("/api/v1/auth/google").send({
      idToken: "fake-id-token",
      email: "google-newcomer@example.com",
      name: "Google Newcomer",
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.user.organizationId).toBe("string");
    expect(res.body.user.organizationId.length).toBeGreaterThan(0);

    // The freshly-issued token must satisfy `requireOrg` on every CRUD route.
    const sites = await request(app)
      .get("/api/v1/websites")
      .set("Authorization", `Bearer ${res.body.accessToken}`);
    expect(sites.status).toBe(200);
  });
});
