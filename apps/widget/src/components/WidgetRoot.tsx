"use client";

// WidgetRoot — top-level orchestrator for the widget.
//
// Responsibilities:
//   1. Bootstrap the session: read URL params + localStorage, mint a new
//      session via initWidget when none exists, fan the result into the state
//      machine via BOOTSTRAPPED.
//   2. Open a Socket.io connection authed by the session token. Translate
//      `message:new` and `conversation:updated` events into machine events.
//   3. Periodically poke the API to keep the session's sliding-window expiry
//      alive while the widget is open.
//   4. Switch on machine.state to render the right screen.
//
// This file is the only place that knows about both the API and the machine
// — every screen below is presentational.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  API_URL,
  createConversation,
  getSettings,
  initWidget,
  listMessages,
  sendMessage,
  updateContact,
  uploadAttachment,
  type ConversationStatus,
  type WidgetMessage,
  type WidgetSection,
} from "../lib/api-client";
import {
  clearSession,
  extendIfExpiringSoon,
  readSession,
  updateSession,
  writeSession,
} from "../lib/session";
import { useWidgetMachine } from "../lib/state-machine";
import { playNotification } from "../lib/audio";
import { BootScreen } from "./BootScreen";
import { ErrorScreen } from "./ErrorScreen";
import { PreChatScreen } from "./PreChatScreen";
import { SectionsScreen } from "./SectionsScreen";
import { ChatScreen } from "./ChatScreen";
import { ContactPromptScreen } from "./ContactPromptScreen";
import { ResolvedScreen } from "./ResolvedScreen";

const DEFAULT_PRIMARY = "#7c3aed"; // violet-600 — matches BootScreen fallback.

// Derive the socket origin from the API URL so we don't need a separate env
// var. NEXT_PUBLIC_SOCKET_URL still wins if explicitly set.
const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ??
  (() => {
    try {
      return new URL(API_URL).origin;
    } catch {
      return "http://localhost:4000";
    }
  })();

export type WidgetRootProps = {
  domain: string;
  agentId?: string;
  websiteId?: string;
  /** Initial theme hint from the embed tag; the saved setting wins once loaded. */
  theme?: "light" | "dark" | "auto";
  position?: "bottom-right" | "bottom-left" | "centered";
  primaryColor?: string;
};

