"use client";

// Toast helpers for ACTION outcomes — a submit that failed, a save that
// succeeded, a delete that was rejected. One place that knows how to turn an
// unknown thrown value into a sentence, so every call site reports failures the
// same way instead of each inventing its own string handling.
//
// WHAT DOES NOT BELONG HERE
//   • Field-level validation ("Password must contain a number") — that stays
//     inline next to the field. A toast disappears and never says WHICH field.
//   • Page-load failures ("Failed to load websites") — those aren't transient;
//     the page stays broken, so they stay as an inline banner the user can read
//     at their own pace.
// Toasts are for things that happened in response to an action the user just took.

import { toast } from "@csb/ui";
import { ApiError } from "./api";

export { toast };

/**
 * Report a failed action. Accepts whatever was caught — ApiError, Error, or
 * something that isn't an Error at all — and always produces a readable line.
 *
 * `fallback` is used when the thrown value carries no usable message, so the
 * user never sees "[object Object]" or an empty toast.
 */
export function toastError(err: unknown, fallback = "Something went wrong."): void {
  toast.error(errorMessage(err, fallback));
}

/** The message an unknown thrown value should show. Exported for inline banners. */
export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

/** Confirm an action that succeeded. Keep it short — it's a passing notification. */
export function toastSuccess(message: string, description?: string): void {
  toast.success(message, description ? { description } : undefined);
}
