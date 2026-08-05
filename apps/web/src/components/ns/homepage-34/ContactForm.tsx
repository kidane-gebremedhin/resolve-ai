"use client";

// Client-side marketing "Contact Us" form. Submits to the PUBLIC, unauthenticated
// API endpoint (POST /public/contact), which persists the inquiry and forwards it
// to the support inbox. Replaces the previous static template (`action="#"`) that
// silently discarded every submission.

import { useState } from "react";
import { API_URL } from "@/lib/app-urls";

type Status = { kind: "idle" | "sending" } | { kind: "ok" } | { kind: "error"; message: string };

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status.kind === "sending") return;
    setStatus({ kind: "sending" });
    try {
      const res = await fetch(`${API_URL}/public/contact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? "Something went wrong. Please try again.");
      }
      setStatus({ kind: "ok" });
      setName("");
      setEmail("");
      setMessage("");
      setAgreed(false);
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  }

  if (status.kind === "ok") {
    return (
      <div
        role="status"
        className="rounded-2xl border border-stroke-3 bg-white p-7 text-center md:p-[42px] dark:border-stroke-7 dark:bg-background-6"
      >
        <p className="text-heading-6 font-medium text-secondary dark:text-accent">
          Thanks for reaching out!
        </p>
        <p className="mt-2 text-tagline-1 text-secondary/70 dark:text-accent/70">
          We&apos;ve received your message and will get back to you shortly.
        </p>
      </div>
    );
  }

  const sending = status.kind === "sending";

  return (
    <form onSubmit={handleSubmit} noValidate>
      <fieldset className="mb-5 flex w-full flex-col items-start justify-start gap-2 md:mb-8">
        <label htmlFor="fullName" className="text-tagline-1 font-medium text-foreground">
          Full Name
        </label>
        <input
          type="text"
          name="fullName"
          id="fullName"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter your name"
          className="w-full rounded-full border border-stroke-3 px-[18px] py-3 font-normal placeholder:font-normal placeholder:text-tagline-1 focus-visible:outline focus-visible:outline-primary-500 dark:border-stroke-7 dark:bg-background-6 dark:text-foreground dark:placeholder:text-foreground/60"
        />
      </fieldset>
      <fieldset className="mb-5 flex w-full flex-col items-start justify-start gap-2 md:mb-8">
        <label htmlFor="emailAddress" className="text-tagline-1 font-medium text-foreground">
          Email address
        </label>
        <input
          type="email"
          required
          name="emailAddress"
          id="emailAddress"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          className="w-full rounded-full border border-stroke-3 px-[18px] py-3 font-normal placeholder:font-normal placeholder:text-tagline-1 focus-visible:outline focus-visible:outline-primary-500 dark:border-stroke-7 dark:bg-background-6 dark:text-foreground dark:placeholder:text-foreground/60"
        />
      </fieldset>
      <fieldset className="mb-4 flex w-full flex-col items-start justify-start gap-2">
        <label htmlFor="messages" className="text-tagline-1 font-medium text-foreground">
          Message
        </label>
        <textarea
          name="messages"
          id="messages"
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Enter your message"
          className="min-h-[120px] w-full resize-none rounded-xl border border-stroke-3 px-[18px] py-3 font-normal placeholder:font-normal placeholder:text-tagline-1 focus-visible:outline focus-visible:outline-primary-500 dark:border-stroke-7 dark:bg-background-6 dark:text-foreground dark:placeholder:text-foreground/60"
        />
      </fieldset>
      <fieldset className="mb-4 flex items-center gap-2">
        <label htmlFor="agree-terms" className="flex items-center gap-x-3">
          <input
            id="agree-terms"
            type="checkbox"
            required
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="peer sr-only"
          />
          <span className="relative size-4 cursor-pointer rounded-full border border-stroke-3 after:absolute after:left-1/2 after:top-1/2 after:size-2.5 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-primary-500 after:opacity-0 peer-checked:border-primary-500 peer-checked:after:opacity-100 dark:border-stroke-7" />
        </label>
        <span className="text-tagline-3 text-foreground/70">
          I agree with the{" "}
          <a href="/terms" className="text-tagline-3 text-primary-500 underline">
            terms and conditions
          </a>
        </span>
      </fieldset>
      {status.kind === "error" ? (
        <p role="alert" className="mb-3 text-tagline-3 text-red-500 dark:text-red-400">
          {status.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={sending}
        className="btn btn-secondary dark:btn-accent btn-md w-full before:content-none first-letter:uppercase hover:btn-green disabled:opacity-60"
      >
        {sending ? "Sending…" : "Submit"}
      </button>
    </form>
  );
}
