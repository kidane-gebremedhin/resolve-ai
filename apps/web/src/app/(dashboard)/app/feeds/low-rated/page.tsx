import Link from "next/link";
import { ThumbsDown } from "lucide-react";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

type LowRatedItem = {
  _id: string;
  messageId: string;
  conversationId: string;
  reason: string | null;
  createdAt: string;
  messageContent: string | null;
};

async function fetchLowRated(days: number, websiteId: string): Promise<LowRatedItem[]> {
  const qs = new URLSearchParams({ days: String(days), limit: "100" });
  if (websiteId) qs.set("websiteId", websiteId);
  try {
    const res = await api.get<{ items: LowRatedItem[] }>(`/analytics/low-rated-answers?${qs.toString()}`);
    return res.items ?? [];
  } catch {
    return [];
  }
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default async function LowRatedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const daysRaw = typeof sp.days === "string" ? parseInt(sp.days, 10) : 30;
  const days = [7, 30, 90].includes(daysRaw) ? daysRaw : 30;
  const websiteId = typeof sp.websiteId === "string" ? sp.websiteId : "";
  const items = await fetchLowRated(days, websiteId);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border bg-muted">
          <ThumbsDown className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Low-rated answers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every AI answer a visitor marked thumbs-down in the last {days} days — with the exact reply and their reason.
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface/40 p-10 text-center text-sm text-muted-foreground">
          No low-rated answers in this period. 🎉
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it._id} className="rounded-xl border border-border bg-surface/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-950/40">
                  <ThumbsDown className="h-3 w-3" /> Thumbs down
                </span>
                <span className="text-xs text-muted-foreground">{fmt(it.createdAt)}</span>
              </div>
              {it.messageContent && (
                <div className="mt-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">AI answer</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm">{it.messageContent}</p>
                </div>
              )}
              {it.reason && (
                <div className="mt-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Visitor&apos;s reason</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{it.reason}</p>
                </div>
              )}
              <Link
                href={`/app/inbox/${it.conversationId}`}
                className="mt-3 inline-block text-xs font-medium text-primary hover:underline"
              >
                Open conversation →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
