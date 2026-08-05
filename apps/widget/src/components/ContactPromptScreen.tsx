"use client";

// ContactPromptScreen — inline overlay that appears on top of chat_active once
// the first AI reply lands and we still don't have an email. Email is the
// canonical contact channel; phone is optional. Per spec 09 this overlay is
// blocking: there is no skip — the customer provides an email/phone and presses
// "Continue" to proceed.

import { useState } from "react";
import { isValidPhoneNumber } from "react-phone-number-input";
import { PhoneField } from "./PhoneField";

export function ContactPromptScreen({
  primaryColor,
  initialEmail,
  initialPhone,
  defaultCountry,
  onSave,
}: {
  primaryColor: string;
  initialEmail?: string;
  initialPhone?: string;
  /** ISO country (geo-detected) used to default the phone field. */
  defaultCountry?: string;
  onSave: (args: { email?: string; phone?: string }) => Promise<void> | void;
}) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function isValidEmail(value: string): boolean {
    // Cheap RFC-ish check — the server is the source of truth, this is just to
    // catch obvious typos before a round-trip.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async function handleSave() {
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedEmail && !trimmedPhone) {
      setError("Enter an email or phone so we can reach you.");
      return;
    }
    if (trimmedEmail && !isValidEmail(trimmedEmail)) {
      setError("That email doesn't look right.");
      return;
    }
    if (trimmedPhone && !isValidPhoneNumber(trimmedPhone)) {
      setError("That phone number doesn't look valid.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSave({
        email: trimmedEmail ? trimmedEmail : undefined,
        phone: trimmedPhone ? trimmedPhone : undefined,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Leave your contact info"
      // Absolute over the chat area; the parent positions it inside the widget
      // container (not the page). The blur lets the conversation peek through
      // so the customer doesn't feel teleported.
      className="absolute inset-0 z-10 flex items-end justify-center bg-black/30 backdrop-blur-sm sm:items-center"
    >
      <div className="w-full rounded-t-2xl bg-white p-4 shadow-xl sm:m-4 sm:rounded-2xl dark:bg-neutral-900">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          How can we reach you?
        </h3>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Add an email or phone to continue — we&apos;ll use it to follow up on this
          conversation.
        </p>

        <div className="mt-3 space-y-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-neutral-500"
            disabled={busy}
            autoFocus
          />
          <PhoneField
            // Re-mount when the detected country lands so the underlying input
            // adopts it (defaultCountry is only read on first render). `phone`
            // lives here in the parent, so the entered value survives the swap.
            key={defaultCountry ?? "intl"}
            value={phone}
            onChange={setPhone}
            defaultCountry={defaultCountry}
            disabled={busy}
          />
        </div>

        {error ? (
          <p className="mt-2 text-xs text-red-500 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy}
            className="flex-1 rounded-full px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            style={{ background: primaryColor }}
          >
            {busy ? "Saving…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
