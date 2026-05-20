import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const subs = [
  { user: "Maya Lin", plan: "Growth", mrr: "$79", status: "Active", next: "Jun 1" },
  { user: "Arjun Patel", plan: "Scale", mrr: "$249", status: "Active", next: "May 22" },
  { user: "Emma Schultz", plan: "Starter", mrr: "$0", status: "Past due", next: "—" },
  { user: "Tomás Ruiz", plan: "Scale", mrr: "$249", status: "Active", next: "Jun 14" },
  { user: "Niko Vasiliev", plan: "Growth", mrr: "$79", status: "Cancelled", next: "—" },
];

function Page() {
  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Subscriptions</h1>
      <p className="mt-1 text-sm text-muted-foreground">Active billing relationships across the platform.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        {[
          ["MRR", "$184,200"],
          ["ARR", "$2.21M"],
          ["Active", "3,072"],
          ["Churn (30d)", "1.4%"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="mt-1 font-display text-2xl font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">User</th>
              <th className="px-5 py-3 font-medium">Plan</th>
              <th className="px-5 py-3 font-medium">MRR</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Next bill</th>
              <th className="px-5 py-3 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {subs.map((s) => (
              <tr key={s.user} className="hover:bg-surface">
                <td className="px-5 py-3 font-medium">{s.user}</td>
                <td className="px-5 py-3">{s.plan}</td>
                <td className="px-5 py-3">{s.mrr}</td>
                <td className="px-5 py-3">
                  <Badge variant={s.status === "Active" ? "secondary" : "destructive"} className={s.status === "Active" ? "bg-success/15 text-success" : s.status === "Past due" ? "bg-warning/20 text-foreground" : ""}>
                    {s.status}
                  </Badge>
                </td>
                <td className="px-5 py-3 text-muted-foreground">{s.next}</td>
                <td className="px-5 py-3 text-right"><Button size="sm" variant="outline">Manage</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


export default Page;
