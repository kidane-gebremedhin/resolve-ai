"use client";

// pre_chat — first-time visitor (or expired session). Shows the agent greeting,
// suggested questions, and a composer.
//
// By default this is conversation-first: we do NOT ask for contact info here —
// the ContactPromptScreen overlay appears AFTER the first AI reply. But when the
// operator sets `requireContactBeforeChat`, we surface an email (and optional
// phone) field up front and block the first message until a valid email is given.

import { useState } from "react";
import type { WidgetAgent, WidgetSettings } from "../lib/api-client";
import { WidgetHeader } from "./WidgetHeader";
import { Composer } from "./Composer";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function PreChatScreen({
  agent,
  settings,
  primaryColor,
  requireContact = false,
  onStart,
  busy,
}: {
  agent: WidgetAgent | null;
  settings: WidgetSettings;
  primaryColor: string;
  /** When true, require a valid email before the first message can be sent. */
  requireContact?: boolean;
  /** Called when the user submits their first message. */
  onStart: (args: {
    content: string;
    email?: string;
    phone?: string;
  }) => Promise<void> | void;
  busy: boolean;
}) {
  const title = settings?.title ?? "How can we help?";
  const subtitle =
    settings?.subtitle ?? "Send us a message and we&apos;ll get back to you fast.";
  const suggested = settings?.suggestedQuestions ?? agent?.suggestedQuestions ?? [];
  const welcome = settings?.welcomeMessage ?? agent?.welcomeMessage;

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const contactOk = !requireContact || isValidEmail(email.trim());

  async function handleSend(content: string) {
    // When contact is required we forward email/phone so WidgetRoot captures
    // them before the conversation starts; otherwise they stay empty and the
    // post-reply ContactPromptScreen handles capture.
    if (requireContact) {
      if (!contactOk) return;
      await onStart({ content, email: email.trim(), phone: phone.trim() || undefined });
    } else {
      await onStart({ content });
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-neutral-900">
      <WidgetHeader agent={agent} primaryColor={primaryColor} />
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
          <p
            className="mt-1 text-xs text-neutral-500 dark:text-neutral-400"
            dangerouslySetInnerHTML={{ __html: subtitle }}
          />
        </div>

        {welcome ? (
          <div className="rounded-2xl bg-neutral-100 px-3 py-2 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
            {welcome}
          </div>
        ) : null}

        {requireContact ? (
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              Your details
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-neutral-500"
              disabled={busy}
            />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone (optional)"
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-neutral-500"
              disabled={busy}
            />
            {!contactOk && email.length > 0 ? (
              <p className="text-[11px] text-red-500 dark:text-red-400">
                Enter a valid email to start the chat.
              </p>
            ) : null}
          </div>
        ) : null}

        {suggested.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Suggested</p>
            <div className="flex flex-col gap-1.5">
              {suggested.slice(0, 4).map((q) => (
                <button
                  key={q}
                  type="button"
                  className="rounded-xl border border-neutral-200 px-3 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  onClick={() => handleSend(q)}
                  disabled={busy || !contactOk}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <Composer onSend={handleSend} primaryColor={primaryColor} disabled={busy || !contactOk} />
    </div>
  );
}
