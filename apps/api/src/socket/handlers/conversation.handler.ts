import type { Server as IoServer, Socket } from "socket.io";
import { Conversation } from "../../models/index.js";
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
 * So the id is checked against the socket's identity here:
 *   - an OPERATOR may join any conversation in their own organization;
 *   - a CONTACT may join only conversations belonging to their own session.
 *
 * A refusal is silent by design. The client asked for something it is not
 * entitled to, and telling it whether the conversation exists would turn this
 * handler into an existence oracle for other tenants' ids.
 */
async function mayJoin(socket: Socket, conversationId: string): Promise<boolean> {
  const auth = socket.auth;
  if (!auth) return false;

  const conversation = await Conversation.findById(conversationId)
    .select({ organizationId: 1, contactSessionId: 1 })
    .lean();
  if (!conversation) return false;

  if (String(conversation.organizationId) !== String(auth.organizationId)) return false;
  if (auth.kind === "contact") {
    return String(conversation.contactSessionId) === String(auth.contactSessionId);
  }
  return true;
}

export function registerConversationHandlers(_io: IoServer, socket: Socket): void {
  socket.on("join:conversation", (payload: { conversationId: string }) => {
    const conversationId = payload?.conversationId;
    if (!conversationId) return;
    void (async () => {
      try {
        if (!(await mayJoin(socket, conversationId))) {
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
