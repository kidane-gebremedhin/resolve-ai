const channels = [
  { name: "Web chat", v: 1284, pct: 52 },
  { name: "Email", v: 612, pct: 25 },
  { name: "WhatsApp", v: 248, pct: 10 },
  { name: "Slack Connect", v: 173, pct: 7 },
  { name: "API", v: 142, pct: 6 },
];

const tags = [
  ["billing/duplicate", 38, "down"],
  ["sso/okta", 24, "up"],
  ["api/rate-limit", 18, "up"],
  ["refunds", 15, "down"],
  ["onboarding/import", 12, "flat"],
  ["mobile/crash-iOS17", 9, "up"],
] as const;

function Analytics() {
  return (
    <div className="container-page py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">Last 30 days · auto-refreshing</p>
        </div>
        <div className="flex gap-1 rounded-md border border-border bg-background p-0.5 text-xs">
          {["7d", "30d", "90d"].map((r, i) => (
            <button key={r} className={`rounded px-2.5 py-1 ${i === 1 ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>{r}</button>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
        {[
          { k: "Conversations", v: "2,459", d: "+8.4%" },
          { k: "AI deflection", v: "68%", d: "+4.2pp" },
          { k: "CSAT", v: "4.86", d: "+0.12" },
          { k: "Median FRT", v: "1.2s", d: "−0.3s" },
        ].map((s) => (
          <div key={s.k} className="bg-card p-5">
            <div className="text-xs text-muted-foreground">{s.k}</div>
            <div className="mt-2 font-display text-3xl font-semibold tracking-tight">{s.v}</div>
            <div className="mt-1 text-xs text-success">{s.d} vs prev period</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="font-display text-sm font-semibold">Resolution mix over time</div>
            <div className="flex gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-primary" /> AI</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-foreground" /> Human</span>
            </div>
          </div>
          <StackedBars />
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="font-display text-sm font-semibold">Channel mix</div>
          <ul className="mt-4 space-y-3 text-sm">
            {channels.map((c) => (
              <li key={c.name}>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="text-foreground">{c.name}</span>
                  <span>{c.v.toLocaleString()} · {c.pct}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-foreground" style={{ width: `${c.pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card lg:col-span-2">
          <div className="border-b border-border px-5 py-3 font-display text-sm font-semibold">Trending topics</div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-5 py-3 font-medium">Topic</th><th className="px-5 py-3 font-medium">Conversations</th><th className="px-5 py-3 font-medium">Trend</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tags.map(([t, v, d]) => (
                <tr key={t} className="hover:bg-surface">
                  <td className="px-5 py-3 font-mono text-[12.5px]">{t}</td>
                  <td className="px-5 py-3">{v}</td>
                  <td className={`px-5 py-3 text-xs ${d === "up" ? "text-destructive" : d === "down" ? "text-success" : "text-muted-foreground"}`}>
                    {d === "up" ? "▲ rising" : d === "down" ? "▼ cooling" : "— stable"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="font-display text-sm font-semibold">CSAT distribution</div>
          <div className="mt-5 space-y-2">
            {[
              [5, 76], [4, 14], [3, 5], [2, 3], [1, 2],
            ].map(([star, pct]) => (
              <div key={star} className="flex items-center gap-3 text-xs">
                <span className="w-4 text-muted-foreground">{star}★</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-8 text-right text-muted-foreground">{pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StackedBars() {
  const data = Array.from({ length: 30 }, (_, i) => {
    const ai = 14 + Math.round(Math.sin(i / 3) * 5) + (i % 4);
    const human = 6 + Math.round(Math.cos(i / 4) * 3) + (i % 3);
    return { ai, human };
  });
  const max = Math.max(...data.map((d) => d.ai + d.human));
  return (
    <div className="mt-5 flex h-44 items-end gap-1">
      {data.map((d, i) => (
        <div key={i} className="flex flex-1 flex-col-reverse gap-0.5">
          <div className="rounded-b-sm bg-foreground" style={{ height: `${(d.human / max) * 100}%` }} />
          <div className="rounded-t-sm bg-primary" style={{ height: `${(d.ai / max) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}
