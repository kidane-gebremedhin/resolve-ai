"use client";

import { useState } from "react";
import { submitCsat } from "../lib/api-client";

export function CSATCard({
  conversationId,
  sessionToken,
}: {
  conversationId: string;
  sessionToken?: string;
}) {
  const [stars, setStars] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!sessionToken) return null;

  const handleSubmit = async () => {
    if (!stars || submitting) return;
    setSubmitting(true);
    try {
      await submitCsat(sessionToken, conversationId, stars, comment || undefined);
      setSubmitted(true);
    } catch {
      // silently fail — CSAT is best-effort
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="mx-4 mb-3 rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3 text-center dark:border-neutral-800 dark:bg-neutral-800/50">
        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">Thanks for your feedback!</p>
      </div>
    );
  }

  return (
    <div className="mx-4 mb-3 rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-800/50">
      <p className="mb-2 text-center text-sm font-medium text-neutral-700 dark:text-neutral-200">
        How would you rate this conversation?
      </p>
      <div
        className="mb-2.5 flex justify-center gap-1.5"
        onMouseLeave={() => setHovered(null)}
      >
        {([1, 2, 3, 4, 5] as const).map((n) => {
          const filled = (hovered ?? stars ?? 0) >= n;
          return (
            <button
              key={n}
              type="button"
              aria-label={`${n} star${n !== 1 ? "s" : ""}`}
              onMouseEnter={() => setHovered(n)}
              onClick={() => setStars(n)}
              className="transition-transform hover:scale-110 active:scale-95"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill={filled ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={filled ? "text-amber-400" : "text-neutral-300 dark:text-neutral-600"}
                aria-hidden
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>
          );
        })}
      </div>
      {stars !== null ? (
        <>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Any additional feedback? (optional)"
            rows={2}
            className="mb-2 w-full resize-none rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-700 placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-300 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:placeholder-neutral-500"
          />
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleSubmit()}
            className="w-full rounded-lg bg-neutral-900 py-1.5 text-xs font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
          >
            {submitting ? "Submitting…" : "Submit"}
          </button>
        </>
      ) : null}
    </div>
  );
}
