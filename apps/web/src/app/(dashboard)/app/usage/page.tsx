import Link from "next/link";
import { AlertCircle, MessagesSquare, BookOpen, Globe, Users, DollarSign } from "lucide-react";
import { Button } from "@csb/ui";
import { api, ApiError } from "@/lib/api";
import { BarChart } from "@/components/charts";
import { UsageDaysFilter } from "./usage-days-filter";

type UsageResponse = {
  plan: "pro" | "business" | "enterprise" | null;
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

type CostResponse = {
  period: string;
  spentUsd: number;
  orgMonthlyLimitUsd: number;
  websiteMonthlyLimitUsd: number;
  plan: string | null;
};

type WebsiteCostItem = {
  websiteId: string;
  name: string;
  domain: string;
  spentUsd: number;
};

type WebsiteCostResponse = {
  period: string;
  websiteMonthlyLimitUsd: number;
  websites: WebsiteCostItem[];
};

type DailyCostPoint = { date: string; costUsd: number };
type DailyCostResponse = { points: DailyCostPoint[] };

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

function fmtUsd(val: number): string {
  return `$${val.toFixed(4)}`;
}

async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const daysParam = typeof sp.days === 'string' ? sp.days : '30';
  const days = Math.max(7, Math.min(90, Number(daysParam) || 30));

  let data: UsageResponse | null = null;
  let daily: DailyUsagePoint[] = [];
  let cost: CostResponse | null = null;
  let websiteCost: WebsiteCostResponse | null = null;
  let dailyCost: DailyCostPoint[] = [];
  let loadError: string | null = null;

  try {
    const [usage, dailyResp, costResp, websiteCostResp, dailyCostResp] = await Promise.all([
      api.get<UsageResponse>("/billing/usage"),
      api.get<DailyUsageResponse>(`/billing/usage/daily?days=${days}`),
      api.get<CostResponse>("/billing/usage/cost"),
      api.get<WebsiteCostResponse>("/billing/usage/cost/websites"),
      api.get<DailyCostResponse>(`/billing/usage/cost/daily?days=${days}`),
    ]);
    data = usage;
    daily = dailyResp.points;
    cost = costResp;
    websiteCost = websiteCostResp;
    dailyCost = dailyCostResp.points;
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

  const costPct =
    cost && cost.orgMonthlyLimitUsd > 0
      ? Math.min(100, (cost.spentUsd / cost.orgMonthlyLimitUsd) * 100)
      : 0;
  const costOverLimit = cost && cost.orgMonthlyLimitUsd > 0 && cost.spentUsd >= cost.orgMonthlyLimitUsd;
  const costNearLimit = costPct >= 75 && !costOverLimit;

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Usage</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data
              ? `Current billing period · ${periodLabel(data.period.start)} · plan: ${data.plan ?? "none"}`
              : "Loading current billing period…"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <UsageDaysFilter days={String(days)} />
          <Button asChild size="sm" variant="outline">
            <Link href="/app/billing">Upgrade plan</Link>
          </Button>
        </div>
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

      {(costOverLimit || costNearLimit) && (
        <div className={`mt-6 flex items-start gap-3 rounded-xl border p-4 text-sm ${
          costOverLimit
            ? "border-destructive/40 bg-destructive/5"
            : "border-warning/40 bg-warning/10"
        }`}>
          <AlertCircle className={`mt-0.5 h-4 w-4 ${costOverLimit ? "text-destructive" : "text-warning"}`} />
          <div className="flex-1">
            <div className="font-medium">
              {costOverLimit ? "Monthly AI budget exceeded" : "Approaching AI budget limit"}
            </div>
            <div className="text-xs text-muted-foreground">
              {costOverLimit
                ? "AI responses are paused until next month or you upgrade your plan."
                : `You've used ${costPct.toFixed(0)}% of your monthly AI budget.`}
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

      {/* ── USD Spending ── */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-semibold tracking-tight">AI Spending</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Estimated USD cost based on token usage this billing period.
        </p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {/* Org spend card */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-2 font-medium">
              <DollarSign className="h-4 w-4 text-muted-foreground" /> Organization spend
            </span>
            <span className="text-muted-foreground">
              {cost ? fmtUsd(cost.spentUsd) : "—"}
              {cost && cost.orgMonthlyLimitUsd > 0 ? ` / $${cost.orgMonthlyLimitUsd}` : ""}
            </span>
          </div>
          {cost && cost.orgMonthlyLimitUsd > 0 && (
            <>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${costOverLimit ? "bg-destructive" : costNearLimit ? "bg-warning" : "bg-foreground"}`}
                  style={{ width: `${Math.min(100, costPct)}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {costPct.toFixed(1)}% of monthly budget
              </div>
            </>
          )}
          {cost && cost.orgMonthlyLimitUsd === 0 && (
            <div className="mt-2 text-xs text-muted-foreground">No budget cap</div>
          )}
        </div>

        {/* Per-website spend */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Globe className="h-4 w-4 text-muted-foreground" /> Per-website spend
            {websiteCost && websiteCost.websiteMonthlyLimitUsd > 0 && (
              <span className="ml-auto text-muted-foreground font-normal">
                cap: ${websiteCost.websiteMonthlyLimitUsd}/mo
              </span>
            )}
          </div>
          {websiteCost && websiteCost.websites.length > 0 ? (
            <ul className="space-y-2">
              {websiteCost.websites.map((w) => {
                const wPct =
                  websiteCost.websiteMonthlyLimitUsd > 0
                    ? Math.min(100, (w.spentUsd / websiteCost.websiteMonthlyLimitUsd) * 100)
                    : 0;
                const wOver = websiteCost.websiteMonthlyLimitUsd > 0 && w.spentUsd >= websiteCost.websiteMonthlyLimitUsd;
                return (
                  <li key={w.websiteId}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate font-medium">{w.name || w.domain}</span>
                      <span className={`ml-2 shrink-0 ${wOver ? "text-destructive" : "text-muted-foreground"}`}>
                        {fmtUsd(w.spentUsd)}
                      </span>
                    </div>
                    {websiteCost.websiteMonthlyLimitUsd > 0 && (
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${wOver ? "bg-destructive" : "bg-foreground"}`}
                          style={{ width: `${wPct}%` }}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No AI spend recorded this period.</p>
          )}
        </div>
      </div>

      {/* Daily cost chart */}
      {dailyCost.length > 0 && (
        <div className="mt-6 rounded-xl border border-border bg-card p-5">
          <div className="font-display text-sm font-semibold">Daily AI cost (USD)</div>
          <p className="mt-1 text-xs text-muted-foreground">Estimated spend per day (last {days} days, UTC).</p>
          <div className="mt-4 text-foreground">
            <BarChart
              points={dailyCost.map((p) => ({ date: p.date, value: p.costUsd }))}
              height={160}
              valueLabel="USD per day"
            />
          </div>
        </div>
      )}

      {/* Daily message activity chart */}
      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-display text-sm font-semibold">Daily activity</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Messages per day (last {days} days, UTC).
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
