/**
 * QA fixture for P6: two AI replies in one conversation.
 *
 * One carries inline citation markers (the new shape), one does not (the shape
 * every message written before P6 has). Both must render correctly in the
 * widget, and the second must render exactly as it did before — that backward
 * compatibility is the part most likely to break silently.
 */
import "dotenv/config";
import { connectDb, disconnectDb } from "../src/config/db.js";
import { Agent, ContactSession, Conversation, Message, Website } from "../src/models/index.js";

async function main(): Promise<void> {
  await connectDb();
  const website = await Website.findOne({ domain: /acme/ }).lean();
  if (!website) throw new Error("seed the QA accounts first: pnpm --filter @csb/api db:seed");
  const agent = await Agent.findOne({ websiteId: website._id }).lean();

  const session = await ContactSession.findOneAndUpdate(
    { organizationId: website.organizationId, token: "qa-citations-session" },
    {
      $setOnInsert: {
        organizationId: website.organizationId,
        websiteId: website._id,
        token: "qa-citations-session",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      $set: { lastActiveAt: new Date() },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await Conversation.deleteMany({ threadId: "qa-citations" });
  const convo = await Conversation.create({
    threadId: "qa-citations",
    organizationId: website.organizationId,
    websiteId: website._id,
    agentId: agent!._id,
    contactSessionId: session._id,
    status: "active",
  });

  await Message.create({
    conversationId: convo._id,
    organizationId: website.organizationId,
    role: "customer",
    senderType: "contact",
    content: "How much is the Team plan, and what's your refund window?",
  });

  // NEW shape: inline markers.
  await Message.create({
    conversationId: convo._id,
    organizationId: website.organizationId,
    role: "ai",
    senderType: "ai",
    confidence: 0.9,
    content:
      "The Team plan is $99 per month, or $990 billed annually [1]. Any plan can be refunded in full within 30 days of purchase [2]. Would you like help choosing between them?",
    sources: [
      {
        marker: 1,
        sourceId: String(website._id),
        sourceTitle: "Billing and Plans",
        chunkId: "qa-billing:0",
        headingPath: ["Billing and Plans", "Plans"],
        url: "https://support.northwind.example/billing",
        score: 0.91,
      },
      {
        marker: 2,
        sourceId: String(website._id),
        sourceTitle: "Refund Policy",
        chunkId: "qa-refunds:0",
        headingPath: ["Refund Policy", "The 30-day window"],
        url: "https://support.northwind.example/refunds",
        score: 0.84,
      },
    ],
  });

  await Message.create({
    conversationId: convo._id,
    organizationId: website.organizationId,
    role: "customer",
    senderType: "contact",
    content: "And where is my data hosted?",
  });

  // OLD shape: no markers, exactly as every pre-P6 message looks.
  await Message.create({
    conversationId: convo._id,
    organizationId: website.organizationId,
    role: "ai",
    senderType: "ai",
    confidence: 0.8,
    content:
      "Workspaces are hosted in one of two regions, us-east or eu-west, chosen at signup. Data does not leave the region it was created in.",
    sources: [
      { sourceId: String(website._id), sourceTitle: "Security and Data Handling", score: 0.77 },
    ],
  });

  console.log("websiteId:    ", String(website._id));
  console.log("sessionToken: ", session.token);
  console.log("conversation: ", String(convo._id));
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