export function WidgetRoot({
  domain,
  agentId,
  websiteId,
  theme: themeProp,
  position: positionProp = "bottom-right",
  primaryColor: primaryColorProp,
}: WidgetRootProps) {
  const { state, send } = useWidgetMachine({
    domain,
    agentId: agentId ?? null,
    websiteId: websiteId ?? null,
    position: positionProp,
  });

  // ---- Theme ------------------------------------------------------------
  // Saved setting (from /widget/init) wins over the embed-tag hint. `auto`
  // follows the host's prefers-color-scheme, watched live so OS theme flips
  // re-render the widget. The resolved `dark` class drives all dark: variants.
  const themeSetting = state.context.settings?.theme ?? themeProp ?? "light";
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    if (themeSetting !== "auto" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [themeSetting]);
  const isDark =
    themeSetting === "dark" || (themeSetting === "auto" && systemDark);

  // Saved position wins over the embed-tag hint; used for the floating offset.
  const position = state.context.settings?.position ?? positionProp;
  // Whether the operator requires contact details before the first message.
  const requireContact =
    state.context.settings?.requireContactBeforeChat === true;
  // Footer attribution unless the operator turned it off (default on).
  const showBranding = state.context.settings?.showBranding !== false;

  // Session token lives in a ref so callbacks don't need to re-bind every
  // re-render. Source of truth is still localStorage via readSession().
  const sessionTokenRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [busy, setBusy] = useState(false);
  // We track the conversation id locally so socket callbacks can match it
  // without going through machine state (state.context.conversationId is the
  // authoritative source, but reading from a ref inside a stable callback is
  // cheaper than re-binding the handler on every state tick).
  const conversationIdRef = useRef<string | null>(null);
  useEffect(() => {
    conversationIdRef.current = state.context.conversationId;
  }, [state.context.conversationId]);

  // ---- AI typing indicator --------------------------------------------
  // Local UI state: shown between a customer send and the AI's reply landing.
  // Kept out of the state machine so the (unit-tested) reducer stays focused on
  // conversation lifecycle, not transient UI.
  const [aiTyping, setAiTyping] = useState(false);
  const aiTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationStatusRef = useRef<ConversationStatus | null>(null);
  useEffect(() => {
    conversationStatusRef.current = state.context.conversationStatus;
  }, [state.context.conversationStatus]);

  const stopAiTyping = useCallback(() => {
    if (aiTypingTimerRef.current) {
      clearTimeout(aiTypingTimerRef.current);
      aiTypingTimerRef.current = null;
    }
    setAiTyping(false);
  }, []);

  const startAiTyping = useCallback(() => {
    // No AI auto-reply once a human is handling it (escalated) or it's closed.
    if (
      conversationStatusRef.current === "escalated" ||
      conversationStatusRef.current === "resolved"
    ) {
      return;
    }
    setAiTyping(true);
    if (aiTypingTimerRef.current) clearTimeout(aiTypingTimerRef.current);
    // Safety net: the API now always emits a reply, but if the socket event is
    // missed the indicator shouldn't hang forever.
    aiTypingTimerRef.current = setTimeout(() => setAiTyping(false), 45_000);
  }, []);

  // Clear the indicator as soon as a non-customer message (AI or operator)
  // lands at the tail of the transcript.
  useEffect(() => {
    const msgs = state.context.messages;
    const last = msgs[msgs.length - 1];
    if (last && last.role !== "customer") stopAiTyping();
  }, [state.context.messages, stopAiTyping]);

  useEffect(() => () => {
    if (aiTypingTimerRef.current) clearTimeout(aiTypingTimerRef.current);
  }, []);

  // Derive the primary color: prop > settings > default. The bootstrap effect
  // may update settings later, so we recompute on every render.
  const primaryColor =
    primaryColorProp ?? state.context.settings?.primaryColor ?? DEFAULT_PRIMARY;

  // ---- Bootstrap --------------------------------------------------------
  // Runs once on mount and whenever the user dispatches RETRY (state.state
  // returns to "boot" then). We key on state.state === "boot" so retries
  // re-run the same logic.
  useEffect(() => {
    if (state.state !== "boot") return;
    let cancelled = false;

    (async () => {
      try {
        if (!domain) {
          throw new Error("Missing `domain` query param.");
        }

        const stored = readSession();
        // Only resume a stored session if it belongs to the same agent we're
        // booting for. Otherwise (e.g. the dashboard preview switching orgs, or
        // a different embed) mint a fresh session so we don't talk to the wrong
        // organization's KB/inbox using a stale token.
        const existing =
          stored && (!agentId || stored.agentId === agentId) ? stored : null;
        let token: string;
        let sessionId: string;
        let bootstrap: Awaited<ReturnType<typeof getSettings>>;
        let resumedEmail: string | undefined;
        let resumedConversationId: string | undefined;

        if (existing) {
          // Resume: keep the token, fetch agent/settings/sections.
          token = existing.token;
          sessionId = existing.id;
          resumedEmail = existing.email;
          resumedConversationId = existing.conversationId;
          bootstrap = await getSettings(token);
        } else {
          // Mint a new session.
          const fresh = await initWidget({
            domain,
            agentId,
            metadata: websiteId ? { websiteId } : undefined,
          });
          token = fresh.sessionToken;
          sessionId = fresh.sessionId;
          writeSession({
            id: fresh.sessionId,
            token: fresh.sessionToken,
            expiresAt: fresh.expiresAt,
            agentId,
            websiteId,
          });
          bootstrap = {
            agent: fresh.agent,
            settings: fresh.settings,
            sections: fresh.sections,
          };
        }

        sessionTokenRef.current = token;
        sessionIdRef.current = sessionId;

        // Hydrate prior conversation history if we have one stashed.
        let messages: WidgetMessage[] | undefined;
        let conversationStatus: ConversationStatus | undefined;
        if (resumedConversationId) {
          try {
            const page = await listMessages(token, resumedConversationId);
            messages = page.items;
            // We don't have a dedicated GET /conversations/:id endpoint, so we
            // assume "active" on resume. If the conversation was resolved on
            // the server side we'll learn about it via the socket
            // `conversation:updated` event after we connect.
            conversationStatus = "active";
          } catch {
            // Stale conversationId — clear it and fall back to sections/pre_chat.
            resumedConversationId = undefined;
            updateSession({ conversationId: undefined });
          }
        }

        // Decide the next state per spec 09.
        // - new session            → pre_chat
        // - existing, no convo, has sections → sections
        // - existing, no convo, no sections  → pre_chat
        // - existing, active convo → chat_active
        let next: "pre_chat" | "sections" | "chat_active" | "escalated" | "resolved";
        if (resumedConversationId) {
          next = "chat_active";
        } else if (existing && (bootstrap.sections?.length ?? 0) > 0) {
          next = "sections";
        } else {
          next = "pre_chat";
        }

        if (cancelled) return;

        // WidgetSettings.avatarUrl (operator-set) overrides the agent's own
        // avatar so the studio's avatar choice shows on every screen's header.
        const mergedAgent = {
          ...bootstrap.agent,
          avatarUrl: bootstrap.settings?.avatarUrl || bootstrap.agent.avatarUrl,
        };

        send({
          type: "BOOTSTRAPPED",
          agent: mergedAgent,
          settings: bootstrap.settings,
          sections: bootstrap.sections ?? [],
          next,
          conversationId: resumedConversationId,
          conversationStatus,
          messages,
          contact: resumedEmail ? { email: resumedEmail } : undefined,
        });
      } catch (e) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error("[widget] bootstrap failed", e);
        send({
          type: "BOOT_FAILED",
          message: (e as Error).message ?? "Unable to load chat.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // Deliberately depend only on state.state — domain/agentId/websiteId are
    // expected to be stable for the lifetime of the iframe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.state]);

  // ---- Socket ----------------------------------------------------------
  // Open once we have a session token. The socket connection is independent
  // of the machine state — we want to know about background updates even when
  // the user is on the sections screen.
  useEffect(() => {
    const token = sessionTokenRef.current;
    if (!token) return;
    if (socketRef.current) return; // already connected

    const socket = io(SOCKET_URL, {
      auth: { sessionToken: token, kind: "contact" },
      transports: ["websocket"],
    });
    socketRef.current = socket;

    socket.on("connect_error", (err) => {
      // eslint-disable-next-line no-console
      console.warn("[widget] socket connect error", err.message);
    });

    socket.on(
      "message:new",
      async (payload: { conversationId: string; messageId?: string; message?: WidgetMessage }) => {
        const activeId = conversationIdRef.current;
        if (!activeId || payload.conversationId !== activeId) return;

        // Prefer the full message embedded in the payload (newer server
        // contract); fall back to re-listing if only the id was sent. Either
        // way the reducer dedupes on _id so duplicates are safe.
        let message: WidgetMessage | undefined = payload.message;
        if (!message) {
          try {
            const page = await listMessages(token, activeId, undefined, 10);
            message = page.items[page.items.length - 1];
          } catch {
            return;
          }
        }
        if (!message) return;

        if (message.role === "ai") {
          send({ type: "AI_REPLIED", message });
        } else {
          send({ type: "MESSAGE_APPENDED", message });
        }
        if (message.role !== "customer") {
          playNotification();
        }
      },
    );

    socket.on(
      "conversation:updated",
      (payload: { conversationId: string; status?: ConversationStatus }) => {
        const activeId = conversationIdRef.current;
        if (!activeId || payload.conversationId !== activeId) return;
        if (payload.status) {
          send({ type: "CONVERSATION_STATUS_CHANGED", status: payload.status });
          if (payload.status === "resolved") {
            updateSession({ conversationId: undefined });
          }
        }
      },
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // We intentionally bind once per token. sessionTokenRef.current is read
    // inside the effect, so we trigger by re-checking on every BOOTSTRAPPED.
  }, [state.context.agent, send]);

  // ---- Session refresh -------------------------------------------------
  // Every 5 minutes, if the session is approaching expiry, hit /settings to
  // bump it. The endpoint is cheap and the API extends expiresAt on any
  // authed call.
  useEffect(() => {
    const token = sessionTokenRef.current;
    if (!token) return;
    const interval = setInterval(() => {
      const stored = readSession();
      if (!stored) return;
      void extendIfExpiringSoon(stored, async () => {
        await getSettings(stored.token);
        // /settings doesn't echo expiresAt — we just rely on the API's
        // server-side bump and accept that our local copy stays put until
        // the next bootstrap.
        return;
      });
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [state.context.agent]);

  // ---- Helpers ---------------------------------------------------------

  const ensureConversation = useCallback(
    async (sectionId?: string): Promise<string> => {
      const token = sessionTokenRef.current;
      if (!token) throw new Error("No active session.");
      if (state.context.conversationId) return state.context.conversationId;
      const { conversation } = await createConversation(token, sectionId);
      updateSession({ conversationId: conversation._id });
      send({
        type: "CONVERSATION_CREATED",
        conversationId: conversation._id,
        status: conversation.status,
      });
      return conversation._id;
    },
    [state.context.conversationId, send],
  );

  const sendCustomerMessage = useCallback(
    async (content: string, conversationId: string) => {
      const token = sessionTokenRef.current;
      if (!token) throw new Error("No active session.");
      const { message } = await sendMessage(token, conversationId, content);
      send({ type: "MESSAGE_APPENDED", message });
      // Show the "AI is typing" indicator until the reply lands (or times out).
      startAiTyping();
    },
    [send, startAiTyping],
  );

  // ---- Screen handlers -------------------------------------------------

  const handlePreChatStart = useCallback(
    async (args: { content: string; email?: string; phone?: string }) => {
      setBusy(true);
      try {
        const token = sessionTokenRef.current;
        const sessionId = sessionIdRef.current;
        if (!token || !sessionId) throw new Error("No active session.");

        // Optionally save contact details before kicking off the conversation
        // — best-effort, we don't block the chat if it fails.
        if (args.email || args.phone) {
          try {
            await updateContact(token, sessionId, {
              email: args.email,
              phone: args.phone,
            });
            send({
              type: "CONTACT_CAPTURED",
              contact: { email: args.email, phone: args.phone },
            });
            if (args.email) updateSession({ email: args.email });
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("[widget] updateContact failed (continuing):", (e as Error).message);
          }
        }

        const conversationId = await ensureConversation();
        await sendCustomerMessage(args.content, conversationId);
      } catch (e) {
        send({ type: "ERROR", message: (e as Error).message });
      } finally {
        setBusy(false);
      }
    },
    [ensureConversation, sendCustomerMessage, send],
  );

  const handleSectionSelect = useCallback(
    async (section: WidgetSection) => {
      // Link sections are handled inside SectionCard (window.open). We only
      // see start-chat / topic here.
      setBusy(true);
      try {
        const token = sessionTokenRef.current;
        if (!token) throw new Error("No active session.");
        const { conversation } = await createConversation(token, section._id);
        updateSession({ conversationId: conversation._id });
        send({
          type: "CONVERSATION_CREATED",
          conversationId: conversation._id,
          status: conversation.status,
        });
        // If the section carries a topicPrompt, fire it as the customer's
        // first message so the AI has something to chew on.
        if (section.action === "topic" && section.topicPrompt) {
          await sendCustomerMessage(section.topicPrompt, conversation._id);
        }
      } catch (e) {
        send({ type: "ERROR", message: (e as Error).message });
      } finally {
        setBusy(false);
      }
    },
    [send, sendCustomerMessage],
  );

  const handleStartNew = useCallback(() => {
    updateSession({ conversationId: undefined });
    send({ type: "START_NEW_CONVERSATION" });
  }, [send]);

  const handleChatSend = useCallback(
    async (content: string) => {
      try {
        const conversationId =
          state.context.conversationId ?? (await ensureConversation());
        await sendCustomerMessage(content, conversationId);
      } catch (e) {
        send({ type: "ERROR", message: (e as Error).message });
      }
    },
    [state.context.conversationId, ensureConversation, sendCustomerMessage, send],
  );

  const handleAttach = useCallback(
    async (file: File) => {
      try {
        const token = sessionTokenRef.current;
        const conversationId = state.context.conversationId;
        if (!token || !conversationId) return;
        const { attachment } = await uploadAttachment(token, conversationId, file);
        const { message } = await sendMessage(token, conversationId, file.name, [
          attachment,
        ]);
        send({ type: "MESSAGE_APPENDED", message });
      } catch (e) {
        send({ type: "ERROR", message: (e as Error).message });
      }
    },
    [state.context.conversationId, send],
  );

  const handleContactSave = useCallback(
    async (args: { email?: string; phone?: string }) => {
      const token = sessionTokenRef.current;
      const sessionId = sessionIdRef.current;
      if (!token || !sessionId) throw new Error("No active session.");
      await updateContact(token, sessionId, args);
      send({ type: "CONTACT_CAPTURED", contact: args });
      if (args.email) updateSession({ email: args.email });
    },
    [send],
  );

  const handleRetry = useCallback(() => {
    // RETRY puts us back in `boot`; the bootstrap effect re-runs.
    sessionTokenRef.current = null;
    sessionIdRef.current = null;
    // We *don't* clear the localStorage session on retry — it might be the
    // network that's flaky, not the session itself. Only clear if the API
    // actually rejected the token.
    socketRef.current?.disconnect();
    socketRef.current = null;
    send({ type: "RETRY" });
  }, [send]);

  // ---- Render ----------------------------------------------------------

  // Container styling per spec: floating bottom-right by default, full-screen
  // sheet on phones. The widget itself is a fixed-size card; the page
  // background is transparent (the embed/iframe owns the layout).
  const positionClass = useMemo(() => {
    switch (position) {
      case "bottom-left":
        return "sm:bottom-4 sm:left-4";
      case "centered":
        return "sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2";
      case "bottom-right":
      default:
        return "sm:bottom-4 sm:right-4";
    }
  }, [position]);

  const screen = (() => {
    switch (state.state) {
      case "boot":
        return <BootScreen primaryColor={primaryColor} />;

      case "error":
        return (
          <ErrorScreen
            message={state.context.errorMessage}
            onRetry={handleRetry}
          />
        );

      case "pre_chat":
        return (
          <PreChatScreen
            agent={state.context.agent}
            settings={state.context.settings}
            primaryColor={primaryColor}
            requireContact={requireContact}
            onStart={handlePreChatStart}
            busy={busy}
          />
        );

      case "sections":
        return (
          <SectionsScreen
            agent={state.context.agent}
            settings={state.context.settings}
            sections={state.context.sections}
            primaryColor={primaryColor}
            onSelectSection={handleSectionSelect}
            onStartNew={handleStartNew}
            busy={busy}
          />
        );

      case "chat_active":
      case "escalated":
        return (
          <ChatScreen
            agent={state.context.agent}
            primaryColor={primaryColor}
            messages={state.context.messages}
            escalated={state.state === "escalated"}
            onSend={handleChatSend}
            onAttach={handleAttach}
            composerDisabled={state.overlay === "contact_prompt"}
            aiTyping={aiTyping}
          />
        );

      case "resolved":
        return (
          <ResolvedScreen
            agent={state.context.agent}
            primaryColor={primaryColor}
            messages={state.context.messages}
            onStartNew={handleStartNew}
            busy={busy}
          />
        );

      // contact_prompt is rendered as a top-level state for completeness,
      // but in practice the machine layers it as `overlay` over chat_active.
      // We treat a bare `contact_prompt` state the same as chat_active with
      // the overlay forced on.
      case "contact_prompt":
        return (
          <ChatScreen
            agent={state.context.agent}
            primaryColor={primaryColor}
            messages={state.context.messages}
            escalated={false}
            onSend={handleChatSend}
            onAttach={handleAttach}
            composerDisabled
            aiTyping={aiTyping}
          />
        );

      default: {
        // Exhaustiveness — TS catches this at compile time if a state is added.
        const _exhaustive: never = state.state;
        void _exhaustive;
        return null;
      }
    }
  })();

  return (
    <div
      className={`${isDark ? "dark " : ""}fixed inset-0 z-[2147483000] flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl dark:bg-neutral-900 sm:inset-auto sm:h-[600px] sm:max-h-[80vh] sm:w-[400px] sm:rounded-2xl ${positionClass}`}
      style={{ ["--widget-primary" as string]: primaryColor }}
    >
      {/* Inner relative wrapper so absolute overlays (contact_prompt) anchor
          to the widget bounds rather than the viewport. The active screen fills
          the flex-1 area; the optional branding footer sits beneath it. */}
      <div className="flex h-full w-full flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col">
          {screen}
          {state.overlay === "contact_prompt" &&
          (state.state === "chat_active" || state.state === "escalated") ? (
            <ContactPromptScreen
              primaryColor={primaryColor}
              initialEmail={state.context.contact.email}
              initialPhone={state.context.contact.phone}
              onSave={handleContactSave}
            />
          ) : null}
        </div>
        {showBranding ? <PoweredBy /> : null}
      </div>
    </div>
  );
}

// Thin attribution strip shown at the bottom of the widget unless the operator
// disables it via the showBranding setting.
function PoweredBy() {
  return (
    <div className="shrink-0 border-t border-neutral-100 bg-white py-1.5 text-center dark:border-neutral-800 dark:bg-neutral-900">
      <a
        href="https://helio.chat"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[10px] text-neutral-400 transition hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
      >
        Powered by Helio
      </a>
    </div>
  );
}

// Re-export so app/page.tsx can import a single symbol.
export default WidgetRoot;

// Suppress the "clearSession is imported but only conditionally used" warning
// by referencing it from a no-op exported helper. We expose it so callers
// (e.g. a "log out" debug button) can wipe state during development.
export function _devClearSession(): void {
  clearSession();
}
