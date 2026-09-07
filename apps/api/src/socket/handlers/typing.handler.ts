import type { Server as IoServer, Socket } from "socket.io";
import { Conversation } from "../../models/index.js";
import { mayAccessConversation } from "../authorize.js";

export function registerTypingHandlers(_io: IoServer, socket: Socket): void {
  // Legacy room-based relay, kept for operator dashboards that already emit
  // these events. The relay assumes the sender joined the conversation room via
  // join:conversation, so it now checks that instead of assuming it: `socket.to`
  // broadcasts into a room whether or not the sender is a member, which let any
  // authenticated socket inject typing events into any tenant's conversation.
  // Membership is itself authorized (see ../authorize.ts), so it is a sound proxy.
  const relay = (event: "typing:start" | "typing:stop") => {
    socket.on(event, (payload: { conversationId: string }) => {
      if (!payload?.conversationId || !socket.auth) return;
      const room = `conversation:${payload.conversationId}`;
      if (!socket.rooms?.has(room)) return;
      socket.to(room).emit(event, {
        conversationId: payload.conversationId,
        from: socket.auth.kind === "contact" ? "customer" : "operator",
      });
    });
  };
  relay("typing:start");
  relay("typing:stop");

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
  // The conversation id reaches the operator dashboard, which renders the
  // indicator against that thread, so an unchecked id lets one visitor put a
  // "customer is typing" on another visitor's conversation. The decision is
  // memoized per socket, so the per-keystroke rate costs one lookup per
  // conversation rather than one per event.
  socket.on(
    "customer:typing",
    async (payload: { conversationId: string; isTyping: boolean }) => {
      if (!payload?.conversationId || !socket.auth) return;
      if (socket.auth.kind !== "contact") return;
      try {
        if (!(await mayAccessConversation(socket, payload.conversationId))) return;
        socket.to(`org:${socket.auth.organizationId}`).emit("customer:typing", {
          conversationId: payload.conversationId,
          isTyping: Boolean(payload.isTyping),
        });
      } catch {
        // Best-effort, and failing closed costs only an indicator.
      }
    },
  );
}
