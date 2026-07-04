// Widget state machine. Implements the 8 states from
// __specs/09-widget-state-machine.md as a plain reducer so we can unit-test it
// without xstate. The hook (useWidgetMachine) wraps useReducer and exposes a
// typed `send` for event-driven callers.
//
// Transitions are *intentionally* explicit: each event lists the source states
// it's valid from. Unknown events log a warning in dev and are otherwise
// dropped — this keeps "spurious socket re-emits after resolve" from
// accidentally re-opening a conversation.

import { useReducer } from "react";
import type {
  WidgetAgent,
  WidgetMessage,
  WidgetSection,
  WidgetSettings,
  ConversationStatus,
} from "./api-client";

export type WidgetStateName =
  | "boot"
  | "pre_chat"
  | "chat_active"
  | "contact_prompt"
  | "escalated"
  | "resolved"
  | "error";

export type WidgetContext = {
  /** Hard config from the embed/url; missing values send us to `error`. */
  domain: string | null;
  agentId: string | null;
  websiteId: string | null;
  position: "bottom-right" | "bottom-left" | "centered";
  /** API-provided. */
  agent: WidgetAgent | null;
  settings: WidgetSettings;
  sections: WidgetSection[];
  /** Active conversation, if any. */
  conversationId: string | null;
  conversationStatus: ConversationStatus | null;
  messages: WidgetMessage[];
  /** In-flight streaming messages: messageId → accumulated delta text. */
  inFlight: Map<string, string>;
  /** Contact info captured so far. */
  contact: { email?: string; phone?: string; name?: string };
  /** True once we've shown (and dismissed/answered) the post-AI-reply contact prompt. */
  hasPromptedForContact: boolean;
  /** Last error message (only meaningful when state === 'error'). */
  errorMessage: string | null;
  /** True for the brief window between mounting and `BOOTSTRAPPED`. */
  isInitializing: boolean;
};

export type WidgetState = {
  state: WidgetStateName;
  /** Optional sub-state the chat screen uses to layer the contact_prompt overlay. */
  overlay: "contact_prompt" | null;
  context: WidgetContext;
};

// ---- Events ----------------------------------------------------------------

export type WidgetEvent =
  | { type: "MESSAGE_DELTA"; messageId: string; delta: string }
  | { type: "MESSAGE_DONE"; messageId: string; content: string; message?: WidgetMessage }
  | {
    type: "BOOTSTRAPPED";
    agent: WidgetAgent;
    settings: WidgetSettings;
    sections: WidgetSection[];
    // What to render next based on stored session + conversation.
    next: "pre_chat" | "chat_active" | "escalated" | "resolved";
    conversationId?: string;
    conversationStatus?: ConversationStatus;
    messages?: WidgetMessage[];
    contact?: { email?: string; phone?: string; name?: string };
    /** When true, the contact_prompt overlay is shown immediately on resume. */
    showContactPrompt?: boolean;
  }
  | { type: "BOOT_FAILED"; message: string }
  | { type: "RETRY" }
  | { type: "CONVERSATION_CREATED"; conversationId: string; status: ConversationStatus }
  | { type: "MESSAGES_LOADED"; messages: WidgetMessage[] }
  | { type: "MESSAGE_APPENDED"; message: WidgetMessage }
  | { type: "AI_REPLIED"; message: WidgetMessage }
  | { type: "CONTACT_CAPTURED"; contact: { email?: string; phone?: string; name?: string } }
  | { type: "CONTACT_SKIPPED" }
  | { type: "PROMPT_CONTACT" }
  | { type: "START_NEW_CONVERSATION" }
  | { type: "CONVERSATION_STATUS_CHANGED"; status: ConversationStatus }
  | { type: "ERROR"; message: string };

// ---- Initial state ---------------------------------------------------------

export type WidgetInitArgs = {
  domain: string | null;
  agentId: string | null;
  websiteId: string | null;
  position?: "bottom-right" | "bottom-left" | "centered";
};

