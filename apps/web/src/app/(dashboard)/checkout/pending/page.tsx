"use client";

// Reached when the subscription activation poll times out after payment (3 min).
// The Paddle payment was accepted but the webhook / transaction-activation hasn't
// confirmed yet. This page keeps polling and auto-redirects once the subscription
// is active, while giving the user manual escape hatches.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle, Clock } from "lucide-react";
import { Button } from "@csb/ui";
import { clientApi } from "@/lib/api";
import { Logo } from "@/components/site/Logo";

export default function SubscriptionPendingPage() {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    const start = Date.now();

    const check = async () => {
      try {
        const sub = await clientApi.get<{ active: boolean }>("/billing/subscription");
        if (sub.active) {
          setActivated(true);
          setTimeout(() => router.push("/app"), 1500);
          return true;
        }
      } catch {
        /* keep trying */
      }
      setElapsed(Math.floor((Date.now() - start) / 1000));
      return false;
    };

    check(); // immediate first check
    const iv = setInterval(check, 4000);
    return () => clearInterval(iv);
  }, [router]);

  if (activated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
        <CheckCircle className="h-12 w-12 text-success" />
        <h1 className="font-display text-2xl font-semibold">Subscription activated!</h1>
        <p className="text-muted-foreground">Redirecting you to your dashboard…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="flex h-14 items-center border-b border-border px-5">
        <Logo />
      </header>

      <main className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-6 px-4 text-center">
        <div className="flex items-center justify-center rounded-full bg-muted p-5">
          <Clock className="h-8 w-8 text-muted-foreground" />
        </div>

        <div>
          <h1 className="font-display text-2xl font-semibold">Pending Subscription Status</h1>
          <p className="mt-2 max-w-sm text-muted-foreground">
            Your payment was received. We&apos;re waiting for your subscription to activate — this
            usually takes a few seconds.
          </p>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking activation status{elapsed > 0 ? ` (${elapsed}s)` : "…"}
        </div>

        <div className="flex flex-col items-center gap-3">
          <Button onClick={() => router.push("/app")}>Continue to dashboard</Button>
          <p className="text-xs text-muted-foreground">
            Your plan will be active once the payment is confirmed.{" "}
            <a
              href="mailto:support@example.com"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Contact support
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
