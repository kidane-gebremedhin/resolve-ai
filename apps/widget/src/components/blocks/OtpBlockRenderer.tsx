"use client";

import { useState } from "react";
import { API_URL } from "../../lib/api-client";

export type OtpBlockData = {
  type: "otp";
  otpToken: string;
  toolKey: string;
  args: Record<string, unknown>;
  message?: string;
};

// Inline identity-verification challenge for a high-stakes tool (e.g. a subscription
// change). The customer enters the 6-digit code emailed to their account address; on
// success we re-run the ORIGINAL tool (toolKey + args) — which now passes the OTP gate
// because verifying the code set `identityVerifiedUntil` on the session.
// Pull a human-readable error string out of a failed JSON response. Handles both the
// flat `{ error: "…" }` shape and the API error-handler's nested
// `{ error: { code, message } }` shape — without this the real reason (e.g. a provider
// error from a form/OTP submission) was hidden behind a generic message.
async function readError(res: Response): Promise<string | null> {
  try {
    const d = (await res.json()) as { error?: string | { message?: string } };
    if (typeof d?.error === "string") return d.error;
    if (d?.error && typeof d.error === "object" && typeof d.error.message === "string") return d.error.message;
    return null;
  } catch {
    return null;
  }
}

export function OtpBlockRenderer({
  block,
  primaryColor,
  conversationId,
  sessionToken,
  onSendMessage,
}: {
  block: OtpBlockData;
  primaryColor?: string;
  conversationId?: string;
  sessionToken?: string;
  onSendMessage?: (text: string) => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const otp = code.trim();
    if (!/^\d{6}$/.test(otp)) {
      setError("Enter the 6-digit code.");
      return;
    }
    if (!conversationId || !sessionToken) {
      // No direct API context — fall back to sending the code as a chat message.
      onSendMessage?.(otp);
      setDone(true);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      // 1) Verify the code — sets identityVerifiedUntil on the session (15 min).
      const verifyRes = await fetch(`${API_URL}/widget/verify-otp`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-session-token": sessionToken },
        body: JSON.stringify({ token: block.otpToken, otp }),
      });
      if (!verifyRes.ok) {
        const msg = await readError(verifyRes);
        setError(msg ?? "That code is invalid or expired. Please try again.");
        setSubmitting(false);
        return;
      }
      // 2) Re-run the original tool now that identity is verified. This reuses the
      //    message route's toolKey/formPayload path — the tool runs ONCE and the AI
      //    presents the result over the socket.
      const runRes = await fetch(`${API_URL}/widget/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-session-token": sessionToken },
        body: JSON.stringify({
          content: "I've entered my verification code — please go ahead.",
          toolKey: block.toolKey,
          formPayload: block.args ?? {},
        }),
      });
      if (!runRes.ok) {
        const msg = await readError(runRes);
        setError(msg ?? "Verified, but the action couldn't be completed. Please try again.");
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Couldn't reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
        ✓ Verified — processing your request.
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-xs rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
    >
      <p className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        Verify it's you
      </p>
      <p className="mb-3 text-xs text-neutral-600 dark:text-neutral-400">
        {block.message ?? "Enter the 6-digit code we emailed you."}
      </p>
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => {
          setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
          if (error) setError("");
        }}
        placeholder="123456"
        className="w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-center text-lg tracking-[0.4em] text-neutral-900 focus:outline-none focus:ring-1 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
      />
      {error ? <p className="mt-1 text-[11px] text-red-500">{error}</p> : null}
      <button
        type="submit"
        disabled={submitting}
        className="mt-3 w-full rounded-lg py-2 text-xs font-medium text-white transition disabled:opacity-50"
        style={{ background: primaryColor ?? "#1e40af" }}
      >
        {submitting ? "Verifying…" : "Verify"}
      </button>
    </form>
  );
}
