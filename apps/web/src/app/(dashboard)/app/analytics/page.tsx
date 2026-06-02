import { api, ApiError } from "@/lib/api";
import { BarChart, Sparkline } from "@/components/charts";

type Conversation = {
  _id: string;
  status: "active" | "escalated" | "resolved" | "expired";
  subject?: string;
  messageCount?: number;
  resolvedBy?: "ai" | "operator" | "system" | null;
  lastMessageAt?: string;
  createdAt?: string;
};

type ConversationList = { items: Conversation[]; nextCursor: string | null };

type UsageResponse = {
  plan: string;
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

// Pad a UTC daily series of length `days` ending today.
function buildDailyConversations(convos: Conversation[], days: number): { date: string; value: number }[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const labels: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    labels.push(d.toISOString().slice(0, 10));
  }
  const buckets = new Map<string, number>(labels.map((l) => [l, 0]));
  for (const c of convos) {
    if (!c.createdAt) continue;
    const day = c.createdAt.slice(0, 10);
    if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  return labels.map((date) => ({ date, value: buckets.get(date) ?? 0 }));
}

function pct(used: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((used / total) * 100)}%`;
}

function topSubjects(items: Conversation[], top = 5): { subject: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of items) {
    const raw = (c.subject ?? "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([subject, count]) => ({ subject, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, top);
}

async function Analytics() {
  let convos: Conversation[] = [];
  let usage: UsageResponse | null = null;
  let daily: DailyUsagePoint[] = [];
  let loadError: string | null = null;

  try {
    const [list, u, dailyResp] = await Promise.all([
      api.get<ConversationList>("/conversations?limit=200"),
      api.get<UsageResponse>("/billing/usage"),
      api.get<DailyUsageResponse>("/billing/usage/daily?days=30"),
    ]);
    convos = list.items;
    usage = u;
    daily = dailyResp.points;
  } catch (e) {
    loadError = e instanceof ApiError ? e.message : "Failed to load analytics.";
  }

  const conversationsDaily = buildDailyConversations(convos, 30);
  const messagesDaily = daily.map((p) => ({ date: p.date, value: p.messages }));
  const messages30dTotal = messagesDaily.reduce((s, p) => s + p.value, 0);
  const convos30dTotal = conversationsDaily.reduce((s, p) => s + p.value, 0);

  const total = convos.length;
  const aiResolved = convos.filter(
    (c) => c.status === "resolved" && c.resolvedBy === "ai",
  ).length;
  const totalResolved = convos.filter((c) => c.status === "resolved").length;
  const totalMessages = convos.reduce((sum, c) => sum + (c.messageCount ?? 0), 0);
  const avgMessages = total > 0 ? (totalMessages / total).toFixed(1) : "0";

  const byStatus = {
    active: convos.filter((c) => c.status === "active").length,
    escalated: convos.filter((c) => c.status === "escalated").length,
    resolved: totalResolved,
    expired: convos.filter((c) => c.status === "expired").length,
  };

  const topics = topSubjects(convos, 5);

  const monthMessages = usage?.usage.messages.used ?? 0;
  const monthLimit = usage?.usage.messages.limit ?? 0;

  return (
    <div className="container-page py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Aggregated from the last {total} conversations and the current billing period.
          </p>
        </div>
      </div>

      {loadError && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
        {[
          { k: "Total conversations", v: total.toLocaleString(), d: `${byStatus.active} active` },
          { k: "AI resolution rate", v: pct(aiResolved, total), d: `${aiResolved} resolved by AI` },
          { k: "Avg messages / convo", v: avgMessages, d: `${totalMessages.toLocaleString()} messages` },
          {
            k: "Messages this period",
            v: monthMessages.toLocaleString(),
            d: Number.isFinite(monthLimit) ? `of ${monthLimit.toLocaleString()}` : "Unlimited plan",
          },
        ].map((s) => (
          <div key={s.k} className="bg-card p-5">
            <div className="text-xs text-muted-foreground">{s.k}</div>
            <div className="mt-2 font-display text-3xl font-semibold tracking-tight">{s.v}</div>
            <div className="mt-1 text-xs text-muted-foreground">{s.d}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="font-display text-sm font-semibold">Conversations by status</div>
            <div className="text-[11px] text-muted-foreground">
              {total} total, {byStatus.escalated} escalated
            </div>
          </div>
          <ul className="mt-5 space-y-3 text-sm">
            {(
              [
                ["Active", byStatus.active, "bg-primary"],
                ["Resolved", byStatus.resolved, "bg-success"],
                ["Escalated", byStatus.escalated, "bg-warning"],
                ["Expired", byStatus.expired, "bg-muted-foreground"],
              ] as const
            ).map(([label, count, color]) => {
              const p = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <li key={label}>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="text-foreground">{label}</span>
                    <span>
                      {count} · {p}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${p}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="font-display text-sm font-semibold">Monthly volume</div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Aggregated from billing usage for the current period.
          </p>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Messages</dt>
              <dd className="font-medium">{monthMessages.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Knowledge sources</dt>
              <dd className="font-medium">
                {usage?.usage.knowledgeSources.used.toLocaleString() ?? 0}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Websites</dt>
              <dd className="font-medium">{usage?.usage.websites.used.toLocaleString() ?? 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Team members</dt>
              <dd className="font-medium">{usage?.usage.teamMembers.used.toLocaleString() ?? 0}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card lg:col-span-2">
          <div className="border-b border-border px-5 py-3 font-display text-sm font-semibold">
            Trending subjects
          </div>
          {topics.length === 0 ? (
            <div className="px-5 py-8 text-sm text-muted-foreground">
              No conversation subjects yet. Subjects are extracted from recent threads as your
              widget collects more traffic.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Subject</th>
                  <th className="px-5 py-3 font-medium">Conversations</th>
                  <th className="px-5 py-3 font-medium">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topics.map((t) => (
                  <tr key={t.subject} className="hover:bg-surface">
                    <td className="px-5 py-3 font-medium capitalize">{t.subject}</td>
                    <td className="px-5 py-3 text-muted-foreground">{t.count}</td>
                    <td className="px-5 py-3 text-muted-foreground">{pct(t.count, total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="font-display text-sm font-semibold">Resolution breakdown</div>
          <div className="mt-5 space-y-2">
            {(
              [
                ["AI", aiResolved],
                ["Operator", convos.filter((c) => c.resolvedBy === "operator").length],
                ["System", convos.filter((c) => c.resolvedBy === "system").length],
                ["Unresolved", total - totalResolved],
              ] as const
            ).map(([label, count]) => {
              const p = total > 0 ? Math.round((count / total) * 100) : 0;
              return (
                <div key={label} className="flex items-center gap-3 text-xs">
                  <span className="w-20 text-muted-foreground">{label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-foreground" style={{ width: `${p}%` }} />
                  </div>
                  <span className="w-12 text-right text-muted-foreground">{p}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-dashed border-border bg-surface/40 p-5 text-xs text-muted-foreground">
        <div className="font-semibold text-foreground">API gaps</div>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>
            No time-series aggregation endpoint yet — KPIs are computed client-side from the most
            recent 200 conversations, so totals are capped at that window.
          </li>
          <li>
            CSAT and first-response-time aren&apos;t persisted on conversations. Once the API
            captures them, we&apos;ll surface trends here.
          </li>
          {/* TODO: replace the cards above with /analytics endpoints when available. */}
        </ul>
      </div>
    </div>
  );
}

export default Analytics;
