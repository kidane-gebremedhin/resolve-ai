// 2FA enforcement at login.
//
// Before this existed, a user could enable 2FA, see it confirmed in the
// dashboard, and still log in with the password alone — the setup flow wrote a
// secret that nothing ever checked. These tests pin the enforcement so that
// cannot silently regress: the whole failure mode was that everything *looked*
// fine while the second factor did nothing.
import { describe, expect, it, beforeAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { generate, generateSecret } from "otplib";
import type { Express } from "express";
import { createApp } from "../test/app.js";
import { createOrgWithOwner } from "../test/factories.js";
import { User } from "../models/index.js";
import { sealSecret } from "../services/security/secret-field.js";

const PASSWORD = "Password1234!";

describe("2FA login enforcement", () => {
  let app: Express;
  beforeAll(async () => {
    app = await createApp();
  });

  async function userWith2fa(email: string, recoveryPlain?: string) {
    await createOrgWithOwner(app, { email, password: PASSWORD });
    const secret = generateSecret();
    const update: Record<string, unknown> = {
      totpEnabled: true,
      totpSecret: sealSecret(secret),
    };
    if (recoveryPlain) {
      update.recoveryCodes = [await bcrypt.hash(recoveryPlain, 10)];
    }
    await User.updateOne({ email }, { $set: update });
    return secret;
  }

  const login = (app: Express, body: Record<string, unknown>) =>
    request(app).post("/api/v1/auth/login").send(body);

  it("still logs in with password alone when 2FA is OFF", async () => {
    const email = "no2fa@example.com";
    await createOrgWithOwner(app, { email, password: PASSWORD });

    const res = await login(app, { email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it("refuses a password-only login when 2FA is ON, and says so distinctly", async () => {
    const email = "with2fa@example.com";
    await userWith2fa(email);

    const res = await login(app, { email, password: PASSWORD });

    expect(res.status).toBe(401);
    // Distinct from "wrong password" so the client can show the code field
    // rather than a misleading credentials error.
    expect(res.body.error?.code).toBe("totp_required");
    expect(res.body.accessToken).toBeUndefined();
  });

  it("rejects a wrong TOTP code", async () => {
    const email = "badcode@example.com";
    await userWith2fa(email);

    const res = await login(app, { email, password: PASSWORD, code: "000000" });
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("invalid_totp");
  });

  it("accepts a valid TOTP code", async () => {
    const email = "goodcode@example.com";
    const secret = await userWith2fa(email);

    const res = await login(app, {
      email,
      password: PASSWORD,
      code: await generate({ secret }),
    });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  // Clock skew. A TOTP code covers one 30-second window, and verifying against
  // only the current window rejects a code whenever the user's device clock has
  // drifted a second or two, or the code was typed near a window boundary, or
  // the request spent a moment in a proxy. The user reads all of those as "my
  // authenticator is wrong", retries, and hits the login rate limit.
  //
  // RFC 6238 §5.2 asks for adjacent time steps to be accepted. These tests pin
  // that, and they are also why this file no longer fails intermittently: a
  // boundary crossed between generating and verifying now lands in a window
  // that is accepted rather than one that is not.
  describe("clock skew tolerance", () => {
    const STEP_SECONDS = 30;
    const nowSec = () => Math.floor(Date.now() / 1000);

    /**
     * Wait, if necessary, until enough of the current TOTP window remains for a
     * login round trip to finish inside it.
     *
     * Only the PREVIOUS-window case needs this, and it is a genuine race rather
     * than a slow test: a code one window old is accepted while the server is
     * still in the window it was generated against, and rejected the moment the
     * server crosses into the next one. The login it has to survive hashes a
     * password at bcrypt cost 12 — normally a few hundred milliseconds, but over
     * ten seconds on a machine running the whole suite in parallel, which is how
     * this test failed roughly one run in three.
     *
     * The other two cases do not need it. A NEXT-window code only becomes more
     * current as time passes, and a two-windows-old code only becomes staler —
     * both drift toward their expected result, not away from it.
     */
    async function awaitWindowSlack(minSeconds: number): Promise<void> {
      const msIntoWindow = Date.now() % (STEP_SECONDS * 1000);
      const msRemaining = STEP_SECONDS * 1000 - msIntoWindow;
      if (msRemaining >= minSeconds * 1000) return;
      // At most `STEP_SECONDS - minSeconds` of waiting, and only sometimes.
      await new Promise((resolve) => setTimeout(resolve, msRemaining + 50));
    }

    it("accepts a code from the PREVIOUS window (device clock running behind)", async () => {
      const email = "skewbehind@example.com";
      const secret = await userWith2fa(email);

      // Generate only once the window has room for the round trip, so a failure
      // here means the tolerance is wrong rather than that the box was busy.
      await awaitWindowSlack(15);
      const code = await generate({ secret, epoch: nowSec() - STEP_SECONDS });

      const res = await login(app, { email, password: PASSWORD, code });
      expect(res.status).toBe(200);
    });

    it("accepts a code from the NEXT window (device clock running ahead)", async () => {
      const email = "skewahead@example.com";
      const secret = await userWith2fa(email);

      const res = await login(app, {
        email,
        password: PASSWORD,
        code: await generate({ secret, epoch: nowSec() + STEP_SECONDS }),
      });
      expect(res.status).toBe(200);
    });

    it("still rejects a code two windows old", async () => {
      // The tolerance is one step, not "recent-ish". A code from a minute ago
      // is stale, and widening further buys no usability — a device that far
      // out of sync has a clock problem the user has to fix anyway.
      const email = "skewstale@example.com";
      const secret = await userWith2fa(email);

      const res = await login(app, {
        email,
        password: PASSWORD,
        code: await generate({ secret, epoch: nowSec() - STEP_SECONDS * 2 }),
      });
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe("invalid_totp");
    });
  });

  it("does not leak whether 2FA is enabled when the password is wrong", async () => {
    const email = "leak@example.com";
    await userWith2fa(email);

    const res = await login(app, { email, password: "WrongPassword1!" });
    // Must be the generic credentials failure, NOT totp_required — otherwise
    // the endpoint confirms a valid account to someone guessing passwords.
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("unauthorized");
  });

  it("accepts a recovery code and CONSUMES it (one-time use)", async () => {
    const email = "recovery@example.com";
    const recovery = "abcd-efgh-ijkl";
    await userWith2fa(email, recovery);

    const first = await login(app, { email, password: PASSWORD, code: recovery });
    expect(first.status).toBe(200);
    expect(first.body.accessToken).toBeTruthy();

    // The same code must never work twice.
    const second = await login(app, { email, password: PASSWORD, code: recovery });
    expect(second.status).toBe(401);
    expect(second.body.error?.code).toBe("invalid_totp");

    const after = await User.findOne({ email }).select("recoveryCodes").lean();
    expect(after?.recoveryCodes ?? []).toHaveLength(0);
  });
});
