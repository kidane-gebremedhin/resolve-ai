import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// In-app notification, scoped to an ORGANIZATION (org-wide). One doc per event —
// every member of the org sees it and shares its read state (marking it read
// clears it for the whole org). Surfaced by the header bell in the web dashboard
// and pushed live over the socket `org:<organizationId>` room when created.
const notificationSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    // Machine-readable category — e.g. "budget_warning", "budget_exceeded".
    type: { type: String, required: true },
    // Visual severity for the icon/colour in the UI.
    level: { type: String, enum: ["info", "warning", "error"], default: "info" },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    // Optional in-app link the notification deep-links to (e.g. "/app/billing").
    link: { type: String, default: null },
    // When the notification concerns a specific agent/website, we store both so the
    // UI can deep-link to that agent (the AI page scopes by website) — see the bell.
    agentId: { type: Schema.Types.ObjectId, ref: "Agent", default: null },
    websiteId: { type: Schema.Types.ObjectId, ref: "Website", default: null },
    read: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Primary access pattern: an org's most-recent notifications, and unread counts.
notificationSchema.index({ organizationId: 1, createdAt: -1 });
notificationSchema.index({ organizationId: 1, read: 1 });
// TTL: auto-delete notifications older than 90 days so the collection stays small.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export type NotificationDocType = InferSchemaType<typeof notificationSchema>;
export const Notification: Model<NotificationDocType> =
  mongoose.models.Notification ?? mongoose.model("Notification", notificationSchema);
