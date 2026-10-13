import { ToolDefinition } from "../models/index.js";
import { logger } from "../config/logger.js";
import type { Migration } from "./types.js";

// `get_subscription` now requires email-OTP by default: reading a plan discloses
// another person's billing state, and a visitor's email is self-asserted.
//
// Existing `get_subscription` tool definitions may carry an explicit `false`
// from before the guardrails schema was tri-state (the old schema default wrote
// false on every tool, see migration 001). OTP was never on by default for this
// tool, so no operator had a reason to turn it off deliberately; the false is
// the artifact. Flip it to true. Operators who really want lookups without a
// code can switch it off again per tool.
//
// Idempotent: only matches an explicit false.
export const migration: Migration = {
  id: "004-otp-default-get-subscription",
  description: "Require email-OTP on existing get_subscription tools (stale explicit false -> true)",
  async up() {
    const res = await ToolDefinition.updateMany(
      { key: "get_subscription", "guardrails.requireIdentityVerification": false },
      { $set: { "guardrails.requireIdentityVerification": true } },
    );
    logger.info("[migration 004] get_subscription OTP default applied", { modified: res.modifiedCount });
  },
};
