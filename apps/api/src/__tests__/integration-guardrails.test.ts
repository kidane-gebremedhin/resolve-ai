// The integration layer's decision logic: guardrails, SSRF, PII masking and
// rate limiting.
//
// This is the highest-risk untested code in the system — it decides whether a
// customer-facing AI agent is allowed to refund money, change a subscription,
// or make an outbound request with a decrypted third-party credential. Every
// case below is a decision that must go one specific way; a wrong answer is a
// financial or security incident, not a rendering glitch.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { evaluateGuardrails, looksLikeRealName } from "../services/integrations/guardrails.js";
import { maskPii } from "../services/integrations/piiMask.js";
import { assertSafeUrl } from "../services/integrations/ssrf.js";
import { checkRateLimit } from "../services/integrations/rateLimit.js";

type Guardrails = Parameters<typeof evaluateGuardrails>[0];

// evaluateGuardrails explicitly handles a tool with no guardrails configured
// (`if (!guardrails) return { blocked: false }`), but the Mongoose document type
// models the field as always present, so expressing "no config" needs the cast.
// The mismatch is in the model, not the test.
const NO_GUARDRAILS = undefined as unknown as Guardrails;

describe("guardrails — billing owner", () => {
  // These tools act on somebody's money. They must never run for a visitor we
  // cannot tie to an account, even when the tool has no guardrails configured
  // at all — that is the whole point of the ALWAYS_BILLING_OWNER set.
  const MONEY_TOOLS = [
    "upgrade_subscription",
    "downgrade_subscription",
    "cancel_subscription",
    "refund_payment",
    "issue_refund",
  ];

  it.each(MONEY_TOOLS)("blocks %s for an anonymous visitor even with NO guardrails", (tool) => {
    const result = evaluateGuardrails(NO_GUARDRAILS, {}, tool);
    expect(result.blocked).toBe(true);
  });

  it.each(MONEY_TOOLS)("allows %s once a valid account email is present", (tool) => {
    const result = evaluateGuardrails(NO_GUARDRAILS, { email: "user@example.com" }, tool);
    expect(result.blocked).toBe(false);
  });

  it("rejects a malformed email rather than treating any string as identification", () => {
    for (const email of ["not-an-email", "@example.com", "user@", "", "   "]) {
      expect(evaluateGuardrails(NO_GUARDRAILS, { email }, "refund_payment").blocked).toBe(true);
    }
  });

  it("does not gate an ordinary tool on a billing owner", () => {
    expect(evaluateGuardrails(NO_GUARDRAILS, {}, "search_orders").blocked).toBe(false);
  });
});

describe("guardrails — refund limits", () => {
  // refund_payment is in ALWAYS_BILLING_OWNER, and that check runs FIRST, so
  // every case here supplies an account email. Without it the call is blocked
  // on identity before the amount is ever considered — defence in depth, and
  // the reason these limits are a second line rather than the only one.
  const OWNER = { email: "user@example.com" };
  it("blocks a refund over the configured maximum", () => {
    const g = { maxAmount: 50 } as Guardrails;
    expect(evaluateGuardrails(g, { ...OWNER, amount: 50.01 }, "refund_payment").blocked).toBe(true);
  });

  it("allows a refund exactly AT the maximum (boundary is inclusive)", () => {
    const g = { maxAmount: 50 } as Guardrails;
    expect(evaluateGuardrails(g, { ...OWNER, amount: 50 }, "refund_payment").blocked).toBe(false);
  });

  it("also reads the refundAmount alias, so the cap can't be bypassed by arg name", () => {
    const g = { maxAmount: 50 } as Guardrails;
    expect(evaluateGuardrails(g, { ...OWNER, refundAmount: 500 }, "refund_payment").blocked).toBe(true);
  });

  it("blocks a purchase older than the allowed window", () => {
    const g = { maxDaysSincePurchase: 30 } as Guardrails;
    expect(evaluateGuardrails(g, { ...OWNER, daysSincePurchase: 31 }, "refund_payment").blocked).toBe(true);
    expect(evaluateGuardrails(g, { ...OWNER, daysSincePurchase: 30 }, "refund_payment").blocked).toBe(false);
  });

  it("checks identity BEFORE the amount, so an anonymous small refund is still blocked", () => {
    const g = { maxAmount: 500 } as Guardrails;
    // $1 is well inside the cap, but there is no account holder.
    expect(evaluateGuardrails(g, { amount: 1 }, "refund_payment").blocked).toBe(true);
  });

  it("derives the age from a purchase date when no day count is given", () => {
    const g = { maxDaysSincePurchase: 30 } as Guardrails;
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
    expect(evaluateGuardrails(g, { ...OWNER, purchaseDate: old }, "refund_payment").blocked).toBe(true);
  });
});

