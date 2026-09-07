import type { Server as IoServer, Socket } from "socket.io";
import { mayAccessConversation } from "../authorize.js";
import { logger } from "../../config/logger.js";

/**
 * Joining a conversation room is an authorization decision, not a subscription.
 *
 * This used to take the client's word for it: any authenticated socket could
 * `join:conversation` with ANY id and start receiving that conversation's
 * `message:new`, `conversation:updated` and typing events — including a widget
 * visitor from one organization joining another organization's conversation.
 * The connection-time middleware authenticates the socket and scopes its own
 * rooms, but it cannot vet a room the client asks for afterwards.
 *
 * The rule lives in `../authorize.ts`, shared with the message and typing
 * handlers so it stays one rule rather than three drifting copies.
 *
 * A refusal is silent by design. The client asked for something it is not
 * entitled to, and telling it whether the conversation exists would turn this
 * handler into an existence oracle for other tenants' ids.
 */
export function registerConversationHandlers(_io: IoServer, socket: Socket): void {
  socket.on("join:conversation", (payload: { conversationId: string }) => {
    const conversationId = payload?.conversationId;
    if (!conversationId) return;
    void (async () => {
      try {
        if (!(await mayAccessConversation(socket, conversationId))) {
          logger.warn("[socket] refused conversation join", {
            conversationId,
            kind: socket.auth?.kind,
            organizationId: socket.auth?.organizationId,
          });
          return;
        }
        socket.join(`conversation:${conversationId}`);
      } catch (err) {
        // A lookup failure must not join the room. Failing closed is the whole
        // point of the check.
        logger.error("[socket] conversation join check failed", {
          conversationId,
          err: (err as Error).message,
        });
      }
    })();
  });

  // Leaving needs no check: a socket can only ever remove itself, and letting
  // it leave a room it was never in is harmless.
  socket.on("leave:conversation", (payload: { conversationId: string }) => {
    if (!payload?.conversationId) return;
    socket.leave(`conversation:${payload.conversationId}`);
  });
}
