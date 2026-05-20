import { Plus, FileText, Globe, Code2 as GithubIcon, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const sources = [
  { icon: Globe, name: "help.northwind.io", type: "Website", articles: 142, status: "Synced 2m ago" },
  { icon: FileText, name: "Internal runbooks (Notion)", type: "Notion", articles: 38, status: "Synced 1h ago" },
  { icon: GithubIcon, name: "northwind/docs", type: "GitHub", articles: 86, status: "Synced 14m ago" },
];

const articles = [
  { title: "Refund policy for duplicate charges", views: 1284, csat: 4.9, updated: "2d" },
  { title: "Setting up Okta SSO", views: 932, csat: 4.7, updated: "5d" },
  { title: "API rate limits explained", views: 814, csat: 4.6, updated: "1w" },
  { title: "Cancelling your subscription", views: 642, csat: 4.8, updated: "3d" },
  { title: "Bulk import from CSV", views: 412, csat: 4.5, updated: "2w" },
  { title: "Webhook retry guarantees", views: 318, csat: 4.4, updated: "4d" },
];

function Knowledge() {
  return (
    <div className="container-page py-8">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Knowledge</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sources your AI agent learns from. Keep them fresh.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm"><Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" /> Suggest gaps</Button>
          <Button size="sm"><Plus className="mr-1.5 h-3.5 w-3.5" /> Add source</Button>
        </div>
      </div>

      <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
        {sources.map((s) => (
          <div key={s.name} className="bg-card p-5">
            <div className="flex items-center justify-between">
              <s.icon className="h-5 w-5 text-primary" strokeWidth={1.75} />
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">Active</span>
            </div>
            <div className="mt-4 font-display text-base font-semibold">{s.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">{s.type} · {s.articles} articles</div>
            <div className="mt-4 text-[11px] text-muted-foreground">{s.status}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="font-display text-sm font-semibold">Articles</div>
          <div className="relative w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search articles…" className="h-8 pl-8 text-sm" />
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Title</th>
              <th className="px-5 py-3 font-medium">Views (30d)</th>
              <th className="px-5 py-3 font-medium">CSAT</th>
              <th className="px-5 py-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {articles.map((a) => (
              <tr key={a.title} className="hover:bg-surface">
                <td className="px-5 py-3 font-medium">{a.title}</td>
                <td className="px-5 py-3 text-muted-foreground">{a.views.toLocaleString()}</td>
                <td className="px-5 py-3 text-muted-foreground">{a.csat}</td>
                <td className="px-5 py-3 text-muted-foreground">{a.updated} ago</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-xl border border-dashed border-border bg-surface/40 p-6">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <div className="font-display text-sm font-semibold">Knowledge gaps detected</div>
            <p className="mt-1 text-sm text-muted-foreground">
              The AI escalated 14 conversations this week about <span className="text-foreground">"refund timing for international cards"</span> — there's no article on this topic. Want to draft one?
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm">Draft with AI</Button>
              <Button size="sm" variant="outline">Dismiss</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
