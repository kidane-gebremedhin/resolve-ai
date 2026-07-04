"use client";

import { useState } from "react";
import { API_URL } from "../../lib/api-client";

export type FormField = {
  key: string;
  label: string;
  type: "text" | "email" | "tel" | "select" | "textarea";
  placeholder?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
};

export type FormBlockData = {
  type: "form";
  title?: string;
  fields: FormField[];
  submitLabel: string;
  toolKey: string;
};

export function FormBlockRenderer({
  block,
  primaryColor,
  conversationId,
  sessionToken,
  onSendMessage,
}: {
  block: FormBlockData;
  primaryColor?: string;
  conversationId?: string;
  sessionToken?: string;
  onSendMessage?: (text: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function handleChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Client-side required validation
    const newErrors: Record<string, string> = {};
    for (const field of block.fields) {
      if (field.required && !values[field.key]?.trim()) {
        newErrors[field.key] = `${field.label} is required`;
      }
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSubmitting(true);
    try {
      // API_URL already includes /api/v1. This one POST creates the message,
      // runs the tool ONCE with the submitted values, and generates the AI reply
      // (delivered over the socket) — so we must NOT also call onSendMessage,
      // which would fire a second turn where the AI re-runs the tool with guessed
      // values. onSendMessage is only a fallback when we can't post directly.
      let posted = false;
      if (conversationId && sessionToken) {
        const res = await fetch(`${API_URL}/widget/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-session-token": sessionToken,
          },
          body: JSON.stringify({
            content: `Submitted ${block.title ?? block.toolKey}`,
            formPayload: values,
            toolKey: block.toolKey,
          }),
        });
        posted = res.ok;
        if (!res.ok) throw new Error("submit failed");
      }
      setSubmitted(true);
      if (!posted && onSendMessage) {
        onSendMessage(
          block.fields.map((f) => `${f.label}: ${values[f.key] ?? ""}`).join(", "),
        );
      }
    } catch {
      setErrors({ _submit: "Submission failed. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
        ✓ Submitted successfully
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-xs rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
    >
      {block.title ? (
        <p className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {block.title}
        </p>
      ) : null}
      <div className="space-y-3">
        {block.fields.map((field) => (
          <div key={field.key}>
            <label className="mb-1 block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              {field.label}
              {field.required ? <span className="ml-0.5 text-red-500">*</span> : null}
            </label>
            {field.type === "select" ? (
              <select
                value={values[field.key] ?? ""}
                onChange={(e) => handleChange(field.key, e.target.value)}
                className="w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-900 focus:outline-none focus:ring-1 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              >
                <option value="">Select…</option>
                {(field.options ?? []).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea
                value={values[field.key] ?? ""}
                placeholder={field.placeholder}
                rows={3}
                onChange={(e) => handleChange(field.key, e.target.value)}
                className="w-full resize-none rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-900 focus:outline-none focus:ring-1 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            ) : (
              <input
                type={field.type}
                value={values[field.key] ?? ""}
                placeholder={field.placeholder}
                onChange={(e) => handleChange(field.key, e.target.value)}
                className="w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-900 focus:outline-none focus:ring-1 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            )}
            {errors[field.key] ? (
              <p className="mt-0.5 text-[10px] text-red-500">{errors[field.key]}</p>
            ) : null}
          </div>
        ))}
      </div>
      {errors._submit ? (
        <p className="mt-2 text-xs text-red-500">{errors._submit}</p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        className="mt-3 w-full rounded-lg py-2 text-xs font-medium text-white transition disabled:opacity-50"
        style={{ background: primaryColor ?? "#1e40af" }}
      >
        {submitting ? "Submitting…" : block.submitLabel}
      </button>
    </form>
  );
}
