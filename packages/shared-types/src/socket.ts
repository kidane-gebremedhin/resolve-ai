// Socket.io event types. Populated in Phase 2.

export type SocketDirection = "client-to-server" | "server-to-client";

export interface ServerToClientEvents {
  "message:new": (payload: { conversationId: string; messageId: string }) => void;
  "conversation:updated": (payload: { conversationId: string }) => void;
  "typing:start": (payload: { conversationId: string; from: "operator" | "customer" }) => void;
  "typing:stop": (payload: { conversationId: string; from: "operator" | "customer" }) => void;
}

export interface ClientToServerEvents {
  "join:conversation": (payload: { conversationId: string }) => void;
  "leave:conversation": (payload: { conversationId: string }) => void;
  "typing:start": (payload: { conversationId: string }) => void;
  "typing:stop": (payload: { conversationId: string }) => void;
}
