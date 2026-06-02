// Platform-admin subscribers page. Server component: fetches /admin/subscriptions
// and surfaces revenue-shape KPIs (MRR, ARR, active, churn), then hands the row
// data to <SubscriptionsFilter /> for client-side status filtering.
//
// Backend gaps:
//   - MRR is derived from plan-price lookups (see utils.ts) because the API does
//     not yet aggregate revenue. Replace with a real /admin/revenue endpoint when
//     Paddle invoice totals are persisted.
//   - Organization names are not in the subscription payload — we hit
//     /admin/users to extract distinct orgs, but that only resolves names the
//     admin user has visibility into. Add `organizationName` to the subscription
//     response or a /admin/organizations endpoint to fix this properly.

import { AlertTriangle, CreditCard, DollarSign, TrendingDown, TrendingUp } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { SubscriptionsFilter } from "@/components/admin/subscriptions-filter";
import {
  type AdminSubscription,
  computeMrr,
  formatCurrency,
  formatNumber,
} from "@/components/admin/utils";

async function loadSubscribers(): Promise<{ subs: AdminSubscription[]; error: string | null }> {
  try {
    const subs = await api.get<AdminSubscription[]>("/admin/subscriptions");
    return { subs, error: null };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Failed to load subscriptions";
    return { subs: [], error: message };
  }
}

export default async function AdminSubscribersPage() {
  const { subs, error } = await loadSubscribers();

  const mrr = computeMrr(subs);
  const arr = mrr * 12;
  const activeCount = subs.filter((s) => s.status === "active" || s.status === "trialing").length;
  const canceledCount = subs.filter((s) => s.status === "canceled").length;
  const churnRate = subs.length > 0 ? (canceledCount / subs.length) * 100 : 0;

  // No /admin/organizations endpoint yet — names default to a short suffix of
  // the org id (handled inside SubscriptionsFilter). Pass an empty map for now.
  const orgNameById: Record<string, string> = {};

  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Subscribers</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Active billing relationships · {formatNumber(subs.length)} total
      </p>

      {error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
        <KpiCard
          icon={DollarSign}
          label="MRR (estimated)"
          value={formatCurrency(mrr)}
          hint="Plan price × active/trialing"
        />
        <KpiCard
          icon={TrendingUp}
          label="ARR (estimated)"
          value={formatCurrency(arr)}
          hint="MRR × 12"
        />
        <KpiCard
          icon={CreditCard}
          label="Active + trialing"
          value={formatNumber(activeCount)}
        />
        <KpiCard
          icon={TrendingDown}
          label="Churn rate"
          value={`${churnRate.toFixed(1)}%`}
          hint={`${canceledCount} canceled / ${subs.length} total`}
        />
      </div>

      <div className="mt-8">
        <SubscriptionsFilter subscriptions={subs} orgNameById={orgNameById} />
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  todo,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  hint?: string;
  todo?: string;
}) {
  return (
    <div className="bg-card p-5">
      <div className="flex items-center justify-between text-muted-foreground">
        <Icon className="h-4 w-4" />
        {todo ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warning">
            <AlertTriangle className="h-3 w-3" />
            {todo}
          </span>
        ) : hint ? (
          <span className="text-xs">{hint}</span>
        ) : null}
      </div>
      <div className="mt-3 font-display text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
