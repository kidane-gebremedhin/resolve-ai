import type { Server as IoServer, Socket } from "socket.io";
import { Conversation } from "../../models/index.js";

export function registerTypingHandlers(_io: IoServer, socket: Socket): void {
  // Legacy room-based relay (kept for any operator-dashboard sockets that already
  // emit these events and have joined the conversation room via join:conversation).
  socket.on("typing:start", (payload: { conversationId: string }) => {
    if (!payload?.conversationId || !socket.auth) return;
    socket.to(`conversation:${payload.conversationId}`).emit("typing:start", {
      conversationId: payload.conversationId,
      from: socket.auth.kind === "contact" ? "customer" : "operator",
    });
  });
  socket.on("typing:stop", (payload: { conversationId: string }) => {
    if (!payload?.conversationId || !socket.auth) return;
    socket.to(`conversation:${payload.conversationId}`).emit("typing:stop", {
      conversationId: payload.conversationId,
      from: socket.auth.kind === "contact" ? "customer" : "operator",
    });
  });

  // Operator → customer: relay to the contact's personal room so the widget
  // receives it even without joining a conversation room.
  socket.on(
    "operator:typing",
    async (payload: { conversationId: string; isTyping: boolean }) => {
      if (!payload?.conversationId || !socket.auth) return;
      if (socket.auth.kind !== "operator") return;
      try {
        const convo = await Conversation.findOne({
          _id: payload.conversationId,
          organizationId: socket.auth.organizationId,
        }).select("contactSessionId");
        if (!convo?.contactSessionId) return;
        socket.to(`contact:${convo.contactSessionId}`).emit("operator:typing", {
          conversationId: payload.conversationId,
          isTyping: Boolean(payload.isTyping),
        });
      } catch {
        // Non-critical — typing indicators are best-effort.
      }
    },
  );

  // Customer → operator: broadcast to the org room (all operator sockets).
  socket.on(
    "customer:typing",
    (payload: { conversationId: string; isTyping: boolean }) => {
      if (!payload?.conversationId || !socket.auth) return;
      if (socket.auth.kind !== "contact") return;
      socket.to(`org:${socket.auth.organizationId}`).emit("customer:typing", {
        conversationId: payload.conversationId,
        isTyping: Boolean(payload.isTyping),
      });
    },
  );
}