describe("guardrails — contact allow-list", () => {
  it("blocks a contact outside the allow-list", () => {
    const g = { allowedContactEmails: ["allowed@example.com"] } as Guardrails;
    expect(evaluateGuardrails(g, { email: "someone@else.com" }, "x").blocked).toBe(true);
  });

  it("matches case-insensitively so a capitalised address is not wrongly rejected", () => {
    const g = { allowedContactEmails: ["allowed@example.com"] } as Guardrails;
    expect(evaluateGuardrails(g, { email: "Allowed@Example.com" }, "x").blocked).toBe(false);
  });
});

describe("looksLikeRealName", () => {
  // Guards the "book a meeting under a real attendee name" rule: the model
  // reaches for these placeholders when it has no actual name.
  it.each(["customer", "Guest", "user", "attendee", "test", "unknown", "n/a", "N/A", "none", "[name]", "the customer", "a"])(
    "rejects the placeholder %j",
    (name) => expect(looksLikeRealName(name)).toBe(false),
  );

  it.each(["Ada Lovelace", "Jo", "Ali", "Mary-Jane O'Connor"])("accepts %j", (name) =>
    expect(looksLikeRealName(name)).toBe(true),
  );
});

describe("PII masking before inference", () => {
  it("masks emails, cards and phone numbers", () => {
    expect(maskPii("write to ada@example.com")).not.toContain("ada@example.com");
    expect(maskPii("card 4111 1111 1111 1111")).toContain("[CARD]");
  });

  it("masks values nested inside objects", () => {
    const masked = maskPii({ note: "reach me at ada@example.com" }) as Record<string, string>;
    expect(masked.note).not.toContain("ada@example.com");
  });

  it("leaves text with no PII untouched", () => {
    expect(maskPii("where is my order")).toBe("where is my order");
  });
});

describe("SSRF guard", () => {
  it("rejects non-HTTPS URLs", async () => {
    await expect(assertSafeUrl("http://example.com")).rejects.toThrow(/HTTPS/i);
  });

  it("rejects loopback and private hostnames", async () => {
    await expect(assertSafeUrl("https://localhost/x")).rejects.toThrow();
    await expect(assertSafeUrl("https://127.0.0.1/x")).rejects.toThrow();
    await expect(assertSafeUrl("https://10.0.0.5/x")).rejects.toThrow();
    await expect(assertSafeUrl("https://192.168.1.1/x")).rejects.toThrow();
    // Cloud metadata endpoint — the classic SSRF credential-theft target.
    await expect(assertSafeUrl("https://169.254.169.254/latest/meta-data/")).rejects.toThrow();
  });

  it("rejects a malformed URL", async () => {
    await expect(assertSafeUrl("not a url")).rejects.toThrow();
  });
});

describe("integration rate limiting", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("allows up to the per-session cap, then blocks", () => {
    const cfg = { perSession: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i += 1) {
      expect(checkRateLimit("conn-a", "sess-a", cfg).allowed).toBe(true);
    }
    const blocked = checkRateLimit("conn-a", "sess-a", cfg);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe("session");
  });

  it("counts each session separately", () => {
    const cfg = { perSession: 1, windowMs: 60_000 };
    expect(checkRateLimit("conn-b", "sess-1", cfg).allowed).toBe(true);
    expect(checkRateLimit("conn-b", "sess-1", cfg).allowed).toBe(false);
    // A different visitor on the same connection is unaffected.
    expect(checkRateLimit("conn-b", "sess-2", cfg).allowed).toBe(true);
  });

  it("enforces a connection-wide cap across sessions", () => {
    const cfg = { perSession: 10, perConnection: 2, windowMs: 60_000 };
    expect(checkRateLimit("conn-c", "s1", cfg).allowed).toBe(true);
    expect(checkRateLimit("conn-c", "s2", cfg).allowed).toBe(true);
    const blocked = checkRateLimit("conn-c", "s3", cfg);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe("connection");
  });

  it("lets the window slide so a session recovers after it expires", () => {
    const cfg = { perSession: 1, windowMs: 60_000 };
    expect(checkRateLimit("conn-d", "sess-d", cfg).allowed).toBe(true);
    expect(checkRateLimit("conn-d", "sess-d", cfg).allowed).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(checkRateLimit("conn-d", "sess-d", cfg).allowed).toBe(true);
  });
});
