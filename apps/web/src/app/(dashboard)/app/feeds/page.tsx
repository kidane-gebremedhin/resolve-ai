import { Suspense } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { AnalyticsFilters } from "@/app/(dashboard)/app/analytics/analytics-filters";

type Website = { _id: string; name: string; domain: string };

type FeedbackResponse = {
  csat: { total: number; avgStars: number | null; distribution: Record<string, number> };
  thumbs: { up: number; down: number; total: number };
  days: number;
};

type LowRatedItem = {
  _id: string;
  messageId: string;
  conversationId: string;
  reason: string | null;
  createdAt: string;
  messageContent: string | null;
};
type LowRatedResponse = { items: LowRatedItem[] };

function pct(used: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((used / total) * 100)}%`;
}

function periodLabel(days: number, from: string, to: string): string {
  if (from && to) {
    const f = new Date(from).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const t = new Date(to).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    return `${f} – ${t}`;
  }
  return `Last ${days} day${days === 1 ? "" : "s"}`;
}

async function FeedsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  const fromParam = typeof sp.from === "string" ? sp.from : "";
  const toParam = typeof sp.to === "string" ? sp.to : "";
  const isCustomRange = Boolean(fromParam && toParam);
  const daysRaw = typeof sp.days === "string" ? parseInt(sp.days, 10) : 30;
  const days = isCustomRange
    ? Math.ceil((new Date(toParam).getTime() - new Date(fromParam).getTime()) / (24 * 60 * 60 * 1000))
    : [7, 30, 90].includes(daysRaw) ? daysRaw : 30;

  const websiteId = typeof sp.websiteId === "string" ? sp.websiteId : "";

  const qs = new URLSearchParams();
  if (isCustomRange) {
    qs.set("from", fromParam);
    qs.set("to", toParam);
  } else {
    qs.set("days", String(days));
  }
  if (websiteId) qs.set("websiteId", websiteId);
  const qStr = qs.toString();

  const label = periodLabel(days, fromParam, toParam);

  let feedback: FeedbackResponse | null = null;
  let lowRated: LowRatedItem[] = [];
  let websites: Website[] = [];

  try {
    const [fbResp, lrResp, wsResp] = await Promise.all([
      api.get<FeedbackResponse>(`/analytics/feedback?${qStr}`).catch(() => null),
      api.get<LowRatedResponse>(`/analytics/low-rated-answers?${qStr}&limit=50`).catch(() => ({ items: [] as LowRatedItem[] })),
      api.get<Website[]>("/websites").catch(() => [] as Website[]),
    ]);
    feedback = fbResp;
    lowRated = lrResp.items;
    websites = wsResp ?? [];
  } catch {
    /* best-effort */
  }

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">User Feedback</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Customer satisfaction and AI message quality signals · {label}
          </p>
        </div>
        <Suspense>
          <AnalyticsFilters websites={websites} activeWebsiteId={websiteId || null} />
        </Suspense>
      </div>

      {/* ---- CSAT + Thumbs ---- */}
      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {/* CSAT */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="font-display text-sm font-semibold">CSAT — {label}</div>
            {feedback?.csat.total ? (
              <span className="text-[11px] text-muted-foreground">
                {feedback.csat.total} rating{feedback.csat.total === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          {!feedback || feedback.csat.total === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No CSAT ratings yet. Ratings are submitted by visitors after a conversation is resolved.
            </p>
          ) : (
            <>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-4xl font-semibold tracking-tight">
                  {feedback.csat.avgStars?.toFixed(1) ?? "—"}
                </span>
                <span className="text-muted-foreground">/ 5</span>
              </div>
              <div className="mt-4 space-y-2">
                {([5, 4, 3, 2, 1] as const).map((star) => {
                  const count = feedback.csat.distribution[star] ?? 0;
                  const p = feedback.csat.total > 0
                    ? Math.round((count / feedback.csat.total) * 100)
                    : 0;
                  return (
                    <div key={star} className="flex items-center gap-2 text-xs">
                      <span className="w-6 shrink-0 text-muted-foreground">{star}★</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-amber-400" style={{ width: `${p}%` }} />
                      </div>
                      <span className="w-8 text-right text-muted-foreground">{p}%</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Thumbs up/down */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="font-display text-sm font-semibold">AI message feedback — {label}</div>
            {feedback?.thumbs.total ? (
              <span className="text-[11px] text-muted-foreground">
                {feedback.thumbs.total} vote{feedback.thumbs.total === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          {!feedback || feedback.thumbs.total === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No thumbs feedback yet. Visitors can rate individual AI messages with thumbs up or down.
            </p>
          ) : (
            <>
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
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-green-500" style={{ width: pct(feedback.thumbs.up, feedback.thumbs.total) }} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Positive rate: {pct(feedback.thumbs.up, feedback.thumbs.total)}
              </p>
            </>
          )}
        </div>
      </div>

      {/* ---- Low Rated Answers ---- */}
      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="font-display text-sm font-semibold">Low Rated Answers</div>
          {lowRated.length > 0 && (
            <span className="text-[11px] text-muted-foreground">{lowRated.length} item{lowRated.length !== 1 ? "s" : ""}</span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          AI messages that received a thumbs-down. Review these to improve your knowledge base.
        </p>
        {lowRated.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No low-rated answers in this period.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {lowRated.map((item) => (
              <div key={item._id} className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-foreground leading-snug line-clamp-3">
                    {item.messageContent ?? <span className="italic text-muted-foreground">Message content unavailable</span>}
                  </p>
                  <Link
                    href={`/app/inbox/${item.conversationId}`}
                    className="ml-2 shrink-0 text-[11px] text-muted-foreground underline hover:text-foreground"
                  >
                    View
                  </Link>
                </div>
                {item.reason && (
                  <div className="mt-2 flex items-start gap-1.5">
                    <span className="mt-px text-red-500 text-xs">👎</span>
                    <p className="text-xs text-muted-foreground italic">&ldquo;{item.reason}&rdquo;</p>
                  </div>
                )}
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  {new Date(item.createdAt).toLocaleDateString(undefined, {
                    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                  })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default FeedsPage;
