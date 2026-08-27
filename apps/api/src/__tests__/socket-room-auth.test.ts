// Joining a conversation room is an authorization decision.
//
// It did not used to be. `join:conversation` took the client's word for the id,
// so any authenticated socket — including a widget visitor from a different
// organization — could join `conversation:<anyId>` and receive that
// conversation's `message:new`, `conversation:updated` and typing events.
// __specs/12 §13 lists "Socket.io auth middleware prevents unauthorized room
// joins" as a required control; the middleware scopes the rooms it joins
// itself, but it cannot vet a room the client asks for afterwards.
//
// These tests drive the handler directly with a fake socket. That keeps them
// about the authorization decision rather than about socket.io's transport.

import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerConversationHandlers } from "../socket/handlers/conversation.handler.js";
import { Conversation } from "../models/index.js";
import type { Server as IoServer, Socket } from "socket.io";

type Handler = (payload: { conversationId: string }) => void;

/** A socket stub that records the rooms it was asked to join. */
function fakeSocket(auth: Record<string, unknown> | undefined) {
  const handlers = new Map<string, Handler>();
  const joined: string[] = [];
  const left: string[] = [];
  const socket = {
    auth,
    on(event: string, fn: Handler) {
      handlers.set(event, fn);
    },
    join(room: string) {
      joined.push(room);
    },
    leave(room: string) {
      left.push(room);
    },
  } as unknown as Socket;

  registerConversationHandlers({} as IoServer, socket);

  return {
    joined,
    left,
    /** Fire an event and wait for the handler's async authorization to settle. */
    async emit(event: string, payload: { conversationId: string }) {
      handlers.get(event)?.(payload);
      // The handler defers its DB lookup; let the microtask queue drain.
      await vi.waitFor(() => expect(true).toBe(true));
      await new Promise((r) => setTimeout(r, 20));
    },
  };
}

describe("join:conversation", () => {
  const orgA = new mongoose.Types.ObjectId();
  const orgB = new mongoose.Types.ObjectId();
  const sessionA = new mongoose.Types.ObjectId();
  const sessionOther = new mongoose.Types.ObjectId();
  let convoA: string;

  beforeEach(async () => {
    const convo = await Conversation.create({
      threadId: `t-${Date.now()}-${Math.random()}`,
      organizationId: orgA,
      websiteId: new mongoose.Types.ObjectId(),
      agentId: new mongoose.Types.ObjectId(),
      contactSessionId: sessionA,
      status: "active",
    });
    convoA = String(convo._id);
  });

  it("lets an operator join a conversation in their own organization", async () => {
    const s = fakeSocket({ kind: "operator", organizationId: String(orgA), userId: "u1" });
    await s.emit("join:conversation", { conversationId: convoA });
    expect(s.joined).toEqual([`conversation:${convoA}`]);
  });

  it("refuses an operator from another organization", async () => {
    // The leak this whole file exists for: org B watching org A's traffic.
    const s = fakeSocket({ kind: "operator", organizationId: String(orgB), userId: "u2" });
    await s.emit("join:conversation", { conversationId: convoA });
    expect(s.joined).toEqual([]);
  });

  it("lets a visitor join their own conversation", async () => {
    const s = fakeSocket({
      kind: "contact",
      organizationId: String(orgA),
      contactSessionId: String(sessionA),
    });
    await s.emit("join:conversation", { conversationId: convoA });
    expect(s.joined).toEqual([`conversation:${convoA}`]);
  });

  it("refuses a visitor another visitor's conversation in the same organization", async () => {
    // Same tenant is not the same person. A widget session must not be able to
    // watch another customer's chat by guessing an id.
    const s = fakeSocket({
      kind: "contact",
      organizationId: String(orgA),
      contactSessionId: String(sessionOther),
    });
    await s.emit("join:conversation", { conversationId: convoA });
    expect(s.joined).toEqual([]);
  });

  it("refuses an id that does not exist, without saying so", async () => {
    const s = fakeSocket({ kind: "operator", organizationId: String(orgA) });
    await s.emit("join:conversation", { conversationId: String(new mongoose.Types.ObjectId()) });
    expect(s.joined).toEqual([]);
  });

  it("refuses an unauthenticated socket", async () => {
    const s = fakeSocket(undefined);
    await s.emit("join:conversation", { conversationId: convoA });
    expect(s.joined).toEqual([]);
  });

  it("ignores a malformed payload instead of throwing", async () => {
    const s = fakeSocket({ kind: "operator", organizationId: String(orgA) });
    await s.emit("join:conversation", {} as { conversationId: string });
    expect(s.joined).toEqual([]);
  });

  it("fails closed when the lookup itself errors", async () => {
    const spy = vi.spyOn(Conversation, "findById").mockImplementation(() => {
      throw new Error("mongo is down");
    });
    try {
      const s = fakeSocket({ kind: "operator", organizationId: String(orgA) });
      await s.emit("join:conversation", { conversationId: convoA });
      expect(s.joined).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("still lets any socket leave a room", async () => {
    // Leaving can only ever remove the caller, so it needs no check.
    const s = fakeSocket({ kind: "contact", organizationId: String(orgB) });
    await s.emit("leave:conversation", { conversationId: convoA });
    expect(s.left).toEqual([`conversation:${convoA}`]);
  });
});
