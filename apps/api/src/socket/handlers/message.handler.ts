import crypto from "node:crypto";
import type { Server as IoServer, Socket } from "socket.io";
import { Conversation, Message, ContactSession, Agent } from "../../models/index.js";
import { logger } from "../../config/logger.js";
import { generateAiReply } from "../../services/ai/agent.service.js";

export function registerMessageHandlers(io: IoServer, socket: Socket): void {
  // Customer (widget) sends a message via Socket.io.
  socket.on("message:send", async (payload: { conversationId?: string; content: string }) => {
    try {
      const auth = socket.auth;
      if (!auth) return;
      if (typeof payload?.content !== "string" || payload.content.trim() === "") return;

      let conversationId = payload.conversationId;
      if (!conversationId) {
        // Customer started a new conversation; mint one.
        if (auth.kind !== "contact" || !auth.contactSessionId) return;
        const session = await ContactSession.findById(auth.contactSessionId);
        if (!session) return;
        const agent = await Agent.findOne({ organizationId: auth.organizationId, isActive: true });
        if (!agent) return;
        const convo = await Conversation.create({
          threadId: crypto.randomUUID(),
          organizationId: auth.organizationId,
          websiteId: session.websiteId,
          agentId: agent._id,
          contactSessionId: session._id,
          status: "active",
        });
        conversationId = convo._id.toString();
      }

      const conversation = await Conversation.findOne({
        _id: conversationId,
        organizationId: auth.organizationId,
      });
      if (!conversation) return;

      const message = await Message.create({
        conversationId: conversation._id,
        organizationId: auth.organizationId,
        role: auth.kind === "contact" ? "customer" : "operator",
        senderType: auth.kind === "contact" ? "contact" : "user",
        senderId: auth.kind === "contact" ? auth.contactSessionId : auth.userId,
        content: payload.content,
      });

      conversation.lastMessageAt = message.createdAt as Date;
      conversation.lastMessagePreview = payload.content.slice(0, 140);
      conversation.messageCount = (conversation.messageCount ?? 0) + 1;
      await conversation.save();

      io.to(`org:${auth.organizationId}`).emit("message:new", {
        conversationId: conversation._id.toString(),
        messageId: message._id.toString(),
      });

      // Trigger AI reply only when customer messages an active conversation.
      if (auth.kind === "contact" && conversation.status === "active") {
        try {
          await generateAiReply(conversation, payload.content, io);
        } catch (err) {
          logger.error("[ai] reply failed", { conversationId, err });
        }
      }
    } catch (err) {
      logger.error("[socket] message:send error", err);
    }
  });
}
