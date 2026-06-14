// Presentational subscriptions table for /admin/subscriptions. Status/plan
// filtering, search, date range, and pagination are handled server-side (the
// endpoint + <ListToolbar>); this renders the current page of rows.

import { ExternalLink } from "lucide-react";
import { Badge, Button } from "@csb/ui";
import type { AdminSubscription } from "./utils";
import { formatCurrency, formatDate, planPrice, planLabel } from "./utils";

const PADDLE_DASH_URL = "https://vendors.paddle.com/subscriptions";

function statusBadgeClass(status: AdminSubscription["status"]): string {
  switch (status) {
    case "active":
    case "trialing":
      return "bg-success/15 text-success";
    case "past_due":
    case "paused":
      return "bg-warning/20 text-foreground";
    case "canceled":
      return "bg-destructive/15 text-destructive";
    default:
      return "";
  }
}

export function SubscriptionsTable({ subscriptions }: { subscriptions: AdminSubscription[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-5 py-3 font-medium">Organization</th>
            <th className="px-5 py-3 font-medium">Plan</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="hidden px-5 py-3 font-medium lg:table-cell">Paddle IDs</th>
            <th className="hidden px-5 py-3 font-medium md:table-cell">Period</th>
            <th className="px-5 py-3 font-medium">MRR</th>
            <th className="px-5 py-3 text-right" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {subscriptions.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-5 py-12 text-center text-sm text-muted-foreground">
                No subscriptions match these filters.
              </td>
            </tr>
          ) : (
            subscriptions.map((s) => (
              <tr key={s._id} className="hover:bg-surface">
                <td className="px-5 py-3 font-medium">
                  {s.organizationName ?? s.organizationId.slice(-8)}
                </td>
                <td className="px-5 py-3">{planLabel(s.plan)}</td>
                <td className="px-5 py-3">
                  <Badge variant="secondary" className={statusBadgeClass(s.status)}>
                    {s.status.replace("_", " ")}
                  </Badge>
                </td>
                <td className="hidden px-5 py-3 lg:table-cell">
                  <div className="font-mono text-[11px] text-muted-foreground">
                    <div>sub_{s.paddleSubscriptionId}</div>
                    <div>cus_{s.paddleCustomerId}</div>
                  </div>
                </td>
                <td className="hidden px-5 py-3 text-muted-foreground md:table-cell">
                  {formatDate(s.currentPeriodStart)} – {formatDate(s.currentPeriodEnd)}
                </td>
                <td className="px-5 py-3">{formatCurrency(planPrice(s.plan))}</td>
                <td className="px-5 py-3 text-right">
                  <a href={`${PADDLE_DASH_URL}/${s.paddleSubscriptionId}`} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline" className="gap-1">
                      <ExternalLink className="h-3.5 w-3.5" />
                      Paddle
                    </Button>
                  </a>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
