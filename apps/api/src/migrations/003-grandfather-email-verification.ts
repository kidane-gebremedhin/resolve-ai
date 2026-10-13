import { User } from "../models/index.js";
import { logger } from "../config/logger.js";
import type { Migration } from "./types.js";

// Mark every account that existed before email verification shipped as
// verified, dated to its creation.
//
// Google sign-in now treats an UNVERIFIED credentials account with the same
// email as possibly pre-registered by someone else: it clears that password
// and revokes the account's sessions before letting the Google user in. That
// is right for accounts created from now on, but every account from before
// this release is unverified only because verification did not exist yet, and
// its owner would lose their password the first time they used Google.
//
// Placeholder users created by a pending invite (no password, credentials
// provider) are left alone: accepting the invite verifies them.
//
// Idempotent: only touches users that have no `emailVerifiedAt`.
export const migration: Migration = {
  id: "003-grandfather-email-verification",
  description: "Backfill emailVerifiedAt for accounts created before email verification existed",
  async up() {
    const res = await User.updateMany(
      {
        emailVerifiedAt: { $exists: false },
        $or: [{ passwordHash: { $exists: true } }, { provider: "google" }],
      },
      [{ $set: { emailVerifiedAt: { $ifNull: ["$createdAt", "$$NOW"] } } }],
    );
    logger.info("[migration 003] grandfathered email verification", { updated: res.modifiedCount });
  },
};
