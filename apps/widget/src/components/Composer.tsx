"use client";

// Composer — the bottom input bar used by both pre_chat and chat_active screens.
// Plain textarea (auto-grow capped at 4 rows), an optional paperclip for file
// attach, an emoji picker, and a send button. Enter sends; Shift-Enter inserts
// a newline.

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { WidgetAttachment } from "../lib/api-client";

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

type PendingAttachment = {
  attachment: WidgetAttachment;
  previewUrl?: string; // local object URL for image thumbnails
  isImage: boolean;
};

export function Composer({
  onSend,
  onAttach,
  primaryColor,
  disabled = false,
  placeholder = "Type a message…",
}: {
  onSend: (content: string, attachments?: WidgetAttachment[]) => Promise<void> | void;
  /** Optional — when provided the paperclip button is rendered. Uploads the file
   *  and returns its metadata; the composer queues it as a preview until send. */
  onAttach?: (file: File) => Promise<WidgetAttachment>;
  primaryColor: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
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
  const canSend = (value.trim().length > 0 || pending.length > 0) && !busy && !uploading;

  async function handleSubmit() {
    const trimmed = value.trim();
    if ((!trimmed && pending.length === 0) || busy || uploading) return;
    const attachments = pending.map((p) => p.attachment);
    // Optimistically clear so the composer is empty while the send is in-flight.
    setValue("");
    setShowEmoji(false);
    pending.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    setPending([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setSending(true);
    try {
      await onSend(trimmed, attachments.length ? attachments : undefined);
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
    const isImage = file.type.startsWith("image/");
    const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
    setUploading(true);
    try {
      // Upload now (to get the URL + extracted text) but DON'T send — queue it
      // as a preview so the visitor can add more or type a message first.
      const attachment = await onAttach(file);
      setPending((prev) => [...prev, { attachment, previewUrl, isImage }]);
    } catch {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    } finally {
      setUploading(false);
    }
  }

  function removePending(index: number) {
    setPending((prev) => {
      const target = prev[index];
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
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
    <footer ref={footerRef} className="relative flex flex-col gap-2 border-t border-neutral-100 p-3 dark:border-neutral-800">
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

      {/* Queued attachment previews — sent (with optional text) on the next send. */}
      {pending.length > 0 || uploading ? (
        <div className="flex flex-wrap gap-2">
          {pending.map((p, i) => (
            <div
              key={i}
              className="relative flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-1 pr-6 dark:border-neutral-700 dark:bg-neutral-800"
            >
              {p.isImage && p.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.previewUrl} alt={p.attachment.fileName ?? "image"} className="h-10 w-10 rounded object-cover" />
              ) : (
                <span className="flex h-10 items-center gap-1.5 px-1.5 text-[11px] text-neutral-700 dark:text-neutral-200">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="opacity-70">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span className="max-w-[120px] truncate">{p.attachment.fileName ?? "file"}</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => removePending(i)}
                aria-label="Remove attachment"
                className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-neutral-900/70 text-white hover:bg-neutral-900"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
          {uploading ? (
            <div className="grid h-12 w-12 place-items-center rounded-lg border border-dashed border-neutral-300 dark:border-neutral-600">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent" />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
      {onAttach ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFile}
            disabled={busy || uploading}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || uploading}
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
        disabled={!canSend}
        aria-label="Send message"
        className="group inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-all duration-150 hover:brightness-95 hover:shadow active:scale-95 disabled:opacity-45 disabled:shadow-none disabled:hover:brightness-100"
        style={{ background: primaryColor }}
      >
        {/* Filled paper-plane — modern, well-filled send glyph. */}
        <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="translate-x-px">
          <path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.993.993 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
        </svg>
      </button>
      </div>
    </footer>
  );
}
