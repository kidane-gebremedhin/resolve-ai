import { Suspense } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { BarChart, Sparkline } from "@/components/charts";
import { getActiveWebsiteId } from "@/lib/website-scope";
import { AnalyticsFilters } from "./analytics-filters";

type Website = { _id: string; name: string; domain: string };

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

type ConvDailyPoint = { date: string; total: number; resolved: number; aiResolved: number; escalated: number };
type ConvDailyResponse = { points: ConvDailyPoint[]; days: number };

type FeedbackResponse = {
  csat: { total: number; avgStars: number | null; distribution: Record<string, number> };
  thumbs: { up: number; down: number; total: number };
  days: number;
};

type KnowledgeGap = {
  _id: string;
  agentId: string;
  question: string;
  queryUsed: string;
  maxKbScore: number;
  occurrenceCount: number;
  status: "open" | "addressed";
  updatedAt: string;
};
type KnowledgeGapsResponse = { items: KnowledgeGap[] };
type VolumeResponse = { messages: number; knowledgeSources: number; websiteScoped: boolean };

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

function starLabel(n: number): string {
  return "★".repeat(n) + "☆".repeat(5 - n);
}

async function Analytics({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const cookieWebsiteId = await getActiveWebsiteId();

  // URL param wins over cookie scope (allows deep-linking to a specific filter).
  const websiteId =
    typeof sp.websiteId === "string" && sp.websiteId ? sp.websiteId : (cookieWebsiteId ?? "");
  // Date range: prefer explicit from/to over days pill.
  const fromParam = typeof sp.from === "string" ? sp.from : "";
  const toParam = typeof sp.to === "string" ? sp.to : "";
  const isCustomRange = Boolean(fromParam && toParam);

  const daysRaw = typeof sp.days === "string" ? parseInt(sp.days, 10) : 30;
  const days = isCustomRange
    ? Math.ceil((new Date(toParam).getTime() - new Date(fromParam).getTime()) / (24 * 60 * 60 * 1000))
    : [7, 30, 90].includes(daysRaw) ? daysRaw : 30;

  // Build shared query string for all endpoints.
  const qs = new URLSearchParams();
  if (isCustomRange) {
    qs.set("from", fromParam);
    qs.set("to", toParam);
  } else {
    qs.set("days", String(days));
  }
  if (websiteId) qs.set("websiteId", websiteId);
  const qStr = qs.toString();

  let convos: Conversation[] = [];
  let usage: UsageResponse | null = null;
  let daily: DailyUsagePoint[] = [];
  let convDaily: ConvDailyPoint[] = [];
  let feedback: FeedbackResponse | null = null;
  let knowledgeGaps: KnowledgeGap[] = [];
  let volume: VolumeResponse | null = null;
  let websites: Website[] = [];
  let loadError: string | null = null;

  try {
    const convQs = new URLSearchParams({ limit: "200" });
    if (websiteId) convQs.set("websiteId", websiteId);

    const [list, u, dailyResp, convDailyResp, feedbackResp, gapsResp, volumeResp, wsResp] = await Promise.all([
      api.get<ConversationList>(`/conversations?${convQs.toString()}`),
      api.get<UsageResponse>("/billing/usage"),
      api.get<DailyUsageResponse>(`/billing/usage/daily?days=${days}`),
      api.get<ConvDailyResponse>(`/analytics/conversations-daily?${qStr}`).catch(() => ({ points: [] as ConvDailyPoint[], days })),
      api.get<FeedbackResponse>(`/analytics/feedback?${qStr}`).catch(() => null),
      // Knowledge gaps + volume now obey the date-range + website filters.
      api.get<KnowledgeGapsResponse>(`/analytics/knowledge-gaps?limit=10&${qStr}`).catch(() => ({ items: [] as KnowledgeGap[] })),
      api.get<VolumeResponse>(`/analytics/volume?${qStr}`).catch(() => null),
      api.get<Website[]>("/websites").catch(() => [] as Website[]),
    ]);
    convos = list.items;
    usage = u;
    daily = dailyResp.points;
    convDaily = convDailyResp.points;
    feedback = feedbackResp;
    knowledgeGaps = gapsResp.items;
    volume = volumeResp;
    websites = wsResp ?? [];
  } catch (e) {
    loadError = e instanceof ApiError ? e.message : "Failed to load analytics.";
  }

  // Use server-aggregated daily data when available, fall back to client-side.
  const conversationsDaily =
    convDaily.length > 0
      ? convDaily.map((p) => ({ date: p.date, value: p.total }))
      : [];
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

  // Message + KB-source volume, scoped to the selected date range + website (falls
  // back to org-wide billing usage if the volume endpoint is unavailable).
  const scopedMessages = volume?.messages ?? usage?.usage.messages.used ?? 0;
  const scopedKnowledgeSources = volume?.knowledgeSources ?? usage?.usage.knowledgeSources.used ?? 0;
  // When one website is selected, the "Websites" count is 1; otherwise the org total.
  const scopedWebsites = websiteId ? 1 : (usage?.usage.websites.used ?? 0);
  const rangeLabel = isCustomRange ? `${fromParam} – ${toParam}` : `last ${days} days`;

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Aggregated from the last {total} conversations{websiteId ? " for the selected website" : ""} · {days}-day window.
          </p>
        </div>
        <Suspense>
          <AnalyticsFilters
            websites={websites}
            activeWebsiteId={cookieWebsiteId}
          />
        </Suspense>
      </div>

      {loadError && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 md:grid-cols-4">
        {[
          { k: "Total conversations", v: total.toLocaleString(), d: `${byStatus.active} active` },
          { k: "AI resolution rate", v: pct(aiResolved, total), d: `${aiResolved} resolved by AI` },
          { k: "Avg messages / convo", v: avgMessages, d: `${totalMessages.toLocaleString()} messages` },
          {
            k: "Messages this period",
            v: scopedMessages.toLocaleString(),
            d: `${rangeLabel}${websiteId ? " · this website" : ""}`,
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
          <div className="font-display text-sm font-semibold">Volume</div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {rangeLabel}{websiteId ? " · selected website" : ""}. Team members is an org-wide total.
          </p>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Messages</dt>
              <dd className="font-medium">{scopedMessages.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Knowledge sources</dt>
              <dd className="font-medium">
                {scopedKnowledgeSources.toLocaleString()}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Websites</dt>
              <dd className="font-medium">{scopedWebsites.toLocaleString()}</dd>
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
            <div className="overflow-x-auto">
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
            </div>
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

      <div className="mt-6 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="font-display text-sm font-semibold">Knowledge gaps</div>
          <div className="text-[11px] text-muted-foreground">
            Questions where KB score &lt; 0.65 — top 10 by frequency
          </div>
        </div>
        {knowledgeGaps.length === 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground">
            No knowledge gaps detected yet. Gaps appear when customers ask questions the knowledge
            base can&apos;t answer confidently.
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Question</th>
                <th className="px-5 py-3 font-medium">Occurrences</th>
                <th className="px-5 py-3 font-medium">Max score</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {knowledgeGaps.map((g) => (
                <tr key={g._id} className="hover:bg-surface">
                  <td className="max-w-xs truncate px-5 py-3 font-medium" title={g.question}>
                    {g.question}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{g.occurrenceCount}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {g.maxKbScore.toFixed(2)}
                  </td>
                  <td className="px-5 py-3">
                    <Link
                      href={`/app/knowledge?prefill=${encodeURIComponent(g.question)}`}
                      className="text-xs text-primary hover:underline"
                    >
                      Add to KB
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* ---- Feeds teaser ---- */}
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="font-display text-sm font-semibold">
              CSAT — {isCustomRange ? `${fromParam} – ${toParam}` : `Last ${days} days`}
            </div>
            {feedback?.csat.total ? (
              <Link href="/app/feeds" className="text-[11px] text-muted-foreground underline hover:text-foreground">
                View all
              </Link>
            ) : null}
          </div>
          {!feedback || feedback.csat.total === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No CSAT ratings yet.{" "}
              <Link href="/app/feeds" className="underline hover:text-foreground">Open User Feedback</Link>
            </p>
          ) : (
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-display text-4xl font-semibold tracking-tight">
                {feedback.csat.avgStars?.toFixed(1) ?? "—"}
              </span>
              <span className="text-muted-foreground">/ 5</span>
              <span className="text-xs text-muted-foreground ml-1">
                ({feedback.csat.total} rating{feedback.csat.total === 1 ? "" : "s"})
              </span>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="font-display text-sm font-semibold">
              AI feedback — {isCustomRange ? `${fromParam} – ${toParam}` : `Last ${days} days`}
            </div>
            {feedback?.thumbs.total ? (
              <Link href="/app/feeds" className="text-[11px] text-muted-foreground underline hover:text-foreground">
                View all
              </Link>
            ) : null}
          </div>
          {!feedback || feedback.thumbs.total === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No thumbs feedback yet.{" "}
              <Link href="/app/feeds" className="underline hover:text-foreground">Open User Feedback</Link>
            </p>
          ) : (
            <div className="mt-6 flex items-center gap-6">
              <div className="flex flex-col items-center gap-1">
                <span className="text-3xl">👍</span>
                <span className="font-display text-2xl font-semibold">{feedback.thumbs.up}</span>
                <span className="text-xs text-muted-foreground">{pct(feedback.thumbs.up, feedback.thumbs.total)}</span>
              </div>
              <div className="h-12 w-px bg-border" />
              <div className="flex flex-col items-center gap-1">
                <span className="text-3xl">👎</span>
                <span className="font-display text-2xl font-semibold">{feedback.thumbs.down}</span>
                <span className="text-xs text-muted-foreground">{pct(feedback.thumbs.down, feedback.thumbs.total)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Analytics;

