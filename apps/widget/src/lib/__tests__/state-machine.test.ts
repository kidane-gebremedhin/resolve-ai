// The widget's state machine.
//
// This reducer is what a customer actually interacts with: it decides when a
// streamed reply becomes a bubble, when the contact form appears, and whether a
// conversation reads as active, escalated or resolved. Until now nothing tested
// it, which made it the highest-risk untested code in the repo — a regression
// here is visible to every visitor on a customer's website.
//
// Pure input/output, so every case below is exact rather than approximate.

import { describe, expect, it } from "vitest";
import { makeInitialState, reducer, type WidgetEvent, type WidgetState } from "../state-machine";
import type { WidgetMessage } from "../api-client";

const INIT = { domain: "example.test", agentId: "a1", websiteId: "w1" };

function bootstrapped(over: Partial<Extract<WidgetEvent, { type: "BOOTSTRAPPED" }>> = {}) {
  return {
    type: "BOOTSTRAPPED" as const,
    agent: { id: "a1", name: "Ada" } as never,
    settings: null as never,
    sections: [],
    next: "chat_active" as const,
    ...over,
  };
}

const msg = (over: Partial<WidgetMessage> = {}): WidgetMessage =>
  ({
    _id: "m1",
    conversationId: "c1",
    role: "ai",
    content: "hello",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }) as WidgetMessage;

/** A widget mid-conversation, with the given context overrides. */
function chatting(over: Partial<WidgetState["context"]> = {}): WidgetState {
  const booted = reducer(makeInitialState(INIT), bootstrapped());
  return { ...booted, context: { ...booted.context, conversationId: "c1", ...over } };
}

const run = (state: WidgetState, ...events: WidgetEvent[]): WidgetState =>
  events.reduce(reducer, state);

describe("boot", () => {
  it("starts initializing, with no agent and no conversation", () => {
    const s = makeInitialState(INIT);
    expect(s.state).toBe("boot");
    expect(s.context.isInitializing).toBe(true);
    expect(s.context.agent).toBeNull();
    expect(s.context.messages).toEqual([]);
  });

  it("defaults to the bottom-right position when the embed does not say", () => {
    expect(makeInitialState(INIT).context.position).toBe("bottom-right");
    expect(makeInitialState({ ...INIT, position: "centered" }).context.position).toBe("centered");
  });

  it("lands wherever bootstrap says, and stops initializing", () => {
    for (const next of ["pre_chat", "chat_active", "escalated", "resolved"] as const) {
      const s = reducer(makeInitialState(INIT), bootstrapped({ next }));
      expect(s.state).toBe(next);
      expect(s.context.isInitializing).toBe(false);
    }
  });

  it("goes to error on a failed boot and back to boot on retry", () => {
    const failed = reducer(makeInitialState(INIT), { type: "BOOT_FAILED", message: "no agent" });
    expect(failed.state).toBe("error");
    expect(failed.context.errorMessage).toBe("no agent");
    expect(failed.context.isInitializing).toBe(false);

    const retried = reducer(failed, { type: "RETRY" });
    expect(retried.state).toBe("boot");
    // The error has to be cleared, or the retry renders the old failure.
    expect(retried.context.errorMessage).toBeNull();
    expect(retried.context.isInitializing).toBe(true);
  });
});

describe("streaming a reply", () => {
  it("accumulates deltas without showing them as a message yet", () => {
    const s = run(
      chatting(),
      { type: "MESSAGE_DELTA", messageId: "m9", delta: "Refunds " },
      { type: "MESSAGE_DELTA", messageId: "m9", delta: "take 30 days." },
    );
    expect(s.context.inFlight.get("m9")).toBe("Refunds take 30 days.");
    expect(s.context.messages).toEqual([]);
  });

  it("keeps two concurrent streams apart", () => {
    const s = run(
      chatting(),
      { type: "MESSAGE_DELTA", messageId: "a", delta: "one" },
      { type: "MESSAGE_DELTA", messageId: "b", delta: "two" },
    );
    expect(s.context.inFlight.get("a")).toBe("one");
    expect(s.context.inFlight.get("b")).toBe("two");
  });

  it("promotes the stream to a real message and clears the in-flight entry", () => {
    // There must be no gap between the streaming bubble disappearing and the
    // static one appearing, or the typing indicator re-flashes.
    const s = run(
      chatting(),
      { type: "MESSAGE_DELTA", messageId: "m9", delta: "Done." },
      { type: "MESSAGE_DONE", messageId: "m9", content: "Done." },
    );
    expect(s.context.inFlight.has("m9")).toBe(false);
    expect(s.context.messages).toHaveLength(1);
    expect(s.context.messages[0]!.content).toBe("Done.");
    expect(s.context.messages[0]!.role).toBe("ai");
  });

  it("never mutates the previous state's in-flight map", () => {
    // The map is shared by reference if this is got wrong, and React then
    // fails to re-render because the object did not change identity.
    const before = chatting();
    const after = reducer(before, { type: "MESSAGE_DELTA", messageId: "m9", delta: "x" });
    expect(before.context.inFlight.size).toBe(0);
    expect(after.context.inFlight).not.toBe(before.context.inFlight);
  });

  it("upgrades the temp bubble in place when the full message arrives", () => {
    // MESSAGE_DONE writes a bare bubble; AI_REPLIED carries sources and quick
    // replies. Appending both would show the answer twice.
    const s = run(
      chatting(),
      { type: "MESSAGE_DONE", messageId: "m9", content: "Refunds take 30 days." },
      {
        type: "AI_REPLIED",
        message: msg({ _id: "m9", content: "Refunds take 30 days.", quickReplies: ["More"] } as never),
      },
    );
    expect(s.context.messages).toHaveLength(1);
    expect((s.context.messages[0] as { quickReplies?: string[] }).quickReplies).toEqual(["More"]);
  });
});

