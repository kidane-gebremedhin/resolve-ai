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

/**
 * With more than one API replica, a broadcast must reach sockets connected to
 * the OTHER replicas too. When REDIS_URL is set, rooms are shared through
 * Redis pub/sub. Without it the server stays single-instance (fine for one
 * replica; see RUNBOOK "Scaling out").
 */
function attachRedisAdapter(io: IoServer): void {
  if (!env.redisUrl) return;
  void (async () => {
    try {
      const [{ createAdapter }, { Redis }] = await Promise.all([
        import("@socket.io/redis-adapter"),
        import("ioredis"),
      ]);
      const pub = new Redis(env.redisUrl!, { maxRetriesPerRequest: null });
      const sub = pub.duplicate();
      pub.on("error", (err) => logger.warn("[socket] redis pub error", { err: err.message }));
      sub.on("error", (err) => logger.warn("[socket] redis sub error", { err: err.message }));
      io.adapter(createAdapter(pub, sub));
      logger.info("[socket] redis adapter attached");
    } catch (err) {
      logger.error("[socket] redis adapter failed; continuing single-instance", {
        err: (err as Error).message,
      });
    }
  })();
}

/**
 * Rooms a socket joins at handshake. Only OPERATORS join the org room: it
 * carries internal traffic (alert notifications, every conversation's events,
 * knowledge-base changes), and anonymous widget visitors used to receive all
 * of it. Visitors get what concerns them through `contact:<sessionId>`.
 */
export function joinInitialRooms(socket: Pick<Socket, "join">, auth: SocketAuth): void {
  if (auth.kind === "operator") {
    socket.join(`org:${auth.organizationId}`);
    if (auth.userId) socket.join(`user:${auth.userId}`);
  }
  if (auth.kind === "contact" && auth.contactSessionId) {
    socket.join(`contact:${auth.contactSessionId}`);
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
  attachRedisAdapter(io);

  io.use(async (socket, next) => {
    try {
      const auth = await authenticateSocket(socket);
      socket.auth = auth;
      joinInitialRooms(socket, auth);
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
