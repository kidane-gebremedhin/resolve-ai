"use client";

// SuggestedQuestions — a compact, horizontally-scrollable strip of quick-reply
// chips shown inside the Chat tab, just above the composer. Shown only before the
// visitor's first message to seed the conversation (clicking one sends it); the
// parent hides the strip once they've sent. This is separate from Sections.

export function SuggestedQuestions({
  questions,
  onSend,
  disabled = false,
}: {
  questions: string[];
  onSend: (content: string) => Promise<void> | void;
  disabled?: boolean;
}) {
  if (!questions || questions.length === 0) return null;
  return (
    <div className="shrink-0 px-3 pb-1.5 pt-0.5">
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {questions.map((q, i) => (
          <button
            key={`${i}-${q}`}
            type="button"
            onClick={() => onSend(q)}
            disabled={disabled}
            title={q}
            className="shrink-0 rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
          >
            <span className="whitespace-nowrap">{q}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
