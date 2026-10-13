// Which earlier messages the model sees on a turn.
//
// Two bugs lived here (__specs/37 G1, G2). The query sorted ascending with a
// limit, so a conversation past 20 messages showed the model its FIRST 20 and
// nothing since, while the comment called it "recent history". And every
// caller persists the customer's message before generating the reply, so on a
// short conversation the current message came back in the history and was then
// appended again as the current turn.

import { Message } from "../../../models/index.js";

/** How many earlier messages are replayed to the model. */
export const HISTORY_LIMIT = 20;

export type HistoryRow = { role: string; content: string; attachments?: unknown };

/**
 * The newest `limit` messages before this turn, oldest first.
 *
 * `newestFirst` is the conversation sorted by `createdAt` descending. If the
 * newest row is the customer message that triggered this turn (the usual case:
 * callers persist it first), it is dropped, because the runner appends it as
 * the current turn.
 */
export function windowHistory(
  newestFirst: readonly HistoryRow[],
  currentCustomerMessage: string,
  limit = HISTORY_LIMIT,
): HistoryRow[] {
  const rows = [...newestFirst];
  const newest = rows[0];
  if (newest && newest.role === "customer" && newest.content === currentCustomerMessage) {
    rows.shift();
  }
  return rows.slice(0, limit).reverse();
}

/** Load and window the history for one turn. One indexed query, `limit + 1` rows. */
export async function loadTurnHistory(
  conversationId: unknown,
  currentCustomerMessage: string,
  limit = HISTORY_LIMIT,
): Promise<HistoryRow[]> {
  const newestFirst = (await Message.find({ conversationId })
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean()) as unknown as HistoryRow[];
  return windowHistory(newestFirst, currentCustomerMessage, limit);
}
