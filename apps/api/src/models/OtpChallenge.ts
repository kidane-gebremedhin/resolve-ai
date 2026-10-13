import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// Email one-time codes for widget identity verification. Stored in MongoDB
// rather than process memory so every API replica sees the same challenge
// (an in-memory map made codes fail at random behind a load balancer).
// Neither the code nor the session token is stored in the clear.
const otpChallengeSchema = new Schema(
  {
    // Public handle returned to the widget (`otpToken`).
    handle: { type: String, required: true, unique: true },
    sessionTokenHash: { type: String, required: true, index: true },
    codeHash: { type: String, required: true },
    // The address the code was sent to. Verification binds the session to it.
    email: { type: String, required: true },
    attempts: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// MongoDB removes expired challenges on its own.
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type OtpChallengeDocType = InferSchemaType<typeof otpChallengeSchema>;
export const OtpChallenge: Model<OtpChallengeDocType> =
  mongoose.models.OtpChallenge ?? mongoose.model("OtpChallenge", otpChallengeSchema);
