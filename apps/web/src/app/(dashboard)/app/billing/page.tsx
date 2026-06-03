import { Check, CreditCard } from "lucide-react";
import { Badge } from "@csb/ui";
import { api, ApiError } from "@/lib/api";
import { auth } from "@/lib/auth";
import {
  ChoosePlanButton,
  ManageSubscriptionButton,
} from "@/components/billing/plan-actions";

type Subscription = {
  plan: "free" | "starter" | "pro" | "enterprise";
  status: "active" | "trialing" | "past_due" | "canceled" | "paused";
  paddleSubscriptionId: string | null;
  paddleCustomerId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
};

type CatalogEntry = {
  plan: "free" | "starter" | "pro" | "enterprise";
  name: string;
  priceId: string | null;
  priceMonthlyUsd: number | null;
  features: string[];
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusVariant(status: Subscription["status"]): { label: string; tone: string } {
  const map: Record<Subscription["status"], { label: string; tone: string }> = {
    active: { label: "Active", tone: "bg-success/15 text-success" },
    trialing: { label: "Trialing", tone: "bg-primary/15 text-primary" },
    past_due: { label: "Past due", tone: "bg-warning/20 text-foreground" },
    paused: { label: "Paused", tone: "bg-muted text-muted-foreground" },
    canceled: { label: "Canceled", tone: "bg-destructive/15 text-destructive" },
  };
  return map[status] ?? { label: status, tone: "bg-muted text-muted-foreground" };
}

async function Page() {
  const session = await auth();
  const organizationId = session?.user?.organizationId;

  let sub: Subscription | null = null;
  let loadError: string | null = null;
  try {
    sub = await api.get<Subscription>("/billing/subscription");
  } catch (e) {
    loadError =
      e instanceof ApiError ? e.message : "Failed to load subscription.";
  }

  // Admin-configured plan catalog (GET /billing/plans). Free tier isn't a
  // purchasable card. Pro is highlighted by convention.
  let catalog: CatalogEntry[] = [];
  try {
    const res = await api.get<{ plans: CatalogEntry[] }>("/billing/plans");
    catalog = res.plans.filter((p) => p.plan !== "free");
  } catch {
    catalog = [];
  }

  const plan = sub?.plan ?? "free";
  const status = sub?.status ?? "active";
  const statusBadge = statusVariant(status);
  const hasPaddleCustomer = Boolean(sub?.paddleCustomerId);
  const currentPlanLabel =
    plan === "free" ? "No active plan" : plan.charAt(0).toUpperCase() + plan.slice(1);

  return (
    <div className="container-page py-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your plan, payment method, and invoices via the Paddle customer portal.
        </p>
      </div>

      {loadError && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Current plan</div>
              <div className="mt-1 font-display text-2xl font-semibold">{currentPlanLabel}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {sub?.currentPeriodStart && sub?.currentPeriodEnd
                  ? `${formatDate(sub.currentPeriodStart)} – ${formatDate(sub.currentPeriodEnd)}`
                  : "No active billing period"}
                {sub?.canceledAt && ` · canceled ${formatDate(sub.canceledAt)}`}
              </div>
            </div>
            <Badge className={statusBadge.tone}>{statusBadge.label}</Badge>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <ManageSubscriptionButton
              hasPaddleCustomer={hasPaddleCustomer}
              label="Manage subscription"
            />
            <ManageSubscriptionButton
              hasPaddleCustomer={hasPaddleCustomer}
              variant="ghost"
              label="Cancel subscription"
            />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Payment method</div>
          <div className="mt-3 flex items-center gap-3">
            <div className="grid h-9 w-12 place-items-center rounded-md bg-foreground text-background">
              <CreditCard className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-medium">
                {hasPaddleCustomer ? "Managed by Paddle" : "No payment method"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {hasPaddleCustomer
                  ? "Update cards & invoices in the customer portal."
                  : "Choose a plan below to add one."}
              </div>
            </div>
          </div>
          <div className="mt-4">
            <ManageSubscriptionButton
              hasPaddleCustomer={hasPaddleCustomer}
              label="Open customer portal"
            />
          </div>
        </div>
      </div>

      <div className="mt-8">
        <div className="font-display text-sm font-semibold">Plans</div>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {catalog.map((p) => {
            const isCurrent = plan === p.plan;
            const highlighted = p.plan === "pro";
            const priceLabel = p.priceMonthlyUsd == null ? "Custom" : `$${p.priceMonthlyUsd}`;
            const cadence = p.priceMonthlyUsd == null ? "" : "/mo";
            return (
              <div
                key={p.plan}
                className={`rounded-xl border bg-card p-5 ${
                  isCurrent
                    ? "border-foreground ring-1 ring-foreground"
                    : highlighted
                      ? "border-primary/50"
                      : "border-border"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-display text-lg font-semibold">{p.name}</div>
                  {isCurrent && <Badge variant="secondary">Current</Badge>}
                </div>
                <div className="mt-2 font-display text-3xl font-semibold">
                  {priceLabel}
                  <span className="text-sm font-normal text-muted-foreground">{cadence}</span>
                </div>
                <ul className="mt-4 space-y-2 text-sm">
                  {p.features.map((i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 text-success" /> {i}
                    </li>
                  ))}
                </ul>
                <div className="mt-5">
                  <ChoosePlanButton
                    plan={{
                      id: p.plan as "starter" | "pro" | "enterprise",
                      priceId: p.priceId ?? undefined,
                      label: p.name,
                    }}
                    organizationId={organizationId}
                    isCurrent={isCurrent}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-8 rounded-xl border border-dashed border-border bg-surface/40 p-5 text-sm text-muted-foreground">
        Invoices and receipts are available inside the Paddle customer portal. Use the
        &quot;Manage subscription&quot; button above to view, download, or update billing details.
      </div>
    </div>
  );
}

export default Page;
