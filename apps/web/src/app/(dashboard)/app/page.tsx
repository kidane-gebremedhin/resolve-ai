import Link from "next/link";
import { Bot, MessagesSquare, MessageSquare, Globe, Plus } from "lucide-react";
import { Button } from "@csb/ui";
import { api, ApiError } from "@/lib/api";
import { auth } from "@/lib/auth";
import { getActiveWebsiteId } from "@/lib/website-scope";

type Conversation = {
  _id: string;
  status: "active" | "escalated" | "resolved" | "expired";
  subject?: string;
  lastMessagePreview?: string;
  lastMessageAt?: string;
  messageCount?: number;
  resolvedBy?: "ai" | "operator" | "system" | null;
  createdAt?: string;
};

type ConversationList = { items: Conversation[]; nextCursor: string | null };

type Website = {
  _id: string;
  name: string;
  domain: string;
  isActive: boolean;
};

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

function relativeTime(iso: string | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  return `${days}d`;
}

async function Overview() {
  const session = await auth();
  const greetingName = session?.user?.name?.split(" ")[0] ?? "there";

  let convos: Conversation[] = [];
  let usage: UsageResponse | null = null;
  let websites: Website[] = [];
  let loadError: string | null = null;

  // Scope conversation stats to the selected website (null = All websites).
  const websiteId = await getActiveWebsiteId();
  const convosQs = new URLSearchParams({ limit: "200" });
  if (websiteId) convosQs.set("websiteId", websiteId);

  try {
    const [list, u, sites] = await Promise.all([
      api.get<ConversationList>(`/conversations?${convosQs.toString()}`),
      api.get<UsageResponse>("/billing/usage"),
      api.get<Website[]>("/websites"),
    ]);
    convos = list.items;
    usage = u;
    websites = sites;
  } catch (e) {
    loadError = e instanceof ApiError ? e.message : "Failed to load dashboard.";
  }

  const websitesCount = websites.length;

  const total = convos.length;
  const openCount = convos.filter(
    (c) => c.status === "active" || c.status === "escalated",
  ).length;
  const aiResolved = convos.filter(
    (c) => c.status === "resolved" && c.resolvedBy === "ai",
  ).length;
  const aiRate = total > 0 ? `${Math.round((aiResolved / total) * 100)}%` : "0%";
  // Sum messages across the scoped conversations so this metric obeys the
  // website filter just like "Open conversations" / "AI resolution rate".
  // (Org-wide billing usage stays the denominator/quota below.)
  const messagesThisPeriod = convos.reduce((sum, c) => sum + (c.messageCount ?? 0), 0);

  const recent = convos
    .slice()
    .sort((a, b) => {
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bt - at;
    })
    .slice(0, 10);

  return (
    <div className="container-page py-8">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Welcome back, {greetingName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s what your AI agent and team are handling.
          </p>
        </div>
        <Link
          href="/app/inbox"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Open inbox →
        </Link>
      </div>

      {loadError && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {!loadError && websitesCount === 0 && (
        <div className="mt-6 flex items-start gap-4 rounded-xl border border-dashed border-border bg-surface/60 p-5">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-foreground text-background">
            <Globe className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="font-display text-sm font-semibold">Add your first website</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Connect a domain so your AI agent can start handling conversations from the embedded
              widget.
            </p>
          </div>
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/app/websites">
              <Plus className="h-3.5 w-3.5" /> Add website
            </Link>
          </Button>
        </div>
      )}

      <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 md:grid-cols-3">
        {[
          {
            label: "Open conversations",
            value: openCount.toLocaleString(),
            sub: `${total} in the last window`,
            icon: MessagesSquare,
          },
          {
            label: "AI resolution rate",
            value: aiRate,
            sub: `${aiResolved} resolved by AI`,
            icon: Bot,
          },
          {
            label: "Messages this period",
            value: messagesThisPeriod.toLocaleString(),
            sub:
              usage && Number.isFinite(usage.usage.messages.limit)
                ? `of ${usage.usage.messages.limit.toLocaleString()}`
                : "Unlimited plan",
            icon: MessageSquare,
          },
        ].map((k) => (
          <div key={k.label} className="bg-card p-5">
            <div className="flex items-center justify-between text-muted-foreground">
              <k.icon className="h-4 w-4" />
            </div>
            <div className="mt-3 font-display text-3xl font-semibold tracking-tight">{k.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{k.label}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{k.sub}</div>
          </div>
        ))}
      </div>

      {websites.length > 0 && (
        <div className="mt-6 rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="font-display text-sm font-semibold">
              Websites <span className="text-muted-foreground">({websites.length})</span>
            </div>
            <Link
              href="/app/websites"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Manage
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {websites.map((w) => (
              <li key={w._id} className="flex items-center gap-3 px-5 py-3">
                <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{w.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{w.domain}</div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                    w.isActive
                      ? "bg-emerald-500/10 text-emerald-600"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {w.isActive ? "Active" : "Inactive"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="font-display text-sm font-semibold">Recent conversations</div>
          <Link
            href="/app/inbox"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            View all
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No conversations yet. Once the widget is installed, threads will show up here in
            real time.
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Subject</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Messages</th>
                <th className="px-5 py-3 font-medium text-right">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recent.map((r) => (
                <tr key={r._id} className="hover:bg-surface">
                  <td className="px-5 py-3 font-medium">
                    <Link href={`/app/inbox?c=${r._id}`} className="hover:underline">
                      {r.subject?.trim() || r.lastMessagePreview?.slice(0, 60) || "(no subject)"}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <StatusPill status={r.status} resolvedBy={r.resolvedBy ?? undefined} />
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{r.messageCount ?? 0}</td>
                  <td className="px-5 py-3 text-right text-muted-foreground">
                    {relativeTime(r.lastMessageAt)} ago
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({
  status,
  resolvedBy,
}: {
  status: Conversation["status"];
  resolvedBy?: "ai" | "operator" | "system";
}) {
  const label =
    status === "resolved" && resolvedBy === "ai"
      ? "AI handled"
      : status.charAt(0).toUpperCase() + status.slice(1);
  const tone: Record<Conversation["status"], string> = {
    active: "bg-primary/10 text-primary",
    escalated: "bg-warning/15 text-foreground",
    resolved: "bg-success/10 text-success",
    expired: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {label}
    </span>
  );
}

export default Overview;
