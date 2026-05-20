import { Users, CreditCard, MessageSquare, DollarSign, ArrowUpRight } from "lucide-react";

const kpis = [
  { label: "Total users", value: "12,418", delta: "+248 this wk", icon: Users },
  { label: "Active subs", value: "3,072", delta: "+5.2% MoM", icon: CreditCard },
  { label: "MRR", value: "$184.2k", delta: "+12% MoM", icon: DollarSign },
  { label: "Tickets open", value: "37", delta: "-9 today", icon: MessageSquare },
];

const recent = [
  { name: "Marisol Vega", email: "marisol@stride.co", plan: "Growth", when: "2m" },
  { name: "Daniel Park", email: "dan@formline.io", plan: "Starter", when: "11m" },
  { name: "Aisha Rahman", email: "aisha@candor.dev", plan: "Scale", when: "34m" },
  { name: "Felix Brown", email: "felix@plotly.cc", plan: "Starter", when: "1h" },
  { name: "Yara Costa", email: "yara@halcyon.io", plan: "Growth", when: "2h" },
];

function Page() {
  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">Platform health at a glance.</p>

      <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-card p-5">
            <div className="flex items-center justify-between text-muted-foreground">
              <k.icon className="h-4 w-4" />
              <span className="inline-flex items-center gap-1 text-xs text-success"><ArrowUpRight className="h-3 w-3" />{k.delta}</span>
            </div>
            <div className="mt-3 font-display text-3xl font-semibold tracking-tight">{k.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="font-display text-sm font-semibold">Revenue — last 12 weeks</div>
          <div className="mt-5 flex items-end gap-1.5">
            {[42, 48, 51, 49, 56, 62, 60, 68, 72, 75, 81, 88].map((h, i) => (
              <div key={i} className="flex-1 rounded-t-sm bg-foreground" style={{ height: `${h * 1.8}px` }} />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="font-display text-sm font-semibold">System health</div>
          <ul className="mt-4 space-y-3 text-sm">
            {[
              ["API latency", "142ms", "good"],
              ["Error rate", "0.04%", "good"],
              ["Queue depth", "12", "good"],
              ["Uptime (30d)", "99.98%", "good"],
            ].map(([k, v]) => (
              <li key={k} className="flex items-center justify-between">
                <span className="text-muted-foreground">{k}</span>
                <span className="inline-flex items-center gap-1.5 font-medium"><span className="h-1.5 w-1.5 rounded-full bg-success" />{v}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3 font-display text-sm font-semibold">Recent signups</div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">User</th>
              <th className="hidden px-5 py-3 font-medium md:table-cell">Email</th>
              <th className="px-5 py-3 font-medium">Plan</th>
              <th className="px-5 py-3 font-medium text-right">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {recent.map((r) => (
              <tr key={r.email} className="hover:bg-surface">
                <td className="px-5 py-3 font-medium">{r.name}</td>
                <td className="hidden px-5 py-3 text-muted-foreground md:table-cell">{r.email}</td>
                <td className="px-5 py-3">{r.plan}</td>
                <td className="px-5 py-3 text-right text-muted-foreground">{r.when} ago</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


export default Page;
