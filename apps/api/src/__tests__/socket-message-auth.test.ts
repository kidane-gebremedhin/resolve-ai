// Every conversation-scoped socket event carries a client-supplied conversation
// id, and that id is attacker-controlled. `join:conversation` was hardened for
// this (see socket-room-auth.test.ts) but its siblings were not: `message:send`
// and `customer:typing` checked only the organization.
//
// Same tenant is not the same person. Two visitors on one customer's website
// share an organizationId, so an org-only check let visitor A write into
// visitor B's conversation (a message attributed to B, plus a billable AI reply
// on B's thread) and put a false typing indicator on B's chat in the operator
// inbox.

import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateAiReply } from "../services/ai/index.js";
import { registerMessageHandlers } from "../socket/handlers/message.handler.js";
import { registerTypingHandlers } from "../socket/handlers/typing.handler.js";
import { Conversation, Message, ContactSession, Agent } from "../models/index.js";
import type { Server as IoServer, Socket } from "socket.io";

vi.mock("../services/ai/index.js", () => ({
  generateAiReply: vi.fn(async () => undefined),
}));

type Handler = (payload: Record<string, unknown>) => void | Promise<void>;

/** Records what the handler broadcast, and to where. */
function fakeSocket(auth: Record<string, unknown> | undefined, rooms: string[] = []) {
  const handlers = new Map<string, Handler>();
  const emitted: Array<{ room: string; event: string; payload: unknown }> = [];
  const socket = {
    auth,
    rooms: new Set(rooms),
    on(event: string, fn: Handler) {
      handlers.set(event, fn);
    },
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emitted.push({ room, event, payload });
        },
      };
    },
  } as unknown as Socket;

  const io = {
    to() {
      return { emit() {} };
    },
  } as unknown as IoServer;

  registerMessageHandlers(io, socket);
  registerTypingHandlers(io, socket);

  return {
    emitted,
    async fire(event: string, payload: Record<string, unknown>) {
      await handlers.get(event)?.(payload);
      await new Promise((r) => setTimeout(r, 20));
    },
  };
}

