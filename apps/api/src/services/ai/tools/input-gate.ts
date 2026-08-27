// Input-completeness gate.
//
// Before an integration tool runs, decide whether the model has actually given
// it everything it needs. When it hasn't, the right move is never to dispatch
// with guessed values — these are non-idempotent actions like bookings and
// refunds — but to render a form and stop until the customer fills it in.
//
// This lives in the graph rather than in the tool because it is a control-flow
// decision (execute vs. interrupt and ask), and because LangChain validates a
// tool's arguments against its JSON schema *before* the tool body runs: a call
// missing a required field would be rejected before any tool code could react.

import { looksLikeRealName } from "../../integrations/guardrails.js";
import { buildFormBlock, missingCustomerFields } from "../shared/forms.js";
import type { MessageBlock } from "../../../types/messageBlocks.js";
import type { ToolRegistry } from "./types.js";

export type GateDecision =
  /** Everything required is present — dispatch the call. */
  | { kind: "ready" }
  /** Collect the listed inputs from the customer first. */
  | { kind: "collect"; block: MessageBlock; note: string }
  /** The call cannot proceed yet; steer the model to the prerequisite step. */
  | { kind: "steer"; note: string };

/**
 * book_meeting can only proceed once a concrete slot has been chosen
 * (eventTypeId + startTime, from a slot card). Two failure modes are guarded:
 *
 *  1. The model jumps to booking before a slot exists — a name-only form would
 *     then submit with no slot and fail schema validation ("Submission failed").
 *     Steer it to list slots first instead.
 *  2. The model slips a hallucinated/placeholder name ("Customer", "there") past
 *     the emptiness check, so the booking proceeds under a fake name and looks
 *     "booked". When the named-attendee guardrail is on, treat a non-real name
 *     as missing so the form collects it.
 */
function bookMeetingAdjustments(
  args: Record<string, unknown>,
  requiresName: boolean,
  missing: string[],
): { steer: boolean; missing: string[] } {
  const hasEventType = String(args.eventTypeId ?? "").trim() !== "";
  const hasStart = String(args.startTime ?? args.start ?? "").trim() !== "";
  if (!hasEventType || !hasStart) return { steer: true, missing };

  const providedName = String(args.name ?? "").trim();
  if (requiresName && !looksLikeRealName(providedName) && !missing.includes("name")) {
    return { steer: false, missing: [...missing, "name"] };
  }
  return { steer: false, missing };
}

export function gateToolInput(
  toolKey: string,
  args: Record<string, unknown>,
  registry: ToolRegistry,
): GateDecision {
  // Built-in tools declare complete schemas and take no customer-supplied
  // identifiers — nothing to collect.
  if (registry.builtinNames.has(toolKey)) return { kind: "ready" };

  const schema = registry.schemaByKey.get(toolKey);
  let missing = missingCustomerFields(schema, args);

  if (toolKey === "book_meeting") {
    const requiresName = registry.guardrailsByKey.get(toolKey)?.requireNamedAttendee !== false;
    const adjusted = bookMeetingAdjustments(args, requiresName, missing);
    if (adjusted.steer) {
      return {
        kind: "steer",
        note: JSON.stringify({
          needsSlot: true,
          note: "No meeting slot is selected yet. Call list_event_types then list_calendar_slots so the customer can pick a slot — do NOT book or claim a booking until they have picked one.",
        }),
      };
    }
    missing = adjusted.missing;
  }

  if (missing.length === 0) return { kind: "ready" };

  // Custom webhooks: once the form is triggered, render the operator's ENTIRE
  // input schema (all required + optional fields), not just the missing-required
  // subset — the operator defined those fields precisely so the AI/customer must
  // supply them all. Built-in-backed tools keep the targeted "just the missing
  // fields" form.
  const isWebhookTool = registry.webhookToolKeys.has(toolKey);
  const block = isWebhookTool
    ? buildFormBlock(toolKey, schema, undefined, undefined, undefined, false)
    : buildFormBlock(toolKey, schema, undefined, missing, args);

  // No renderable fields (a schema we can't turn into a form) — let the call
  // through and surface the provider's own validation error to the model.
  if (!block) return { kind: "ready" };

  return {
    kind: "collect",
    block,
    note: JSON.stringify({
      formShown: true,
      note: `An inline form is now shown to collect the required inputs. STOP and wait for the customer to submit it. Do NOT call ${toolKey} again, claim a result, or ask for these fields in chat.`,
    }),
  };
}
