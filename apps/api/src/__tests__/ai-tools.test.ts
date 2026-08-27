// Unit tests for the pure decision logic the reply engine depends on: whether a
// tool call has everything it needs, and what the org's conversation controls
// allow the agent to actually do.

import { describe, expect, it } from "vitest";
import { gateToolInput } from "../services/ai/tools/input-gate.js";
import { applyConversationControls } from "../services/ai/shared/controls.js";
import type { ToolRegistry } from "../services/ai/tools/types.js";

const lookupOrderSchema = {
  type: "object",
  properties: {
    orderId: { type: "string", description: "The order number" },
    email: { type: "string" },
  },
  required: ["orderId", "email"],
};

const bookMeetingSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    eventTypeId: { type: "string" },
    startTime: { type: "string" },
  },
  required: ["name", "eventTypeId", "startTime"],
};

function registry(overrides: Partial<ToolRegistry> = {}): ToolRegistry {
  return {
    tools: [],
    byName: new Map(),
    builtinNames: new Set(["search_kb"]),
    schemaByKey: new Map<string, unknown>([
      ["lookup_order", lookupOrderSchema],
      ["book_meeting", bookMeetingSchema],
    ]),
    guardrailsByKey: new Map(),
    webhookToolKeys: new Set(),
    activeToolKeys: ["lookup_order", "book_meeting"],
    promptTools: [],
    ...overrides,
  };
}

describe("gateToolInput", () => {
  it("lets a built-in tool through without inspecting its arguments", () => {
    expect(gateToolInput("search_kb", {}, registry())).toEqual({ kind: "ready" });
  });

  it("dispatches when every customer-supplied field is present", () => {
    const decision = gateToolInput("lookup_order", { orderId: "A-1001" }, registry());
    // `email` is injected server-side from the contact session, so its absence
    // from the model's arguments must not trigger a form.
    expect(decision).toEqual({ kind: "ready" });
  });

  it("collects a missing required field instead of dispatching a guess", () => {
    const decision = gateToolInput("lookup_order", {}, registry());
    expect(decision.kind).toBe("collect");
    if (decision.kind !== "collect") throw new Error("expected a collect decision");
    expect(decision.block).toMatchObject({ type: "form", toolKey: "lookup_order" });
    const fields = (decision.block as { fields: { key: string }[] }).fields;
    expect(fields.map((f) => f.key)).toEqual(["orderId"]);
    expect(decision.note).toContain("Do NOT call lookup_order again");
  });

  it("treats a placeholder value as missing", () => {
    const decision = gateToolInput("lookup_order", { orderId: "[ORDER_ID]" }, registry());
    expect(decision.kind).toBe("collect");
  });

  it("renders the operator's whole schema for a custom webhook tool", () => {
    const decision = gateToolInput(
      "lookup_order",
      {},
      registry({ webhookToolKeys: new Set(["lookup_order"]) }),
    );
    if (decision.kind !== "collect") throw new Error("expected a collect decision");
    const fields = (decision.block as { fields: { key: string }[] }).fields;
    // Every operator-defined field, including the ones skipped for built-in tools.
    expect(fields.map((f) => f.key).sort()).toEqual(["email", "orderId"]);
  });

  it("steers to slot selection when a booking has no slot yet", () => {
    const decision = gateToolInput("book_meeting", { name: "Ada Lovelace" }, registry());
    expect(decision.kind).toBe("steer");
    if (decision.kind !== "steer") throw new Error("expected a steer decision");
    expect(decision.note).toContain("list_calendar_slots");
  });

  it("collects a real attendee name when the model supplies a placeholder one", () => {
    const decision = gateToolInput(
      "book_meeting",
      { name: "Customer", eventTypeId: "42", startTime: "2026-09-01T10:00:00Z" },
      registry(),
    );
    if (decision.kind !== "collect") throw new Error("expected a collect decision");
    const fields = (decision.block as { fields: { key: string }[] }).fields;
    expect(fields.map((f) => f.key)).toContain("name");
  });

  it("books directly once a slot and a real name are present", () => {
    const decision = gateToolInput(
      "book_meeting",
      { name: "Ada Lovelace", eventTypeId: "42", startTime: "2026-09-01T10:00:00Z" },
      registry(),
    );
    expect(decision).toEqual({ kind: "ready" });
  });
});

describe("applyConversationControls", () => {
  const controls = { allowHumanEscalation: false, requireResolveConfirmation: true };

  it("downgrades an escalation the org has disabled", () => {
    const out = applyConversationControls({
      action: "escalate",
      replyText: "Let me get a teammate.",
      customerMessage: "I want a human",
      controls,
      wasPendingResolve: false,
    });
    expect(out.action).toBe("reply");
  });

  it("passes an escalation through when the org allows it", () => {
    const out = applyConversationControls({
      action: "escalate",
      replyText: "Let me get a teammate.",
      customerMessage: "I want a human",
      controls: { ...controls, allowHumanEscalation: true },
      wasPendingResolve: false,
    });
    expect(out.action).toBe("escalate");
  });

  it("asks before resolving the first time, rather than closing the conversation", () => {
    const out = applyConversationControls({
      action: "resolve",
      replyText: "Glad that worked.",
      customerMessage: "thanks!",
      controls,
      wasPendingResolve: false,
    });
    expect(out.action).toBe("reply");
    expect(out.pendingResolve).toBe(true);
    expect(out.replyText).toContain("shall I close this conversation now?");
  });

  it("resolves only after the customer confirms on the next turn", () => {
    const out = applyConversationControls({
      action: "resolve",
      replyText: "Closing this out.",
      customerMessage: "yes please",
      controls,
      wasPendingResolve: true,
    });
    expect(out.action).toBe("resolve");
    expect(out.pendingResolve).toBe(false);
  });

  it("drops a pending confirmation when the conversation moves on", () => {
    const out = applyConversationControls({
      action: "reply",
      replyText: "Sure — what else can I help with?",
      customerMessage: "actually one more thing",
      controls,
      wasPendingResolve: true,
    });
    expect(out.pendingResolve).toBe(false);
  });
});
