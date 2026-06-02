"use client";

// Composer — the bottom input bar used by both pre_chat and chat_active screens.
// Plain textarea (auto-grow capped at 4 rows), an optional paperclip for file
// attach, an emoji picker, and a send button. Enter sends; Shift-Enter inserts
// a newline.

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

// emoji-mart is heavy (~picker UI + data). Load it lazily so it stays out of
// the widget's initial bundle and only downloads when the user opens it.
const EmojiPicker = dynamic(() => import("@emoji-mart/react"), { ssr: false });

type EmojiSelectEvent = { native?: string };

// Cap the auto-grow at ~3 lines (text-sm ≈ 20px line-height + py-2 padding);
// beyond that the textarea scrolls internally.
const MAX_TEXTAREA_HEIGHT = 76;

function autoResize(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
}

export function Composer({
  onSend,
  onAttach,
  primaryColor,
  disabled = false,
  placeholder = "Type a message…",
}: {
  onSend: (content: string) => Promise<void> | void;
  /** Optional — when provided the paperclip button is rendered. */
  onAttach?: (file: File) => Promise<void> | void;
  primaryColor: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  // emoji-mart data is fetched on first open and cached for the session.
  const [emojiData, setEmojiData] = useState<unknown>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const footerRef = useRef<HTMLElement | null>(null);
  // Match the emoji picker (a third-party popover that can't use Tailwind
  // dark: variants) to the widget's resolved theme by reading the .dark class
  // WidgetRoot sets on an ancestor.
  const [pickerDark, setPickerDark] = useState(false);
  useEffect(() => {
    if (showEmoji) setPickerDark(Boolean(footerRef.current?.closest(".dark")));
  }, [showEmoji]);

  const busy = disabled || sending;

  async function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    // Optimistically clear so the textarea is empty while the send is in-flight.
    // If the caller throws we keep the cleared state (caller is expected to
    // surface its own error UI).
    setValue("");
    setShowEmoji(false);
    // Collapse back to a single row now that the field is empty.
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setSending(true);
    try {
      await onSend(trimmed);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so picking the same file twice still fires `change`.
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file || !onAttach) return;
    await onAttach(file);
  }

  async function toggleEmoji() {
    if (busy) return;
    if (!emojiData) {
      // `@emoji-mart/data` is a large JSON payload — import it on demand.
      const mod = await import("@emoji-mart/data");
      setEmojiData((mod as { default: unknown }).default);
    }
    setShowEmoji((s) => !s);
  }

  function insertEmoji(emoji: EmojiSelectEvent) {
    const native = emoji.native ?? "";
    if (!native) return;
    const ta = textareaRef.current;
    if (!ta) {
      setValue((v) => v + native);
      return;
    }
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const next = value.slice(0, start) + native + value.slice(end);
    setValue(next);
    // Restore focus and place the caret right after the inserted emoji so the
    // user can keep typing seamlessly.
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + native.length;
      ta.setSelectionRange(pos, pos);
      autoResize(ta);
    });
  }

  return (
    <footer ref={footerRef} className="relative flex items-end gap-2 border-t border-neutral-100 p-3 dark:border-neutral-800">
      {/* Emoji picker popover + click-away backdrop */}
      {showEmoji ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowEmoji(false)}
            aria-hidden
          />
          <div className="absolute bottom-full left-2 z-50 mb-2">
            {emojiData ? (
              <EmojiPicker
                data={emojiData}
                onEmojiSelect={insertEmoji}
                theme={pickerDark ? "dark" : "light"}
                previewPosition="none"
                skinTonePosition="none"
                navPosition="bottom"
                perLine={8}
                maxFrequentRows={1}
              />
            ) : null}
          </div>
        </>
      ) : null}

      {onAttach ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFile}
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            aria-label="Attach a file"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
        </>
      ) : null}

      <button
        type="button"
        onClick={() => void toggleEmoji()}
        disabled={busy}
        aria-label="Insert emoji"
        aria-expanded={showEmoji}
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-neutral-100 disabled:opacity-50 dark:hover:bg-neutral-800 ${showEmoji ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100" : "text-neutral-500 dark:text-neutral-400"}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="10" />
          <path d="M8 14s1.5 2 4 2 4-2 4-2" />
          <line x1="9" y1="9" x2="9.01" y2="9" />
          <line x1="15" y1="9" x2="15.01" y2="9" />
        </svg>
      </button>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          autoResize(e.currentTarget);
        }}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder={placeholder}
        disabled={busy}
        className="min-h-[36px] flex-1 resize-none overflow-y-auto rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-500"
      />

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={busy || value.trim().length === 0}
        aria-label="Send message"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-50"
        style={{ background: primaryColor }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </footer>
  );
}
