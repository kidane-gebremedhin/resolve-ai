'use client';

import { useState } from "react";
import { Plus, Globe, Copy, Settings as SettingsIcon, Trash2, ExternalLink, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Site = { id: string; domain: string; status: "active" | "paused"; convos: number; leads: number; created: string; apiKey: string };

const sites: Site[] = [
  { id: "w1", domain: "northwind.io", status: "active", convos: 1284, leads: 67, created: "Mar 2025", apiKey: "hl_live_8f3c2a91…" },
  { id: "w2", domain: "shop.northwind.io", status: "active", convos: 612, leads: 34, created: "Apr 2025", apiKey: "hl_live_2b91d7c4…" },
  { id: "w3", domain: "docs.northwind.io", status: "paused", convos: 88, leads: 3, created: "May 2025", apiKey: "hl_live_e1f0a823…" },
];

function Page() {
  const [q, setQ] = useState("");
  const filtered = sites.filter((s) => s.domain.includes(q.toLowerCase()));
  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Websites</h1>
          <p className="mt-1 text-sm text-muted-foreground">Domains connected to your workspace. Each has its own widget and API key.</p>
        </div>
        <Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> Add website</Button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search domains…" className="h-9 pl-8" />
        </div>
        <div className="text-xs text-muted-foreground">{filtered.length} of {sites.length} sites</div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((s) => (
          <div key={s.id} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted">
                  <Globe className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-medium">{s.domain}</div>
                  <div className="text-[11px] text-muted-foreground">Added {s.created}</div>
                </div>
              </div>
              <Badge variant={s.status === "active" ? "default" : "secondary"} className="capitalize">{s.status}</Badge>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md bg-surface p-3">
                <div className="text-[11px] text-muted-foreground">Conversations</div>
                <div className="mt-1 font-display text-lg font-semibold">{s.convos.toLocaleString()}</div>
              </div>
              <div className="rounded-md bg-surface p-3">
                <div className="text-[11px] text-muted-foreground">Leads</div>
                <div className="mt-1 font-display text-lg font-semibold">{s.leads}</div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5">
              <code className="flex-1 truncate font-mono text-[11px] text-muted-foreground">{s.apiKey}</code>
              <button className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:text-foreground"><Copy className="h-3.5 w-3.5" /></button>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1.5"><SettingsIcon className="h-3.5 w-3.5" /> Settings</Button>
              <Button size="sm" variant="ghost" className="gap-1.5"><ExternalLink className="h-3.5 w-3.5" /> Visit</Button>
              <Button size="sm" variant="ghost" className="ml-auto text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


export default Page;
