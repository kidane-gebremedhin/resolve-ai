// What the model is shown of the conversation so far (__specs/37 G1-G3).

import mongoose from "mongoose";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { Message } from "../models/index.js";
import { HISTORY_LIMIT, loadTurnHistory, windowHistory } from "../services/ai/graph/history.js";
import { buildInitialMessages } from "../services/ai/graph/runner.js";

async function seedConversation(n: number) {
  const conversationId = new mongoose.Types.ObjectId();
  const organizationId = new mongoose.Types.ObjectId();
  const base = Date.now() - n * 1000;
  await Message.collection.insertMany(
    Array.from({ length: n }, (_, i) => ({
      conversationId,
      organizationId,
      role: i % 2 === 0 ? "customer" : "ai",
      senderType: i % 2 === 0 ? "contact" : "ai",
      content: `message ${i}`,
      createdAt: new Date(base + i * 1000),
      updatedAt: new Date(base + i * 1000),
    })),
  );
  return conversationId;
}

describe("turn history", () => {
  it("shows the newest messages, not the first ones", async () => {
    // 31 messages; #30 is the customer message that triggered this turn.
    const id = await seedConversation(31);
    const history = await loadTurnHistory(id, "message 30");
    expect(history).toHaveLength(HISTORY_LIMIT);
    // Oldest first, ending right before the current turn.
    expect(history[0]!.content).toBe("message 10");
    expect(history[history.length - 1]!.content).toBe("message 29");
  });

  it("does not repeat the current customer message", async () => {
    const id = await seedConversation(5); // 0..4, #4 is a customer message
    const history = await loadTurnHistory(id, "message 4");
    expect(history.map((m) => m.content)).toEqual(["message 0", "message 1", "message 2", "message 3"]);

    const messages = buildInitialMessages({
      systemPrompt: "sys",
      history,
      customerMessage: "message 4",
      imageParts: [],
      piiRedact: false,
    });
    const said = messages.filter((m) => m.content === "message 4");
    expect(said).toHaveLength(1);
  });

  it("keeps the newest message when it is not the one being answered", () => {
    // E.g. a present-only turn, where the "customer message" is synthetic.
    const rows = [
      { role: "customer", content: "real latest" },
      { role: "ai", content: "earlier reply" },
    ];
    expect(windowHistory(rows, "something else").map((r) => r.content)).toEqual(["earlier reply", "real latest"]);
  });

  it("puts operator messages on the support side and leaves system notices out", () => {
    const messages = buildInitialMessages({
      systemPrompt: "sys",
      history: [
        { role: "customer", content: "Where is my order?" },
        { role: "operator", content: "I have refunded you." },
        { role: "system", content: "Conversation escalated" },
        { role: "ai", content: "Anything else?" },
      ],
      customerMessage: "Thanks",
      imageParts: [],
      piiRedact: false,
    });
    expect(messages[0]).toBeInstanceOf(SystemMessage);
    expect(messages[1]).toBeInstanceOf(HumanMessage);
    expect(messages[2]).toBeInstanceOf(AIMessage);
    expect(String(messages[2]!.content)).toBe("[Human support agent] I have refunded you.");
    expect(messages.some((m) => String(m.content).includes("Conversation escalated"))).toBe(false);
    expect(messages[3]).toBeInstanceOf(AIMessage);
    expect(messages[4]).toBeInstanceOf(HumanMessage);
    expect(messages).toHaveLength(5);
  });
});
