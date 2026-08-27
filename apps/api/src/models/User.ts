import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String },
    name: { type: String, required: true },
    phone: { type: String },
    avatarUrl: { type: String },
    provider: { type: String, enum: ["credentials", "google"], required: true },
    providerId: { type: String },
    role: { type: String, enum: ["user", "platform_admin"], required: true, default: "user" },
    // Affiliate referral code — the `?ref=` key in share links. Generated lazily.
    referralCode: { type: String, unique: true, sparse: true },
    emailVerifiedAt: { type: Date },
    lastLoginAt: { type: Date },
    // 2FA / TOTP. `totpSecret` holds the base32 secret used to derive 6-digit
    // codes, encrypted at rest via services/security/secret-field.ts — read it
    // with openSecret() and write it with sealSecret(), never directly. Values
    // written before that change are still plaintext and are re-sealed on their
    // next write. It is only set after the user completes `setup → verify`.
    // `recoveryCodes` holds bcrypt hashes of one-time backup codes; the
    // plaintext codes are shown to the user EXACTLY ONCE at setup.
    totpSecret: { type: String },
    totpEnabled: { type: Boolean, default: false },
    recoveryCodes: { type: [String], default: undefined },
    // Password reset. We store only a SHA-256 hash of the emailed token (never the
    // token itself) plus its expiry, so a DB leak can't be used to reset accounts.
    passwordResetTokenHash: { type: String },
    passwordResetExpires: { type: Date },
  },
  { timestamps: true },
);

userSchema.index(
  { provider: 1, providerId: 1 },
  {
    unique: true,
    partialFilterExpression: { providerId: { $exists: true, $type: "string" } },
  },
);

export type UserDocType = InferSchemaType<typeof userSchema>;
export const User: Model<UserDocType> = mongoose.models.User ?? mongoose.model("User", userSchema);