describe("conversation-scoped socket events reject a foreign id", () => {
  const orgA = new mongoose.Types.ObjectId();
  const orgB = new mongoose.Types.ObjectId();
  const ownerSession = new mongoose.Types.ObjectId();
  const otherSession = new mongoose.Types.ObjectId();
  let convoA: string;

  beforeEach(async () => {
    vi.mocked(generateAiReply).mockClear();
    const convo = await Conversation.create({
      threadId: `t-${Date.now()}-${Math.random()}`,
      organizationId: orgA,
      websiteId: new mongoose.Types.ObjectId(),
      agentId: new mongoose.Types.ObjectId(),
      contactSessionId: ownerSession,
      status: "active",
    });
    convoA = String(convo._id);
  });

  const asContact = (session: mongoose.Types.ObjectId, org = orgA) => ({
    kind: "contact",
    organizationId: String(org),
    contactSessionId: String(session),
  });

  describe("message:send", () => {
    it("lets the owning visitor post to their own conversation", async () => {
      const s = fakeSocket(asContact(ownerSession));
      await s.fire("message:send", { conversationId: convoA, content: "hello" });
      const messages = await Message.find({ conversationId: convoA });
      expect(messages).toHaveLength(1);
      expect(messages[0]!.content).toBe("hello");
    });

    it("refuses another visitor in the same organization", async () => {
      const s = fakeSocket(asContact(otherSession));
      await s.fire("message:send", { conversationId: convoA, content: "not mine" });
      expect(await Message.countDocuments({ conversationId: convoA })).toBe(0);
    });

    it("does not trigger a billable AI reply for a foreign conversation", async () => {
      // The expensive half of the bug: the write is bad, the spend is worse.
      const s = fakeSocket(asContact(otherSession));
      await s.fire("message:send", { conversationId: convoA, content: "burn tokens" });
      expect(generateAiReply).not.toHaveBeenCalled();
    });

    it("refuses a visitor from another organization", async () => {
      const s = fakeSocket(asContact(otherSession, orgB));
      await s.fire("message:send", { conversationId: convoA, content: "cross tenant" });
      expect(await Message.countDocuments({ conversationId: convoA })).toBe(0);
    });

    it("lets an operator in the same organization reply", async () => {
      const s = fakeSocket({
        kind: "operator",
        organizationId: String(orgA),
        userId: String(new mongoose.Types.ObjectId()),
      });
      await s.fire("message:send", { conversationId: convoA, content: "operator here" });
      const messages = await Message.find({ conversationId: convoA });
      expect(messages).toHaveLength(1);
      expect(messages[0]!.role).toBe("operator");
      expect(generateAiReply).not.toHaveBeenCalled();
    });

    it("refuses an operator from another organization", async () => {
      const s = fakeSocket({
        kind: "operator",
        organizationId: String(orgB),
        userId: String(new mongoose.Types.ObjectId()),
      });
      await s.fire("message:send", { conversationId: convoA, content: "other tenant" });
      expect(await Message.countDocuments({ conversationId: convoA })).toBe(0);
    });

    it("still lets a visitor mint their first conversation", async () => {
      // The no-id path must keep working: the owner check cannot break onboarding.
      const websiteId = new mongoose.Types.ObjectId();
      const session = await ContactSession.create({
        organizationId: orgA,
        websiteId,
        token: `tok-${Date.now()}-${Math.random()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await Agent.create({
        organizationId: orgA,
        websiteId,
        name: "A",
        systemPrompt: "hi",
        isActive: true,
      });
      const s = fakeSocket({
        kind: "contact",
        organizationId: String(orgA),
        contactSessionId: String(session._id),
      });
      await s.fire("message:send", { content: "first message" });
      const convo = await Conversation.findOne({ contactSessionId: session._id });
      expect(convo).not.toBeNull();
      expect(await Message.countDocuments({ conversationId: convo!._id })).toBe(1);
      expect(generateAiReply).toHaveBeenCalledTimes(1);
    });
  });

  describe("customer:typing", () => {
    it("broadcasts for the visitor's own conversation", async () => {
      const s = fakeSocket(asContact(ownerSession));
      await s.fire("customer:typing", { conversationId: convoA, isTyping: true });
      expect(s.emitted).toEqual([
        {
          room: `org:${String(orgA)}`,
          event: "customer:typing",
          payload: { conversationId: convoA, isTyping: true },
        },
      ]);
    });

    it("refuses another visitor's conversation in the same organization", async () => {
      const s = fakeSocket(asContact(otherSession));
      await s.fire("customer:typing", { conversationId: convoA, isTyping: true });
      expect(s.emitted).toEqual([]);
    });

    it("looks the conversation up once no matter how many keystrokes arrive", async () => {
      // customer:typing fires on every keypress; a lookup per keypress would be
      // a load test, not a typing indicator.
      const spy = vi.spyOn(Conversation, "findById");
      try {
        const s = fakeSocket(asContact(ownerSession));
        for (let i = 0; i < 5; i++) {
          await s.fire("customer:typing", { conversationId: convoA, isTyping: true });
        }
        expect(s.emitted).toHaveLength(5);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("legacy typing:start relay", () => {
    it("relays for a socket that joined the room", async () => {
      const s = fakeSocket(asContact(ownerSession), [`conversation:${convoA}`]);
      await s.fire("typing:start", { conversationId: convoA });
      expect(s.emitted).toHaveLength(1);
      expect(s.emitted[0]!.room).toBe(`conversation:${convoA}`);
    });

    it("refuses a socket that never joined the room", async () => {
      // `socket.to(room)` broadcasts whether or not the sender is a member, so
      // without this check any authenticated socket could inject typing events
      // into any tenant's conversation.
      const s = fakeSocket({ kind: "operator", organizationId: String(orgB) });
      await s.fire("typing:start", { conversationId: convoA });
      expect(s.emitted).toEqual([]);
    });
  });
});
