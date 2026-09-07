import mongoose from "mongoose";
import type { Socket } from "socket.io";
import { Conversation } from "../models/index.js";
import type { SocketAuth } from "./auth.js";

/**
 * The single rule for "may this socket touch this conversation?".
 *
 * The connection-time middleware in `auth.ts` establishes WHO a socket is. It
 * cannot vet the conversation ids the client sends afterwards, and every
 * conversation-scoped event carries one. That id is attacker-controlled.
 *
 * `join:conversation` learned this the hard way and grew its own check. The
 * sibling handlers did not, so the same client-supplied id was still trusted by
 * `message:send` (which writes a message and triggers a billable AI reply) and
 * by the legacy `typing:*` relays. Keeping the rule in one module is the point:
 * three copies of an authorization check is three chances to drift.
 *
 * The rule itself:
 *   - an OPERATOR may act on any conversation in their own organization;
 *   - a CONTACT may act only on conversations belonging to their own session.
 *
 * Same tenant is not the same person. Two visitors on the same customer's site
 * share an organizationId, so an org check alone lets one drive the other's chat.
 */
export function isConversationVisibleTo(
  auth: SocketAuth | undefined,
  conversation: { organizationId: unknown; contactSessionId?: unknown } | null,
): boolean {
  if (!auth || !conversation) return false;
  if (String(conversation.organizationId) !== String(auth.organizationId)) return false;
  if (auth.kind === "contact") {
    return (
      Boolean(auth.contactSessionId) &&
      String(conversation.contactSessionId) === String(auth.contactSessionId)
    );
  }
  return true;
}

/**
 * Decisions are memoized per socket because `customer:typing` fires on every
 * keystroke, and a Mongo round trip per keystroke is not a typing indicator,
 * it is a load test. Both inputs are immutable for the life of a connection:
 * a socket's identity is fixed at handshake, and a conversation never changes
 * owner. The cap keeps a socket that sprays random ids from growing the map
 * without bound.
 */
const CACHE_LIMIT = 32;
const decisions = new WeakMap<Socket, Map<string, boolean>>();

function remember(socket: Socket, conversationId: string, allowed: boolean): boolean {
  let byId = decisions.get(socket);
  if (!byId) {
    byId = new Map();
    decisions.set(socket, byId);
  }
  if (!byId.has(conversationId) && byId.size >= CACHE_LIMIT) {
    const oldest = byId.keys().next();
    if (!oldest.done) byId.delete(oldest.value);
  }
  byId.set(conversationId, allowed);
  return allowed;
}

/**
 * Records access to a conversation this socket just created, so the mint-then-use
 * path does not pay for a lookup that can only ever say yes.
 */
export function grantConversationAccess(socket: Socket, conversationId: string): void {
  remember(socket, conversationId, true);
}

export async function mayAccessConversation(
  socket: Socket,
  conversationId: string,
): Promise<boolean> {
  const auth = socket.auth;
  if (!auth || !conversationId) return false;
  // A malformed id would make findById throw a CastError. Callers treat a throw
  // as a refusal anyway, but there is no reason to pay for the exception.
  if (!mongoose.isValidObjectId(conversationId)) return false;

  const cached = decisions.get(socket)?.get(conversationId);
  if (cached !== undefined) return cached;

  const conversation = await Conversation.findById(conversationId)
    .select({ organizationId: 1, contactSessionId: 1 })
    .lean();

  // A missing conversation is refused but NOT cached. Non-existence is the one
  // input here that is not immutable: the socket may be about to create this
  // very conversation, and a cached "no" would outlive the reason for it.
  if (!conversation) return false;

  return remember(socket, conversationId, isConversationVisibleTo(auth, conversation));
}