describe("the contact prompt", () => {
  it("appears after the first AI reply to a customer message", () => {
    const s = run(
      chatting(),
      { type: "MESSAGE_APPENDED", message: msg({ _id: "c-1", role: "customer", content: "hi" }) },
      { type: "AI_REPLIED", message: msg({ _id: "ai-1" }) },
    );
    expect(s.state).toBe("chat_active");
    expect(s.overlay).toBe("contact_prompt");
    expect(s.context.hasPromptedForContact).toBe(true);
  });

  it("does not appear when the email is already known", () => {
    const s = run(
      chatting({ contact: { email: "a@b.test" } }),
      { type: "MESSAGE_APPENDED", message: msg({ _id: "c-1", role: "customer", content: "hi" }) },
      { type: "AI_REPLIED", message: msg({ _id: "ai-1" }) },
    );
    expect(s.overlay).toBeNull();
  });

  it("does not appear for a proactive message the visitor did not ask for", () => {
    // A trigger can deliver an AI message before the visitor has typed
    // anything. Asking that visitor for their email is the wrong first move.
    const booted = reducer(makeInitialState(INIT), bootstrapped({ next: "pre_chat" }));
    const s = reducer(booted, { type: "AI_REPLIED", message: msg({ _id: "proactive" }) });
    expect(s.state).toBe("chat_active");
    expect(s.overlay).toBeNull();
    expect(s.context.hasPromptedForContact).toBe(false);
  });

  it("asks only once, even if the visitor dismisses it", () => {
    const asked = run(
      chatting(),
      { type: "MESSAGE_APPENDED", message: msg({ _id: "c-1", role: "customer", content: "hi" }) },
      { type: "AI_REPLIED", message: msg({ _id: "ai-1" }) },
    );
    const dismissed = reducer(asked, { type: "CONTACT_SKIPPED" });
    const secondReply = reducer(dismissed, { type: "AI_REPLIED", message: msg({ _id: "ai-2" }) });
    expect(secondReply.overlay).toBeNull();
  });

  it("records captured contact details and closes the overlay", () => {
    const s = reducer(chatting(), {
      type: "CONTACT_CAPTURED",
      contact: { email: "a@b.test", name: "Ada" },
    });
    expect(s.overlay).toBeNull();
    expect(s.context.contact).toEqual({ email: "a@b.test", name: "Ada" });
    expect(s.context.hasPromptedForContact).toBe(true);
  });

  it("can be triggered manually, but never over a resolved or errored widget", () => {
    expect(reducer(chatting(), { type: "PROMPT_CONTACT" }).overlay).toBe("contact_prompt");
    for (const state of ["resolved", "error"] as const) {
      const s = { ...chatting(), state };
      expect(reducer(s, { type: "PROMPT_CONTACT" })).toBe(s);
    }
  });

  it("re-shows the prompt on resume only when the email is still missing", () => {
    const shown = reducer(
      makeInitialState(INIT),
      bootstrapped({ next: "chat_active", showContactPrompt: true }),
    );
    expect(shown.overlay).toBe("contact_prompt");

    const known = reducer(
      makeInitialState(INIT),
      bootstrapped({ next: "chat_active", showContactPrompt: true, contact: { email: "a@b.test" } }),
    );
    expect(known.overlay).toBeNull();
    expect(known.context.hasPromptedForContact).toBe(true);
  });
});

describe("conversation status", () => {
  it("maps the created status onto the right screen", () => {
    for (const [status, expected] of [
      ["active", "chat_active"],
      ["escalated", "escalated"],
      ["resolved", "resolved"],
    ] as const) {
      const s = reducer(chatting(), {
        type: "CONVERSATION_CREATED",
        conversationId: "c2",
        status,
      });
      expect(s.state).toBe(expected);
      expect(s.context.conversationId).toBe("c2");
      // A new conversation starts empty; carrying the old thread over would
      // show the previous conversation's messages under a new id.
      expect(s.context.messages).toEqual([]);
    }
  });

  it("replaces the thread wholesale when messages are loaded", () => {
    const s = reducer(chatting({ messages: [msg({ _id: "old" })] }), {
      type: "MESSAGES_LOADED",
      messages: [msg({ _id: "a" }), msg({ _id: "b" })],
    });
    expect(s.context.messages.map((m) => m._id)).toEqual(["a", "b"]);
  });

  it("does not duplicate a message that is already in the thread", () => {
    const s = run(
      chatting(),
      { type: "MESSAGE_APPENDED", message: msg({ _id: "dup", content: "first" }) },
      { type: "MESSAGE_APPENDED", message: msg({ _id: "dup", content: "second" }) },
    );
    expect(s.context.messages).toHaveLength(1);
    expect(s.context.messages[0]!.content).toBe("second");
  });

  it("surfaces an error from anywhere without losing the conversation", () => {
    const s = reducer(chatting({ messages: [msg()] }), { type: "ERROR", message: "socket lost" });
    expect(s.state).toBe("error");
    expect(s.context.errorMessage).toBe("socket lost");
    expect(s.context.messages).toHaveLength(1);
  });
});
