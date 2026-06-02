import type { Socket } from "socket.io";
import { verifyAccessToken } from "../utils/jwt.js";
import { ContactSession } from "../models/index.js";

export type SocketAuth = {
  kind: "operator" | "contact";
  userId?: string;
  organizationId: string;
  contactSessionId?: string;
};

export async function authenticateSocket(socket: Socket): Promise<SocketAuth> {
  const { token, sessionToken } = socket.handshake.auth ?? {};

  // Operator (dashboard) connections present a JWT.
  if (typeof token === "string" && token.length > 0) {
    const payload = verifyAccessToken(token);
    if (!payload.organizationId) throw new Error("Operator socket missing organizationId");
    return {
      kind: "operator",
      userId: payload.userId,
      organizationId: payload.organizationId,
    };
  }

  // Customer (widget) connections present a contact session token.
  if (typeof sessionToken === "string" && sessionToken.length > 0) {
    const session = await ContactSession.findOne({ token: sessionToken });
    if (!session) throw new Error("Invalid contact session token");
    if (session.expiresAt.getTime() < Date.now()) {
      throw new Error("Contact session expired");
    }
    return {
      kind: "contact",
      organizationId: session.organizationId.toString(),
      contactSessionId: session._id.toString(),
    };
  }

  throw new Error("No auth credential provided");
}
