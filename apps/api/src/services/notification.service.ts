import { Notification, Membership, User } from "../models/index.js";
import { getIoServer } from "../socket/index.js";
import { logger } from "../config/logger.js";

type NotificationLevel = "info" | "warning" | "error";

export interface CreateNotificationInput {
  organizationId: string;
  type: string;
  title: string;
  body?: string;
  level?: NotificationLevel;
  link?: string | null;
  // Optional agent/website this notification concerns — lets the UI deep-link to
  // the corresponding agent (the AI page scopes by website).
  agentId?: string | null;
  websiteId?: string | null;
}

// Persist a single ORG-WIDE in-app notification and push it live to every member
// of the org (`org:<organizationId>` room) so their header bell updates without a
// refresh. Fire-and-forget friendly: never throws to the caller.
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    const doc = await Notification.create({
      organizationId: input.organizationId,
      type: input.type,
      title: input.title,
      body: input.body ?? "",
      level: input.level ?? "info",
      link: input.link ?? null,
      agentId: input.agentId ?? null,
      websiteId: input.websiteId ?? null,
    });

    getIoServer()
      ?.to(`org:${input.organizationId}`)
      .emit("notification:new", {
        id: doc._id.toString(),
        type: doc.type,
        level: doc.level,
        title: doc.title,
        body: doc.body,
        link: doc.link,
        agentId: doc.agentId ? doc.agentId.toString() : null,
        websiteId: doc.websiteId ? doc.websiteId.toString() : null,
        read: doc.read,
        createdAt: doc.createdAt,
      });
  } catch (err) {
    logger.error("[notification] failed to create", { err: (err as Error).message });
  }
}

// Owner/admin emails for an org — the recipients for account-level EMAILS (budget
// alerts, billing, etc.). The in-app side is org-wide (one doc), but emails still
// go to the humans who own the account.
export async function orgAdminEmails(organizationId: string): Promise<string[]> {
  const memberships = await Membership.find({
    organizationId,
    role: { $in: ["owner", "admin"] },
    status: "active",
  })
    .select("userId")
    .lean();
  if (!memberships.length) return [];

  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } })
    .select("email")
    .lean();
  return users.map((u) => u.email as string).filter(Boolean);
}
