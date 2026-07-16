import { Connection, ToolDefinition } from "../models/index.js";
import { logger } from "../config/logger.js";
import type { Migration } from "./types.js";

// Keep in sync with dispatcher.ts OTP_DEFAULT_ON_TOOLKEYS / integrations.routes.ts
// OTP_DEFAULT_ON_KEYS.
const OTP_DEFAULT_ON_KEYS = [
  "upgrade_subscription",
  "downgrade_subscription",
  "cancel_subscription",
  "issue_refund",
  "refund_payment",
];

// 1) OTP-by-default for high-stakes tools. The guardrails schema used to default
//    `requireIdentityVerification` to false, materializing an explicit false on every tool
//    def — read as "operator disabled OTP", defeating the default-on behavior. The schema
//    is now tri-state; fresh subscription/refund tools are seeded true. Flip the stale
//    false → true on already-created high-stakes defs. (We can't distinguish a deliberate
//    false from the artifact, but before this change the default MADE every value false, so
//    a stored false on these keys is overwhelmingly the artifact; operators can re-disable.)
async function backfillOtpDefaults(): Promise<void> {
  const res = await ToolDefinition.collection.updateMany(
    { key: { $in: OTP_DEFAULT_ON_KEYS }, "guardrails.requireIdentityVerification": false },
    { $set: { "guardrails.requireIdentityVerification": true } },
  );
  logger.info("[migration 001] otp defaults backfilled", { modified: res.modifiedCount });
}

// 2) Webhook name/description ↔ connection sync. For a custom webhook the connection
//    name/description and the tool's displayName/description are one value; older rows
//    drifted. Reconcile each webhook connection to a single value, preferring the tool def
//    (what the AI/registry use).
async function backfillWebhookNameDescSync(): Promise<void> {
  const conns = await Connection.find({ provider: "webhook" }).select("name description").lean();
  let changed = 0;
  for (const c of conns) {
    const def = await ToolDefinition.findOne({ connectionId: c._id }).select("displayName description").lean();
    if (!def) continue;
    const name = (def.displayName as string) || (c.name as string) || "";
    const description = (def.description as string) || (c.description as string) || "";
    const connMismatch = c.name !== name || (c.description ?? "") !== description;
    const defMismatch = def.displayName !== name || (def.description ?? "") !== description;
    if (!connMismatch && !defMismatch) continue;
    await Connection.collection.updateOne({ _id: c._id }, { $set: { name, description } });
    await ToolDefinition.collection.updateOne({ _id: def._id }, { $set: { displayName: name, description } });
    changed++;
  }
  logger.info("[migration 001] webhook name/description reconciled", { changed });
}

export const migration: Migration = {
  id: "001-integration-defaults",
  description: "OTP-by-default backfill for subscription/refund tools; webhook name/description sync",
  async up() {
    await backfillOtpDefaults();
    await backfillWebhookNameDescSync();
  },
};
