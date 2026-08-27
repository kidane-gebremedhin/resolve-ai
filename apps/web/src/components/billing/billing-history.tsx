import { Badge } from "@csb/ui";
import { InvoiceLink } from "./invoice-link";

export type PaymentRow = {
  id: string;
  status:
    | "pending"
    | "completed"
    | "failed"
    | "refunded"
    | "partially_refunded"
    | "disputed";
  amount: number;
  currency: string;
  tax: number | null;
  description: string;
  occurredAt: string;
  invoiceUrl: string | null;
  receiptUrl: string | null;
  hasInvoice: boolean;
  providerTransactionId: string;
  failureReason: string | null;
  paymentMethod: { type: string | null; last4: string | null; brand: string | null };
};

const STATUS_TONE: Record<PaymentRow["status"], { label: string; tone: string }> = {
  completed: { label: "Paid", tone: "bg-success/15 text-success" },
  pending: { label: "Pending", tone: "bg-muted text-muted-foreground" },
  failed: { label: "Failed", tone: "bg-destructive/15 text-destructive" },
  refunded: { label: "Refunded", tone: "bg-warning/20 text-foreground" },
  partially_refunded: { label: "Part refunded", tone: "bg-warning/20 text-foreground" },
  disputed: { label: "Disputed", tone: "bg-destructive/15 text-destructive" },
};

// Amounts arrive in minor units, the way the provider reports them, so the
// division happens once here at the display edge and nowhere else.
function formatAmount(minorUnits: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
      minorUnits / 100,
    );
  } catch {
    return `${(minorUnits / 100).toFixed(2)} ${currency}`;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function BillingHistory({ payments }: { payments: PaymentRow[] }) {
  if (payments.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface/40 p-5 text-sm text-muted-foreground">
        No payments yet. Once a payment is taken it will appear here with its receipt.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Description</th>
            <th className="px-4 py-3 font-medium">Method</th>
            <th className="px-4 py-3 text-right font-medium">Amount</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Invoice</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => {
            const badge = STATUS_TONE[p.status] ?? {
              label: p.status,
              tone: "bg-muted text-muted-foreground",
            };
            // A provider that sends a durable link inline wins; otherwise the
            // link is minted on demand, because Paddle's expires in an hour.
            const inlineLink = p.receiptUrl ?? p.invoiceUrl;
            return (
              <tr key={p.id} className="border-b border-border/60 last:border-0">
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {formatDate(p.occurredAt)}
                </td>
                <td className="px-4 py-3">
                  <div className="text-foreground">{p.description}</div>
                  {p.status === "failed" && p.failureReason && (
                    <div className="mt-0.5 text-xs text-destructive">
                      Declined: {p.failureReason.replace(/_/g, " ")}
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {p.paymentMethod.last4
                    ? `${p.paymentMethod.brand ?? "card"} ····${p.paymentMethod.last4}`
                    : "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">
                  {formatAmount(p.amount, p.currency)}
                </td>
                <td className="px-4 py-3">
                  <Badge className={badge.tone}>{badge.label}</Badge>
                </td>
                <td className="px-4 py-3">
                  {inlineLink ? (
                    <a
                      href={inlineLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Invoice
                    </a>
                  ) : p.hasInvoice ? (
                    <InvoiceLink paymentId={p.id} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
