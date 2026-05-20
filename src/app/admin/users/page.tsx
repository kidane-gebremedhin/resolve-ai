import { Search, MoreHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const users = [
  { name: "Maya Lin", email: "maya@northwind.io", role: "Owner", plan: "Growth", status: "Active", joined: "Mar 2024" },
  { name: "Arjun Patel", email: "arjun@formline.io", role: "User", plan: "Scale", status: "Active", joined: "Jan 2024" },
  { name: "Emma Schultz", email: "emma@halcyon.io", role: "User", plan: "Starter", status: "Suspended", joined: "Aug 2024" },
  { name: "Tomás Ruiz", email: "tomas@candor.dev", role: "Admin", plan: "Scale", status: "Active", joined: "Feb 2024" },
  { name: "Niko Vasiliev", email: "niko@stride.co", role: "User", plan: "Growth", status: "Active", joined: "Nov 2024" },
  { name: "Sara Okafor", email: "sara@plotly.cc", role: "User", plan: "Starter", status: "Active", joined: "Apr 2025" },
];

function Page() {
  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">12,418 total · 11,302 active</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search users…" className="h-9 pl-8" />
          </div>
          <Button size="sm" variant="outline">Export</Button>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">User</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Plan</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="hidden px-5 py-3 font-medium md:table-cell">Joined</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.email} className="hover:bg-surface">
                <td className="px-5 py-3">
                  <div className="font-medium">{u.name}</div>
                  <div className="text-[11px] text-muted-foreground">{u.email}</div>
                </td>
                <td className="px-5 py-3"><Badge variant="outline">{u.role}</Badge></td>
                <td className="px-5 py-3 text-muted-foreground">{u.plan}</td>
                <td className="px-5 py-3">
                  <Badge variant={u.status === "Active" ? "secondary" : "destructive"} className={u.status === "Active" ? "bg-success/15 text-success" : ""}>{u.status}</Badge>
                </td>
                <td className="hidden px-5 py-3 text-muted-foreground md:table-cell">{u.joined}</td>
                <td className="px-5 py-3 text-right"><Button size="sm" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


export default Page;
