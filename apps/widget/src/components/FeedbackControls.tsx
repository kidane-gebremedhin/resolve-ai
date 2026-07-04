"use client";

import { useState } from "react";
import { submitFeedback, type FeedbackRating } from "../lib/api-client";

export function FeedbackControls({
  messageId,
  sessionToken,
  onExpand,
}: {
  messageId: string;
  sessionToken?: string;
  /** Called when the feedback reason box opens so the parent can re-scroll. */
  onExpand?: () => void;
}) {
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (!sessionToken) return null;

  const handleVote = async (r: FeedbackRating) => {
    if (submitted) return;
    setRating(r);
    if (r === "up") {
      await submitFeedback(sessionToken, messageId, r).catch(() => null);
      setSubmitted(true);
    } else {
      setShowReason(true);
      // Notify parent so it can scroll the list to keep this box visible.
      setTimeout(() => onExpand?.(), 50);
    }
  };

  const handleSubmitReason = async () => {
    if (!rating || submitted) return;
    await submitFeedback(sessionToken, messageId, rating, reason || undefined).catch(() => null);
    setSubmitted(true);
    setShowReason(false);
  };

  if (submitted) {
    return (
      <span className="ml-1 text-[10px] text-neutral-400 dark:text-neutral-500">Thanks!</span>
    );
  }

  return (
    <div className="ml-1 mt-0.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Helpful"
          onClick={() => void handleVote("up")}
          className={`rounded p-0.5 transition hover:text-green-600 ${rating === "up" ? "text-green-600" : "text-neutral-400 dark:text-neutral-500"}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
            <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Not helpful"
          onClick={() => void handleVote("down")}
          className={`rounded p-0.5 transition hover:text-red-500 ${rating === "down" ? "text-red-500" : "text-neutral-400 dark:text-neutral-500"}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" />
            <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
          </svg>
        </button>
      </div>
      {showReason ? (
        <div className="mt-1.5 flex flex-col gap-1">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What went wrong? (optional)"
            rows={2}
            className="w-full resize-none rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-[11px] text-neutral-700 placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:placeholder-neutral-500"
          />
          <button
            type="button"
            onClick={() => void handleSubmitReason()}
            className="self-end rounded-md bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
          >
            Send
          </button>
        </div>
      ) : null}
    </div>
  );
}
