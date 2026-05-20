'use client';

import { useState } from "react";
import { Bot, Mail, MessageCircle, Phone, Filter, Sparkles, Send, Paperclip, Tag, MoreHorizontal, ArrowUpRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Conv = {
  id: string;
  customer: string;
  preview: string;
  channel: "Email" | "Chat" | "WhatsApp";
  status: "AI handled" | "Open" | "Pending" | "Snoozed";
  time: string;
  unread?: boolean;
  sentiment?: "positive" | "neutral" | "negative";
};

const conversations: Conv[] = [
  { id: "c1", customer: "Idris Khan", preview: "Got charged twice for the May invoice — can you check?", channel: "Email", status: "Open", time: "2m", unread: true, sentiment: "negative" },
  { id: "c2", customer: "Anya Petrov", preview: "Hitting 429s on /v2/orders even though we're on Growth.", channel: "Chat", status: "Open", time: "6m", unread: true, sentiment: "neutral" },
  { id: "c3", customer: "Sam Reyes", preview: "SSO loop after we enabled Okta. Can someone help?", channel: "Chat", status: "Pending", time: "11m", sentiment: "negative" },
  { id: "c4", customer: "Léa Martin", preview: "Re-issued invoice received, thanks Helio!", channel: "Email", status: "AI handled", time: "23m", sentiment: "positive" },
  { id: "c5", customer: "Hiro Tanaka", preview: "How do I cancel before the next billing date?", channel: "WhatsApp", status: "Open", time: "41m", sentiment: "neutral" },
  { id: "c6", customer: "Priya Singh", preview: "Can you walk me through bulk import?", channel: "Chat", status: "AI handled", time: "1h", sentiment: "positive" },
  { id: "c7", customer: "Tom Becker", preview: "Snoozed until tomorrow — waiting on engineering.", channel: "Email", status: "Snoozed", time: "3h", sentiment: "neutral" },
];

const channelIcon = { Email: Mail, Chat: MessageCircle, WhatsApp: Phone } as const;

function Inbox() {
  const [activeId, setActiveId] = useState("c1");
  const [filter, setFilter] = useState<"All" | "Open" | "AI handled">("All");
  const filtered = conversations.filter((c) => filter === "All" || c.status === filter);
  const active = conversations.find((c) => c.id === activeId)!;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-w-0">
      {/* List */}
      <section className="flex w-[340px] shrink-0 flex-col border-r border-border bg-background">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">Inbox</h2>
            <button className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground">
              <Filter className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-3 flex gap-1">
            {(["All", "Open", "AI handled"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                  filter === t ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.map((c) => {
            const Icon = channelIcon[c.channel];
            const isActive = c.id === activeId;
            return (
              <button
                key={c.id}
                onClick={() => setActiveId(c.id)}
                className={`flex w-full gap-3 border-b border-border px-4 py-3 text-left transition ${
                  isActive ? "bg-surface" : "hover:bg-surface/60"
                }`}
              >
                <div className="relative h-8 w-8 shrink-0 rounded-full bg-muted grid place-items-center text-[11px] font-semibold">
                  {c.customer.split(" ").map((n) => n[0]).join("")}
                  {c.unread && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-sm ${c.unread ? "font-semibold" : "font-medium"}`}>{c.customer}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{c.time}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted-foreground">{c.preview}</p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      <Icon className="h-2.5 w-2.5" /> {c.channel}
                    </span>
                    <StatusDot status={c.status} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Conversation */}
      <section className="flex min-w-0 flex-1 flex-col bg-background">
        <div className="flex items-center justify-between border-b border-border px-6 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-display text-base font-semibold">{active.customer}</h2>
              <StatusPill status={active.status} />
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{active.preview.slice(0, 60)}…</div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline">Snooze</Button>
            <Button size="sm" variant="outline">Assign</Button>
            <Button size="sm">Resolve</Button>
            <button className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
          <Message who="customer" name={active.customer} time="2m ago">
            Hey team — got charged twice for invoice #NW-3140 (May). One charge cleared on the 4th, the second on the 6th. Can you confirm and refund the duplicate?
          </Message>
          <Message who="ai" name="Helio AI" time="2m ago">
            <div>
              I see two successful charges of <span className="font-mono text-xs">$148.00</span> on May 4 and May 6 against invoice <span className="font-mono text-xs">#NW-3140</span>. The second was triggered by a retried webhook. I can refund it to your card ending <span className="font-mono text-xs">•• 4242</span> immediately — confirm and I'll process it.
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5">Source</span>
              <span>billing-policy.md · §4.2</span>
              <span className="rounded bg-muted px-1.5 py-0.5">Tool</span>
              <span>stripe.refund_charge</span>
            </div>
          </Message>
          <Message who="customer" name={active.customer} time="just now">
            Yes please refund it. Thanks for the quick check.
          </Message>

          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-surface/60 px-4 py-2.5 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Helio drafted a reply. Review and send, or rewrite.
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-border bg-background p-4">
          <div className="rounded-xl border border-border bg-card">
            <textarea
              defaultValue="Refund of $148.00 has been issued to your card ending 4242. You'll see it back in 3–5 business days. I've also added a guard to prevent the duplicate webhook from triggering again — apologies for the inconvenience."
              className="w-full resize-none rounded-t-xl bg-transparent p-3 text-sm focus:outline-none"
              rows={4}
            />
            <div className="flex items-center justify-between border-t border-border px-3 py-2">
              <div className="flex items-center gap-1">
                <IconBtn label="Attach"><Paperclip className="h-4 w-4" /></IconBtn>
                <IconBtn label="Tag"><Tag className="h-4 w-4" /></IconBtn>
                <IconBtn label="AI rewrite"><Sparkles className="h-4 w-4 text-primary" /></IconBtn>
              </div>
              <Button size="sm"><Send className="mr-1.5 h-3.5 w-3.5" /> Send</Button>
            </div>
          </div>
        </div>
      </section>

      {/* Context panel */}
      <aside className="hidden w-[300px] shrink-0 flex-col border-l border-border bg-background lg:flex">
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-muted text-sm font-semibold">{active.customer.split(" ").map((n) => n[0]).join("")}</div>
            <div className="min-w-0">
              <div className="truncate font-display text-sm font-semibold">{active.customer}</div>
              <div className="truncate text-xs text-muted-foreground">idris@northwind.io</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
            <Meta k="Plan" v="Growth" />
            <Meta k="MRR" v="$890" />
            <Meta k="Account age" v="14 mo" />
            <Meta k="Tickets" v="9" />
          </div>
        </div>

        <div className="space-y-5 overflow-y-auto p-5">
          <Section title="AI summary">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Customer was charged twice for invoice <span className="font-mono">#NW-3140</span> due to a retried webhook. Refund of $148 staged. Sentiment: <span className="text-foreground">recovered → positive</span>.
            </p>
          </Section>
          <Section title="Suggested actions">
            <ul className="space-y-1.5 text-xs">
              {["Issue refund of $148 via Stripe", "Add internal note: webhook retry guard deployed", "Tag conversation as 'billing/duplicate'"].map((a) => (
                <li key={a} className="flex items-start gap-2 rounded-md border border-border bg-surface/60 px-2.5 py-2">
                  <ArrowUpRight className="mt-0.5 h-3 w-3 text-primary" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="SLA">
            <div className="flex items-center justify-between rounded-md border border-border bg-surface/60 px-3 py-2 text-xs">
              <span className="inline-flex items-center gap-1.5"><Clock className="h-3 w-3 text-success" /> First reply</span>
              <span className="font-medium text-success">on time · 2m</span>
            </div>
          </Section>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-border bg-surface/60 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className="mt-0.5 text-xs font-medium">{v}</div>
    </div>
  );
}

function Message({ who, name, time, children }: { who: "customer" | "ai" | "agent"; name: string; time: string; children: React.ReactNode }) {
  const isAI = who === "ai";
  return (
    <div className="flex gap-3">
      <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${isAI ? "bg-foreground text-background" : "bg-muted"}`}>
        {isAI ? <Bot className="h-4 w-4" /> : name.split(" ").map((n) => n[0]).join("")}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{name}</span>
          {isAI && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">AI</span>}
          <span className="text-[11px] text-muted-foreground">{time}</span>
        </div>
        <div className="mt-1.5 rounded-xl border border-border bg-card p-3.5 text-sm leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

function IconBtn({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <button title={label} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    "AI handled": "bg-success/10 text-success",
    "Open": "bg-primary/10 text-primary",
    "Pending": "bg-warning/15 text-foreground",
    "Snoozed": "bg-muted text-muted-foreground",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${map[status] ?? "bg-muted text-muted-foreground"}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" /> {status}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const color: Record<string, string> = {
    "AI handled": "bg-success",
    "Open": "bg-primary",
    "Pending": "bg-warning",
    "Snoozed": "bg-muted-foreground",
  };
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${color[status] ?? "bg-muted-foreground"}`} /> {status}
    </span>
  );
}
