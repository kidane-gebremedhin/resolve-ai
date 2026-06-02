// Platform-admin subscriptions page. Same dataset as /admin/subscribers but a
// transaction-level view: shows raw Paddle identifiers, a deep-link out to the
// Paddle vendor dashboard, and a (currently no-op) "Refresh status" affordance.
//
// Backend gaps:
//   - There is no POST /admin/subscriptions/:id/sync endpoint, so the refresh
//     button is intentionally inert. The Paddle webhook is the source of truth
//     until that endpoint exists.
//   - paddleSubscriptionId / paddleCustomerId are rendered as-is. If we ever
//     prefix them server-side (sub_XXX / cus_XXX), strip the prefix in
//     SubscriptionsFilter to keep the Paddle deep link valid.

import { AlertTriangle, ExternalLink } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { SubscriptionsFilter } from "@/components/admin/subscriptions-filter";
import {
  type AdminSubscription,
  computeMrr,
  formatCurrency,
  formatNumber,
} from "@/components/admin/utils";

async function loadSubscriptions(): Promise<{ subs: AdminSubscription[]; error: string | null }> {
  try {
    const subs = await api.get<AdminSubscription[]>("/admin/subscriptions");
    return { subs, error: null };
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Failed to load subscriptions";
    return { subs: [], error: message };
  }
}

export default async function AdminSubscriptionsPage() {
  const { subs, error } = await loadSubscriptions();
  const mrr = computeMrr(subs);
  const orgNameById: Record<string, string> = {};

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Subscriptions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Transaction-level view · {formatNumber(subs.length)} records · {formatCurrency(mrr)} MRR
          </p>
        </div>
        <a
          href="https://vendors.paddle.com/subscriptions"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open Paddle dashboard
        </a>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-warning">
        <AlertTriangle className="h-3 w-3" />
        Refresh status is a no-op — no /admin/subscriptions/:id/sync endpoint yet
      </div>

      <div className="mt-6">
        <SubscriptionsFilter subscriptions={subs} orgNameById={orgNameById} />
      </div>
    </div>
  );
}
