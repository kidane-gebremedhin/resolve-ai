"use client";

import { useState } from "react";

export function QuickReplies({
  replies,
  onSend,
}: {
  replies: string[];
  onSend: (text: string) => void;
}) {
  const [used, setUsed] = useState(false);

  if (used || !replies || replies.length === 0) return null;

  return (
    <div className="mt-1.5 ml-1 flex flex-wrap gap-1.5">
      {replies.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => {
            setUsed(true);
            onSend(r);
          }}
          className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[12px] font-medium text-neutral-700 transition hover:border-neutral-400 hover:bg-neutral-50 active:scale-95 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:border-neutral-500 dark:hover:bg-neutral-700"
        >
          {r}
        </button>
      ))}
    </div>
  );
}
