"use client";

// Status filter pills + transaction-level table for /admin/subscriptions.
// "Refresh status" is intentionally a no-op: the Paddle webhook is the source
// of truth, and forcing a manual refresh would create write paths we don't
// currently support. TODO: add an endpoint that re-syncs from Paddle on demand.

import { useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Badge, Button } from "@csb/ui";
import type { AdminSubscription } from "./utils";
import { formatCurrency, formatDate, planPrice } from "./utils";

const PADDLE_DASH_URL = "https://vendors.paddle.com/subscriptions";

const STATUS_TABS: { value: AdminSubscription["status"] | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "trialing", label: "Trialing" },
  { value: "past_due", label: "Past due" },
  { value: "canceled", label: "Canceled" },
  { value: "paused", label: "Paused" },
];

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

export function SubscriptionsFilter({
  subscriptions,
  orgNameById,
}: {
  subscriptions: AdminSubscription[];
  orgNameById: Record<string, string>;
}) {
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]["value"]>("all");

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: subscriptions.length };
    for (const s of subscriptions) out[s.status] = (out[s.status] ?? 0) + 1;
    return out;
  }, [subscriptions]);

  const rows = useMemo(
    () => (status === "all" ? subscriptions : subscriptions.filter((s) => s.status === status)),
    [subscriptions, status],
  );

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => {
          const active = status === t.value;
          const count = counts[t.value] ?? 0;
          return (
            <button
              key={t.value}
              onClick={() => setStatus(t.value)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-foreground/80 hover:bg-muted"
              }`}
            >
              {t.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  active ? "bg-background/20 text-background" : "bg-muted text-muted-foreground"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
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
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center text-sm text-muted-foreground">
                  No subscriptions in this status.
                </td>
              </tr>
            ) : (
              rows.map((s) => (
                <tr key={s._id} className="hover:bg-surface">
                  <td className="px-5 py-3 font-medium">
                    {orgNameById[s.organizationId] ?? s.organizationId.slice(-8)}
                  </td>
                  <td className="px-5 py-3 capitalize">{s.plan}</td>
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
                    <div className="inline-flex items-center gap-1">
                      <a
                        href={`${PADDLE_DASH_URL}/${s.paddleSubscriptionId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Button size="sm" variant="outline" className="gap-1">
                          <ExternalLink className="h-3.5 w-3.5" />
                          Paddle
                        </Button>
                      </a>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="TODO: webhook is source of truth — no-op for now"
                        onClick={() => {
                          // TODO: wire up to a future POST /admin/subscriptions/:id/sync endpoint.
                        }}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
