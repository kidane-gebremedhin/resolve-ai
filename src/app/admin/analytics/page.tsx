function Page() {
  return (
    <div className="container-page py-8">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Platform analytics</h1>
      <p className="mt-1 text-sm text-muted-foreground">Growth, retention, and feature usage across the platform.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {[
          ["Signups (30d)", "+1,284", "+18%"],
          ["LTV", "$684", "+4%"],
          ["NRR", "118%", "+3pp"],
        ].map(([k, v, d]) => (
          <div key={k} className="rounded-xl border border-border bg-card p-5">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="mt-1 font-display text-3xl font-semibold">{v}</div>
            <div className="mt-1 text-xs text-success">{d}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="font-display text-sm font-semibold">User acquisition</div>
          <div className="mt-4 flex items-end gap-1">
            {[20, 25, 28, 32, 30, 38, 42, 45, 51, 58, 64, 72].map((h, i) => (
              <div key={i} className="flex-1 rounded-t-sm bg-primary/80" style={{ height: `${h * 2}px` }} />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="font-display text-sm font-semibold">Feature usage</div>
          <ul className="mt-4 space-y-3 text-sm">
            {[
              ["AI agent", 92],
              ["Knowledge base", 78],
              ["Lead capture", 64],
              ["Widget customizer", 58],
              ["Live chat handoff", 41],
            ].map(([k, pct]) => (
              <li key={k as string}>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="text-foreground">{k}</span><span>{pct}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}


export default Page;
