// Post-signup checkout. Authenticated (the (dashboard) group layout requires a
// session) but intentionally OUTSIDE the /app subscription gate, so unpaid orgs
// can reach it. If a subscription is already active, skip straight to /app.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { CheckoutPlans } from "@/components/billing/checkout-plans";
import { Logo } from "@/components/site/Logo";

async function safeGet<T>(path: string): Promise<T | null> {
  try {
    return await api.get<T>(path);
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export default async function CheckoutPage() {
  const session = await auth();
  const organizationId = session?.user?.organizationId;

  const sub = await safeGet<{ active?: boolean }>("/billing/subscription");
  if (sub?.active) {
    redirect("/app");
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="flex h-14 items-center border-b border-border px-5">
        <Logo />
      </header>
      <main className="container-page py-12">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Choose your plan</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pick a plan to activate your workspace. You can change or cancel anytime from Billing.
          </p>
        </div>
        <div className="mx-auto mt-8 max-w-4xl">
          <CheckoutPlans organizationId={organizationId} />
        </div>
      </main>
    </div>
  );
}
