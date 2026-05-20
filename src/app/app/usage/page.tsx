import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const meters = [
  { label: "AI messages", used: 14820, limit: 25000, unit: "" },
  { label: "API calls", used: 142_300, limit: 250_000, unit: "" },
  { label: "Storage", used: 2.4, limit: 10, unit: "GB" },
  { label: "Bandwidth", used: 28, limit: 100, unit: "GB" },
];

function Page() {
  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Usage</h1>
          <p className="mt-1 text-sm text-muted-foreground">Current billing period · resets Jun 1.</p>
        </div>
        <Button asChild size="sm" variant="outline"><Link href="/app/billing">Upgrade plan</Link></Button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {meters.map((m) => {
          const pct = Math.min(100, (m.used / m.limit) * 100);
          const over = pct > 85;
          return (
            <div key={m.label} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{m.label}</span>
                <span className="text-muted-foreground">{m.used.toLocaleString()}{m.unit} / {m.limit.toLocaleString()}{m.unit}</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${over ? "bg-warning" : "bg-foreground"}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{pct.toFixed(0)}% used</span>
                {over && <span className="inline-flex items-center gap-1 text-warning"><AlertCircle className="h-3 w-3" /> Nearing limit</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3 font-display text-sm font-semibold">Last 30 days</div>
        <div className="p-5">
          <div className="flex items-end gap-1.5">
            {Array.from({ length: 30 }).map((_, i) => {
              const h = 30 + Math.round(40 * Math.sin(i / 2) + (i % 5) * 8);
              return <div key={i} className="flex-1 rounded-t-sm bg-foreground/80" style={{ height: `${h}px` }} />;
            })}
          </div>
          <div className="mt-3 flex justify-between text-[10px] text-muted-foreground"><span>Apr 18</span><span>May 17</span></div>
        </div>
      </div>
    </div>
  );
}


export default Page;