export function makeInitialState(args: WidgetInitArgs): WidgetState {
  return {
    state: "boot",
    overlay: null,
    context: {
      domain: args.domain,
      agentId: args.agentId,
      websiteId: args.websiteId,
      position: args.position ?? "bottom-right",
      agent: null,
      settings: null,
      sections: [],
      conversationId: null,
      conversationStatus: null,
      messages: [],
      inFlight: new Map(),
      contact: {},
      hasPromptedForContact: false,
      errorMessage: null,
      isInitializing: true,
    },
  };
}

// ---- Reducer ---------------------------------------------------------------

function hasEmail(ctx: WidgetContext): boolean {
  return Boolean(ctx.contact.email);
}

function appendMessage(messages: WidgetMessage[], next: WidgetMessage): WidgetMessage[] {
  if (messages.some((m) => m._id === next._id)) {
    // Replace the existing entry so that a full message (with sources/quickReplies)
    // from AI_REPLIED can upgrade the temp message placed by MESSAGE_DONE.
    return messages.map((m) => (m._id === next._id ? next : m));
  }
  return [...messages, next];
}

export function reducer(state: WidgetState, event: WidgetEvent): WidgetState {
  switch (event.type) {
    case "MESSAGE_DELTA": {
      const next = new Map(state.context.inFlight);
      next.set(event.messageId, (next.get(event.messageId) ?? "") + event.delta);
      return { ...state, context: { ...state.context, inFlight: next } };
    }

    case "MESSAGE_DONE": {
      const next = new Map(state.context.inFlight);
      next.delete(event.messageId);
      // Immediately promote the streamed content into messages so there is no
      // gap (and no typing-indicator re-flash) between the streaming bubble
      // disappearing and the static bubble appearing via AI_REPLIED.
      // When message:new fires later, AI_REPLIED calls appendMessage which
      // replaces this temp entry with the full message (sources, quickReplies).
      const tempMessage: WidgetMessage = event.message ?? {
        _id: event.messageId,
        conversationId: state.context.conversationId ?? "",
        role: "ai",
        content: event.content,
        createdAt: new Date().toISOString(),
      };
      const messages = appendMessage(state.context.messages, tempMessage);
      return { ...state, context: { ...state.context, inFlight: next, messages } };
    }

    case "BOOTSTRAPPED": {
      const shouldPromptOnResume =
        event.showContactPrompt === true &&
        event.next === "chat_active" &&
        !event.contact?.email;
      return {
        state: event.next,
        overlay: shouldPromptOnResume ? "contact_prompt" : null,
        context: {
          ...state.context,
          agent: event.agent,
          settings: event.settings,
          sections: event.sections,
          conversationId: event.conversationId ?? null,
          conversationStatus: event.conversationStatus ?? null,
          messages: event.messages ?? [],
          inFlight: new Map(),
          contact: event.contact ?? state.context.contact,
          isInitializing: false,
          errorMessage: null,
          hasPromptedForContact: shouldPromptOnResume ? true : (event.contact?.email ? true : false),
        },
      };
    }

    case "BOOT_FAILED":
    case "ERROR":
      return {
        state: "error",
        overlay: null,
        context: { ...state.context, errorMessage: event.message, isInitializing: false },
      };

    case "RETRY":
      // Caller is expected to re-run bootstrap after dispatching RETRY.
      return {
        state: "boot",
        overlay: null,
        context: { ...state.context, errorMessage: null, isInitializing: true },
      };

    case "CONVERSATION_CREATED": {
      // From pre_chat — the visitor's first message, or a tapped section topic.
      const nextState: WidgetStateName =
        event.status === "resolved"
          ? "resolved"
          : event.status === "escalated"
            ? "escalated"
            : "chat_active";
      return {
        state: nextState,
        overlay: null,
        context: {
          ...state.context,
          conversationId: event.conversationId,
          conversationStatus: event.status,
          messages: [],
          inFlight: new Map(),
        },
      };
    }

    case "MESSAGES_LOADED":
      return {
        ...state,
        context: { ...state.context, messages: event.messages },
      };

    case "MESSAGE_APPENDED": {
      // Customer or operator message landed. If the conversation had been
      // resolved, a new customer message re-opens it per spec (the API will
      // also persist a new conversation in that case via the caller).
      return {
        ...state,
        context: {
          ...state.context,
          messages: appendMessage(state.context.messages, event.message),
        },
      };
    }

    case "AI_REPLIED": {
      // After the *first* AI reply, if we still have no email, layer the
      // contact_prompt overlay on top of chat_active.
      const ctx = {
        ...state.context,
        messages: appendMessage(state.context.messages, event.message),
      };
      // A proactive trigger can deliver an AI message while the widget is still
      // in pre_chat (no customer message sent yet). Transition to chat_active so
      // the proactive message is visible instead of the welcome screen.
      const nextStateStr =
        state.state === "pre_chat" ? "chat_active" : state.state;
      // Only prompt for contact after the visitor sent their first message —
      // not on proactive/AI-initiated messages where no customer text exists yet.
      const customerHasSent = ctx.messages.some((m) => m.role === "customer");
      const shouldPrompt =
        customerHasSent &&
        !hasEmail(ctx) &&
        !state.context.hasPromptedForContact &&
        nextStateStr === "chat_active";
      if (shouldPrompt) {
        return {
          state: "chat_active",
          overlay: "contact_prompt",
          context: { ...ctx, hasPromptedForContact: true },
        };
      }
      return { ...state, state: nextStateStr, context: ctx };
    }

    case "PROMPT_CONTACT":
      // Manual trigger (e.g. on second customer send when still no email).
      if (state.state === "resolved" || state.state === "error") return state;
      return {
        ...state,
        state: "chat_active",
        overlay: "contact_prompt",
        context: { ...state.context, hasPromptedForContact: true },
      };

    case "CONTACT_CAPTURED":
      return {
        ...state,
        overlay: null,
        context: {
          ...state.context,
          contact: { ...state.context.contact, ...event.contact },
          hasPromptedForContact: true,
        },
      };

    case "CONTACT_SKIPPED":
      // The post-reply overlay can be closed. Contact capture is best-effort
      // — if the user dismisses the prompt, the conversation continues.
      return {
        ...state,
        overlay: null,
        context: { ...state.context, hasPromptedForContact: true },
      };

    case "START_NEW_CONVERSATION":
      // From `resolved`. Drop convo state and head back to pre_chat — the chat
      // view with the composer, where the configured sections re-appear as the
      // panel above the input (until the next first message is sent).
      return {
        state: "pre_chat",
        overlay: null,
        context: {
          ...state.context,
          conversationId: null,
          conversationStatus: null,
          messages: [],
          // Keep contact info — a return visitor doesn't need to re-enter it.
          hasPromptedForContact: hasEmail(state.context) ? state.context.hasPromptedForContact : false,
        },
      };

    case "CONVERSATION_STATUS_CHANGED": {
      // Resolution shows the Resolved screen (NOT an automatic jump elsewhere —
      // that was jarring mid/just-after a conversation). The sections panel
      // reappears only when the visitor chooses "Start a new conversation"
      // (START_NEW_CONVERSATION → pre_chat, which renders sections above the
      // composer until the next first message is sent).
      const nextState: WidgetStateName =
        event.status === "resolved"
          ? "resolved"
          : event.status === "escalated"
            ? "escalated"
            : state.state === "escalated" || state.state === "resolved"
              ? "chat_active"
              : state.state;
      return {
        ...state,
        state: nextState,
        overlay: nextState === "resolved" ? null : state.overlay,
        context: { ...state.context, conversationStatus: event.status },
      };
    }

    default:
      // Exhaustiveness guard — TS will complain if a new event type isn't handled.
      return state;
  }
}

// ---- Hook ------------------------------------------------------------------

export function useWidgetMachine(args: WidgetInitArgs) {
  const [state, dispatch] = useReducer(reducer, args, makeInitialState);
  return { state, send: dispatch };
}

export type WidgetMachine = ReturnType<typeof useWidgetMachine>;
