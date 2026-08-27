// Org-level conversation controls, and the defense-in-depth enforcement applied
// to whatever action the model chose. Used by the reply graph — the prompt
// asks for the right behaviour, this makes it true regardless.

import type { ConversationControls } from "../prompts.js";

export type ReplyAction = "reply" | "escalate" | "resolve";

// Org-level conversation controls (escalation toggle, ask-before-resolve) live
// in the freeform Organization.settings.conversation block. Human escalation is
// OFF by default (must be explicitly enabled); confirm-before-resolve stays on.
export function readConversationControls(org: { settings?: unknown } | null): ConversationControls {
  const c =
    (org?.settings && typeof org.settings === "object"
      ? (org.settings as Record<string, unknown>).conversation
      : undefined) as Record<string, unknown> | undefined;
  return {
    allowHumanEscalation: c?.allowHumanEscalation === true,
    requireResolveConfirmation: c?.requireResolveConfirmation !== false,
  };
}

// Lightweight affirmation check used to gate AI-driven resolution when
// ask-before-resolve is on: the resolve only goes through if the customer's
// latest message reads as a confirmation.
const AFFIRMATION_RE =
  /\b(yes|yep|yeah|yup|sure|ok|okay|correct|confirmed?|please do|go ahead|that('s| is)? (right|correct)|(it|that) (worked|works|helped|fixed|solved)|all good|sounds good|perfect|great|thanks|thank you|done)\b/i;
export function isAffirmation(text: string): boolean {
  return AFFIRMATION_RE.test(text.trim());
}

/**
 * Enforce org conversation controls on the model's chosen action.
 *
 * Escalation: never hand off when disabled. Resolution: a strict TWO-STEP
 * confirmation when ask-before-resolve is on — the AI must first ask ("shall I
 * close this?") and only resolve after the visitor affirmatively replies on the
 * NEXT turn. This stops it auto-resolving on pleasantries.
 */
export function applyConversationControls(args: {
  action: ReplyAction;
  replyText: string;
  customerMessage: string;
  controls: ConversationControls;
  /** Whether the PREVIOUS turn already asked "shall I close this?". */
  wasPendingResolve: boolean;
}): { action: ReplyAction; replyText: string; pendingResolve: boolean } {
  let action = args.action;
  let replyText = args.replyText;

  if (action === "escalate" && !args.controls.allowHumanEscalation) {
    action = "reply";
  }

  let pendingResolve = args.wasPendingResolve;
  if (args.controls.requireResolveConfirmation) {
    if (action === "resolve") {
      if (args.wasPendingResolve && isAffirmation(args.customerMessage)) {
        // Visitor confirmed on the turn after we asked → resolve for real.
        pendingResolve = false;
      } else {
        // First resolve attempt (or not-yet-confirmed): ask instead of resolving.
        action = "reply";
        pendingResolve = true;
        if (!replyText.includes("?")) {
          replyText =
            replyText.replace(/[.!\s]+$/, "") + " — shall I close this conversation now?";
        }
      }
    } else {
      // Conversation moved on without resolving — drop any pending confirmation.
      pendingResolve = false;
    }
  }

  return { action, replyText, pendingResolve };
}
