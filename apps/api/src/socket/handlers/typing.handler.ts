import type { Server as IoServer, Socket } from "socket.io";

export function registerTypingHandlers(_io: IoServer, socket: Socket): void {
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
}
