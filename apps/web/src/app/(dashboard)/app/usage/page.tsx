import Link from "next/link";
import { AlertCircle, MessagesSquare, BookOpen, Globe, Users } from "lucide-react";
import { Button } from "@csb/ui";
import { api, ApiError } from "@/lib/api";
import { BarChart } from "@/components/charts";

type UsageResponse = {
  plan: "free" | "starter" | "pro" | "enterprise";
  period: { start: string; end: string | null };
  usage: {
    messages: { used: number; limit: number };
    knowledgeSources: { used: number; limit: number };
    websites: { used: number; limit: number };
    teamMembers: { used: number; limit: number };
  };
};

type DailyUsagePoint = { date: string; messages: number; knowledgeIngested: number };
type DailyUsageResponse = { points: DailyUsagePoint[] };

type MeterKey = keyof UsageResponse["usage"];

const METER_LABELS: Record<MeterKey, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  messages: { label: "AI messages", icon: MessagesSquare },
  knowledgeSources: { label: "Knowledge sources", icon: BookOpen },
  websites: { label: "Websites", icon: Globe },
  teamMembers: { label: "Team members", icon: Users },
};

function formatLimit(limit: number): string {
  if (!Number.isFinite(limit)) return "∞";
  return limit.toLocaleString();
}

function periodLabel(startIso: string): string {
  const start = new Date(startIso);
  return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

async function Page() {
  let data: UsageResponse | null = null;
  let daily: DailyUsagePoint[] = [];
  let loadError: string | null = null;
  try {
    const [usage, dailyResp] = await Promise.all([
      api.get<UsageResponse>("/billing/usage"),
      api.get<DailyUsageResponse>("/billing/usage/daily?days=30"),
    ]);
    data = usage;
    daily = dailyResp.points;
  } catch (e) {
    loadError = e instanceof ApiError ? e.message : "Failed to load usage.";
  }
  const dailyTotal = daily.reduce((sum, p) => sum + p.messages, 0);
  const dailyAvg = daily.length > 0 ? Math.round(dailyTotal / daily.length) : 0;
  const dailyPeak = daily.reduce((max, p) => (p.messages > max ? p.messages : max), 0);

  const meterKeys: MeterKey[] = ["messages", "knowledgeSources", "websites", "teamMembers"];
  const anyOverEighty =
    data &&
    meterKeys.some((k) => {
      const m = data!.usage[k];
      if (!Number.isFinite(m.limit) || m.limit <= 0) return false;
      return m.used / m.limit > 0.8;
    });

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Usage</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data
              ? `Current billing period · ${periodLabel(data.period.start)} · plan: ${data.plan}`
              : "Loading current billing period…"}
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/app/billing">Upgrade plan</Link>
        </Button>
      </div>

      {loadError && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {anyOverEighty && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 text-warning" />
          <div className="flex-1">
            <div className="font-medium">You&apos;re close to a limit</div>
            <div className="text-xs text-muted-foreground">
              One or more meters is above 80% used. Upgrade to keep things running smoothly.
            </div>
          </div>
          <Button asChild size="sm">
            <Link href="/app/billing">Upgrade</Link>
          </Button>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {meterKeys.map((key) => {
          const meta = METER_LABELS[key];
          const m = data?.usage[key];
          const limit = m?.limit ?? 0;
          const used = m?.used ?? 0;
          const finiteLimit = Number.isFinite(limit) && limit > 0;
          const pct = finiteLimit ? Math.min(100, (used / limit) * 100) : 0;
          const over = pct > 85;
          const Icon = meta.icon;
          return (
            <div key={key} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-2 font-medium">
                  <Icon className="h-4 w-4 text-muted-foreground" /> {meta.label}
                </span>
                <span className="text-muted-foreground">
                  {used.toLocaleString()} / {formatLimit(limit)}
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${over ? "bg-warning" : "bg-foreground"}`}
                  style={{ width: `${finiteLimit ? pct : 4}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {finiteLimit ? `${pct.toFixed(0)}% used` : "Unlimited"}
                </span>
                {over && (
                  <span className="inline-flex items-center gap-1 text-warning">
                    <AlertCircle className="h-3 w-3" /> Nearing limit
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-display text-sm font-semibold">Daily activity</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Messages per day (last 30 days, UTC).
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{dailyTotal.toLocaleString()}</span>{" "}
              total
            </span>
            <span>
              <span className="font-medium text-foreground">{dailyAvg.toLocaleString()}</span> avg/day
            </span>
            <span>
              <span className="font-medium text-foreground">{dailyPeak.toLocaleString()}</span> peak
            </span>
          </div>
        </div>
        <div className="mt-4 text-foreground">
          {daily.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface/40 px-4 py-10 text-center text-xs text-muted-foreground">
              No activity recorded yet for this organization.
            </div>
          ) : (
            <BarChart
              points={daily.map((p) => ({ date: p.date, value: p.messages }))}
              height={180}
              valueLabel="messages per day"
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default Page;
