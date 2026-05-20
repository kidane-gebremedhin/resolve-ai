'use client';

import { useState } from "react";
import { Download, Filter, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type Score = "Hot" | "Warm" | "Cold";
type Status = "New" | "Contacted" | "Qualified" | "Converted";
type Lead = { id: string; name: string; email: string; site: string; score: Score; status: Status; created: string; notes: string };

const leads: Lead[] = [
  { id: "l1", name: "Marisol Vega", email: "marisol@stride.co", site: "northwind.io", score: "Hot", status: "New", created: "10m", notes: "Asked about enterprise SSO + 50 seats." },
  { id: "l2", name: "Daniel Park", email: "dan@formline.io", site: "shop.northwind.io", score: "Warm", status: "Contacted", created: "2h", notes: "Comparing pricing vs Intercom." },
  { id: "l3", name: "Aisha Rahman", email: "aisha@candor.dev", site: "northwind.io", score: "Hot", status: "Qualified", created: "5h", notes: "Wants demo by Friday." },
  { id: "l4", name: "Felix Brown", email: "felix@plotly.cc", site: "docs.northwind.io", score: "Cold", status: "New", created: "1d", notes: "Trial signed up, no follow-up yet." },
  { id: "l5", name: "Yara Costa", email: "yara@halcyon.io", site: "northwind.io", score: "Warm", status: "Converted", created: "2d", notes: "Signed Growth plan." },
];

const scoreStyle: Record<Score, string> = {
  Hot: "bg-destructive/15 text-destructive",
  Warm: "bg-warning/20 text-foreground",
  Cold: "bg-muted text-muted-foreground",
};

function Page() {
  const [tab, setTab] = useState<"All" | Status>("All");
  const filtered = leads.filter((l) => tab === "All" || l.status === tab);
  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">Visitors captured by the AI agent. Score, qualify, and hand off to sales.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-2"><Filter className="h-4 w-4" /> Filter</Button>
          <Button size="sm" variant="outline" className="gap-2"><Download className="h-4 w-4" /> Export CSV</Button>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        {[
          ["Total", "147"],
          ["Hot", "23"],
          ["This week", "38"],
          ["Conv. rate", "11.4%"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="mt-1 font-display text-2xl font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {(["All", "New", "Contacted", "Qualified", "Converted"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              tab === t ? "border-foreground bg-foreground text-background" : "border-border bg-background hover:bg-muted"
            }`}
          >
            {t}
          </button>
        ))}
        <div className="ml-auto w-full sm:w-64">
          <Input placeholder="Search leads…" className="h-9" />
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Lead</th>
              <th className="px-5 py-3 font-medium">Score</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="hidden px-5 py-3 font-medium md:table-cell">Source</th>
              <th className="hidden px-5 py-3 font-medium lg:table-cell">Notes</th>
              <th className="px-5 py-3 font-medium text-right">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((l) => (
              <tr key={l.id} className="hover:bg-surface">
                <td className="px-5 py-3">
                  <div className="font-medium">{l.name}</div>
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground"><Mail className="h-3 w-3" /> {l.email}</div>
                </td>
                <td className="px-5 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${scoreStyle[l.score]}`}>{l.score}</span></td>
                <td className="px-5 py-3"><Badge variant="secondary">{l.status}</Badge></td>
                <td className="hidden px-5 py-3 text-muted-foreground md:table-cell">{l.site}</td>
                <td className="hidden max-w-xs truncate px-5 py-3 text-muted-foreground lg:table-cell">{l.notes}</td>
                <td className="px-5 py-3 text-right text-muted-foreground">{l.created} ago</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


export default Page;
