import type { Server as HttpServer } from "node:http";
import { Server as IoServer, type Socket } from "socket.io";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { authenticateSocket, type SocketAuth } from "./auth.js";
import { registerMessageHandlers } from "./handlers/message.handler.js";
import { registerConversationHandlers } from "./handlers/conversation.handler.js";
import { registerTypingHandlers } from "./handlers/typing.handler.js";

declare module "socket.io" {
  interface Socket {
    auth?: SocketAuth;
  }
}

// Module-level holder so background jobs / async services (kb ingestion,
// embedding reconcile) can broadcast without threading the io instance
// through every call site. Set once from `attachSocketServer`.
let ioRef: IoServer | null = null;

export function getIoServer(): IoServer | null {
  return ioRef;
}

export function attachSocketServer(httpServer: HttpServer): IoServer {
  const io = new IoServer(httpServer, {
    cors: { origin: env.corsOrigins, credentials: true },
  });
  ioRef = io;

  io.use(async (socket, next) => {
    try {
      const auth = await authenticateSocket(socket);
      socket.auth = auth;
      // Each socket auto-joins its org room so operator broadcasts hit it.
      socket.join(`org:${auth.organizationId}`);
      if (auth.kind === "contact" && auth.contactSessionId) {
        socket.join(`contact:${auth.contactSessionId}`);
      }
      if (auth.kind === "operator" && auth.userId) {
        socket.join(`user:${auth.userId}`);
      }
      next();
    } catch (err) {
      logger.warn("[socket] auth failed", { reason: (err as Error).message });
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket: Socket) => {
    logger.info("[socket] connected", {
      id: socket.id,
      kind: socket.auth?.kind,
      org: socket.auth?.organizationId,
    });
    registerMessageHandlers(io, socket);
    registerConversationHandlers(io, socket);
    registerTypingHandlers(io, socket);
    socket.on("disconnect", (reason) => {
      logger.info("[socket] disconnected", { id: socket.id, reason });
    });
  });

  return io;
}
