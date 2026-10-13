// C2 / H6 / H8 from PRE_RELEASE_REVIEW.md: account-scoped integration tools act
// only on the visitor's own VERIFIED email, and the email code cannot be
// brute-forced.

import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";

const calls = vi.hoisted(() => ({ args: [] as Record<string, unknown>[] }));
vi.mock("../services/integrations/adapters/index.js", () => ({
  getAdapter: () => ({
    execute: async (_key: string, args: Record<string, unknown>) => {
      calls.args.push(args);
      return { found: true };
    },
    refreshTokens: async () => null,
  }),
}));
const mail = vi.hoisted(() => ({ codes: [] as string[] }));
vi.mock("../services/mailer.service.js", () => ({
  sendMail: vi.fn(async (m: { html: string }) => {
    const code = /code is: <strong>(\d{6})<\/strong>/.exec(m.html)?.[1];
    if (code) mail.codes.push(code);
  }),
}));

import { dispatchToolCall } from "../services/integrations/dispatcher.js";
import { verifyOtp, OTP_MAX_ATTEMPTS } from "../services/integrations/otpService.js";
import { encrypt } from "../services/security/crypto.service.js";
import { Connection, ContactSession, ToolDefinition } from "../models/index.js";

const orgId = new mongoose.Types.ObjectId();

async function fixture(toolKey: string) {
  const connection = (await Connection.create({
    organizationId: orgId,
    provider: "stripe",
    name: "Stripe",
    authMode: "api_key",
    status: "active",
    sandbox: false,
    encryptedCredentials: encrypt(JSON.stringify({ apiKey: "sk_test" })),
    createdBy: new mongoose.Types.ObjectId(),
  } as never)) as unknown as { _id: mongoose.Types.ObjectId };
  await ToolDefinition.create({
    connectionId: connection._id,
    organizationId: orgId,
    key: toolKey,
    displayName: toolKey,
    description: toolKey,
    jsonSchema: { type: "object" },
    isActive: true,
  } as never);
  const token = crypto.randomUUID();
  const session = (await ContactSession.create({
    organizationId: orgId,
    websiteId: new mongoose.Types.ObjectId(),
    token,
    email: "attacker@example.com",
    expiresAt: new Date(Date.now() + 3_600_000),
  } as never)) as unknown as { _id: mongoose.Types.ObjectId };
  const ctx = {
    organizationId: orgId.toString(),
    agentId: new mongoose.Types.ObjectId().toString(),
    conversationId: new mongoose.Types.ObjectId(),
    contactSessionId: session._id.toString(),
  };
  return { token, session, ctx };
}

beforeEach(() => {
  calls.args.length = 0;
  mail.codes.length = 0;
});

describe("C2: OTP-gated subscription tools act on the verified email only", () => {
  it("replaces a victim email in the arguments with the verified one", async () => {
    const { token, ctx } = await fixture("cancel_subscription");
    const first = await dispatchToolCall("cancel_subscription", { email: "victim@example.com" }, ctx as never);
    expect(first.ok).toBe(false);
    const otpToken = (JSON.parse((first as { reason: string }).reason) as { otpToken: string }).otpToken;
    expect(await verifyOtp(token, otpToken, mail.codes[0])).toBe(true);

    const second = await dispatchToolCall("cancel_subscription", { email: "victim@example.com" }, ctx as never);
    expect(second.ok).toBe(true);
    expect(calls.args.at(-1)?.email).toBe("attacker@example.com");
  });

  it("refuses when the session email changed after verification", async () => {
    const { token, session, ctx } = await fixture("cancel_subscription");
    const first = await dispatchToolCall("cancel_subscription", {}, ctx as never);
    const otpToken = (JSON.parse((first as { reason: string }).reason) as { otpToken: string }).otpToken;
    await verifyOtp(token, otpToken, mail.codes[0]);
    // Bypass the route (which also clears verification) to prove the dispatcher
    // checks on its own.
    await ContactSession.updateOne({ _id: session._id }, { email: "victim@example.com" });
    const res = await dispatchToolCall("cancel_subscription", {}, ctx as never);
    expect(res.ok).toBe(false);
    expect(calls.args).toHaveLength(0);
  });
});

describe("H6: get_subscription needs a verified email by default", () => {
  it("asks for a code before disclosing anything", async () => {
    const { ctx } = await fixture("get_subscription");
    const res = await dispatchToolCall("get_subscription", { email: "victim@example.com" }, ctx as never);
    expect(res.ok).toBe(false);
    expect((res as { status: string }).status).toBe("otp_pending");
    expect(calls.args).toHaveLength(0);
  });
});

describe("C2: refunds carry the verified customer email for the ownership check", () => {
  it("injects customerEmail, overriding any supplied value", async () => {
    const { token, ctx } = await fixture("issue_refund");
    const first = await dispatchToolCall("issue_refund", { chargeId: "ch_1", amount: 1 }, ctx as never);
    const otpToken = (JSON.parse((first as { reason: string }).reason) as { otpToken: string }).otpToken;
    await verifyOtp(token, otpToken, mail.codes[0]);
    await dispatchToolCall(
      "issue_refund",
      { chargeId: "ch_1", amount: 1, customerEmail: "victim@example.com" },
      ctx as never,
    );
    expect(calls.args.at(-1)?.customerEmail).toBe("attacker@example.com");
  });
});

describe("H8: OTP brute force", () => {
  it(`burns the code after ${OTP_MAX_ATTEMPTS} wrong guesses`, async () => {
    const { token, ctx } = await fixture("cancel_subscription");
    const first = await dispatchToolCall("cancel_subscription", {}, ctx as never);
    const otpToken = (JSON.parse((first as { reason: string }).reason) as { otpToken: string }).otpToken;
    const real = mail.codes[0];
    const wrong = real === "111111" ? "222222" : "111111";
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      expect(await verifyOtp(token, otpToken, wrong)).toBe(false);
    }
    expect(await verifyOtp(token, otpToken, real)).toBe(false);
  });

  it("is bound to the session that requested it", async () => {
    const a = await fixture("cancel_subscription");
    const first = await dispatchToolCall("cancel_subscription", {}, a.ctx as never);
    const otpToken = (JSON.parse((first as { reason: string }).reason) as { otpToken: string }).otpToken;
    expect(await verifyOtp(crypto.randomUUID(), otpToken, mail.codes[0])).toBe(false);
  });
});
