import { Check, CreditCard, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const plans = [
  { name: "Starter", price: 0, items: ["1 website", "500 AI messages / mo", "Email support"] },
  { name: "Growth", price: 79, items: ["5 websites", "25k AI messages / mo", "Lead capture", "Live chat handoff"], current: true },
  { name: "Scale", price: 249, items: ["Unlimited sites", "200k AI messages", "Priority support", "Custom branding"] },
];

const invoices = [
  { id: "INV-2025-005", date: "May 1, 2025", amount: "$79.00", status: "Paid" },
  { id: "INV-2025-004", date: "Apr 1, 2025", amount: "$79.00", status: "Paid" },
  { id: "INV-2025-003", date: "Mar 1, 2025", amount: "$79.00", status: "Paid" },
];

function Page() {
  return (
    <div className="container-page py-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your plan, payment method, and invoices.</p>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Current plan</div>
              <div className="mt-1 font-display text-2xl font-semibold">Growth — $79/mo</div>
              <div className="mt-1 text-xs text-muted-foreground">Renews June 1, 2025</div>
            </div>
            <Badge>Active</Badge>
          </div>
          <div className="mt-5 flex gap-2">
            <Button size="sm">Upgrade</Button>
            <Button size="sm" variant="outline">Change plan</Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground">Cancel subscription</Button>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Payment method</div>
          <div className="mt-3 flex items-center gap-3">
            <div className="grid h-9 w-12 place-items-center rounded-md bg-foreground text-background"><CreditCard className="h-4 w-4" /></div>
            <div>
              <div className="text-sm font-medium">•••• 4242</div>
              <div className="text-[11px] text-muted-foreground">Visa · expires 08/27</div>
            </div>
          </div>
          <Button size="sm" variant="outline" className="mt-4 w-full">Update card</Button>
        </div>
      </div>

      <div className="mt-8">
        <div className="font-display text-sm font-semibold">Plans</div>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {plans.map((p) => (
            <div key={p.name} className={`rounded-xl border bg-card p-5 ${p.current ? "border-foreground ring-1 ring-foreground" : "border-border"}`}>
              <div className="flex items-center justify-between">
                <div className="font-display text-lg font-semibold">{p.name}</div>
                {p.current && <Badge variant="secondary">Current</Badge>}
              </div>
              <div className="mt-2 font-display text-3xl font-semibold">${p.price}<span className="text-sm font-normal text-muted-foreground">/mo</span></div>
              <ul className="mt-4 space-y-2 text-sm">
                {p.items.map((i) => (
                  <li key={i} className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 text-success" /> {i}</li>
                ))}
              </ul>
              <Button size="sm" className="mt-5 w-full" variant={p.current ? "outline" : "default"}>{p.current ? "Manage" : "Choose"}</Button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="font-display text-sm font-semibold">Invoices</div>
          <Button size="sm" variant="ghost" className="gap-2"><Download className="h-3.5 w-3.5" /> Export all</Button>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Invoice</th>
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {invoices.map((i) => (
              <tr key={i.id}>
                <td className="px-5 py-3 font-medium">{i.id}</td>
                <td className="px-5 py-3 text-muted-foreground">{i.date}</td>
                <td className="px-5 py-3">{i.amount}</td>
                <td className="px-5 py-3"><Badge variant="secondary" className="bg-success/15 text-success">{i.status}</Badge></td>
                <td className="px-5 py-3 text-right"><Button size="sm" variant="ghost"><Download className="h-3.5 w-3.5" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


export default Page;
