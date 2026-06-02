import type { Server as IoServer, Socket } from "socket.io";

export function registerConversationHandlers(_io: IoServer, socket: Socket): void {
  socket.on("join:conversation", (payload: { conversationId: string }) => {
    if (!payload?.conversationId) return;
    socket.join(`conversation:${payload.conversationId}`);
  });
  socket.on("leave:conversation", (payload: { conversationId: string }) => {
    if (!payload?.conversationId) return;
    socket.leave(`conversation:${payload.conversationId}`);
  });
}
