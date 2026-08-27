// Public entry point for the AI layer.
//
// `generateAiReply` is the one function the rest of the API calls to answer a
// customer. It runs the LangGraph `StateGraph` in ./graph — see
// __specs/05-ai-agent-design.md for the node layout, tool contract and input
// gate.
//
// This is a one-line passthrough on purpose: it is the seam every caller depends
// on, so the graph's internals stay swappable without touching the routes and
// socket handlers. There is one implementation and no engine switch — anything
// that needs to change about a customer turn changes in the graph.

import type { Server as IoServer } from "socket.io";
import type { HydratedDocument } from "mongoose";
import type { ConversationDocType } from "../../models/index.js";
import { generateAiReplyWithGraph } from "./graph/runner.js";
import type { CurrentAttachment } from "./shared/attachments.js";

export type { CurrentAttachment };

export async function generateAiReply(
  conversation: HydratedDocument<ConversationDocType>,
  customerMessage: string,
  io: IoServer | null,
  currentAttachments?: CurrentAttachment[],
  presentToolResult?: { toolKey: string; result: unknown },
): Promise<void> {
  return generateAiReplyWithGraph(
    conversation,
    customerMessage,
    io,
    currentAttachments,
    presentToolResult,
  );
}
