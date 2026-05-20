import { ArrowUpRight, ArrowDownRight, Bot, MessagesSquare, Clock, Smile } from "lucide-react";

const kpis = [
  { label: "Open conversations", value: "47", delta: "−12%", down: true, icon: MessagesSquare },
  { label: "AI resolution rate", value: "68%", delta: "+4.2pp", down: false, icon: Bot },
  { label: "Median first reply", value: "1.2s", delta: "−0.3s", down: true, icon: Clock },
  { label: "CSAT (7d)", value: "4.86", delta: "+0.12", down: false, icon: Smile },
];

const recent = [
  { customer: "Idris Khan", subject: "Refund for duplicate charge", channel: "Email", status: "AI handled", time: "2m" },
  { customer: "Anya Petrov", subject: "API rate limit on /v2/orders", channel: "Chat", status: "Open", time: "6m" },
  { customer: "Sam Reyes", subject: "Can't log in after SSO change", channel: "Chat", status: "Pending", time: "11m" },
  { customer: "Léa Martin", subject: "Invoice missing VAT", channel: "Email", status: "AI handled", time: "23m" },
  { customer: "Hiro Tanaka", subject: "Cancel my Pro plan", channel: "WhatsApp", status: "Open", time: "41m" },
];

function Overview() {
  return (
    <div className="container-page py-8">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Good afternoon, Maya</h1>
          <p className="mt-1 text-sm text-muted-foreground">Here's what your AI agent and team handled today.</p>
        </div>
        <Link href="/app/inbox" className="text-sm text-muted-foreground hover:text-foreground">Open inbox →</Link>
      </div>

      <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-card p-5">
            <div className="flex items-center justify-between text-muted-foreground">
              <k.icon className="h-4 w-4" />
              <span className={`inline-flex items-center gap-1 text-xs ${k.down ? "text-success" : "text-success"}`}>
                {k.down ? <ArrowDownRight className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                {k.delta}
              </span>
            </div>
            <div className="mt-3 font-display text-3xl font-semibold tracking-tight">{k.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 md:col-span-2">
          <div className="flex items-center justify-between">
            <div className="font-display text-sm font-semibold">Volume — last 14 days</div>
            <div className="flex gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-foreground" /> Human</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-primary" /> AI</span>
            </div>
          </div>
          <Sparkline />
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="font-display text-sm font-semibold">Top topics this week</div>
          <ul className="mt-4 space-y-3 text-sm">
            {[
              ["Billing & invoices", 38],
              ["Login / SSO issues", 24],
              ["API errors", 18],
              ["Refund requests", 12],
              ["Plan changes", 8],
            ].map(([t, pct]) => (
              <li key={t as string}>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="text-foreground">{t}</span>
                  <span>{pct}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="font-display text-sm font-semibold">Recent conversations</div>
          <Link href="/app/inbox" className="text-xs text-muted-foreground hover:text-foreground">View all</Link>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Customer</th>
              <th className="px-5 py-3 font-medium">Subject</th>
              <th className="px-5 py-3 font-medium">Channel</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium text-right">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {recent.map((r) => (
              <tr key={r.subject} className="hover:bg-surface">
                <td className="px-5 py-3 font-medium">{r.customer}</td>
                <td className="px-5 py-3 text-muted-foreground">{r.subject}</td>
                <td className="px-5 py-3 text-muted-foreground">{r.channel}</td>
                <td className="px-5 py-3"><StatusPill status={r.status} /></td>
                <td className="px-5 py-3 text-right text-muted-foreground">{r.time} ago</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    "AI handled": "bg-success/10 text-success",
    "Open": "bg-primary/10 text-primary",
    "Pending": "bg-warning/15 text-foreground",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {status}
    </span>
  );
}

function Sparkline() {
  const human = [5, 7, 4, 8, 6, 9, 5, 11, 7, 8, 6, 9, 7, 10];
  const ai =    [12, 14, 11, 16, 13, 18, 14, 20, 17, 19, 16, 21, 18, 22];
  const max = Math.max(...ai) + 4;
  return (
    <div className="mt-5 flex items-end gap-1.5">
      {ai.map((a, i) => (
        <div key={i} className="flex flex-1 flex-col items-stretch gap-0.5">
          <div className="rounded-t-sm bg-primary" style={{ height: `${(a / max) * 140}px` }} />
          <div className="rounded-b-sm bg-foreground" style={{ height: `${(human[i] / max) * 140}px` }} />
        </div>
      ))}
    </div>
  );
}
