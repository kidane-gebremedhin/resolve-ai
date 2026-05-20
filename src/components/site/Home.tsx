import { Link } from "@tanstack/react-router";
import { ArrowRight, Bot, Inbox, BarChart3, Zap, ShieldCheck, Sparkles, Check, Quote } from "lucide-react";
import { motion } from "framer-motion";
import { MarketingShell } from "@/components/site/MarketingShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const stats = [
  { v: "68%", k: "tickets auto-resolved" },
  { v: "1.2s", k: "avg. AI first reply" },
  { v: "4.9★", k: "CSAT after AI handoff" },
  { v: "92%", k: "intent accuracy" },
];

const logos = ["Linear", "Notion", "Vercel", "Ramp", "Loom", "Figma"];

const features = [
  { icon: Bot, title: "AI Resolution Agent", desc: "Trained on your docs, help center and past tickets. Cites sources, knows when to escalate." },
  { icon: Inbox, title: "Unified Inbox", desc: "Email, chat, WhatsApp, Slack and API in one calm queue with smart prioritization." },
  { icon: Sparkles, title: "Reply Copilot", desc: "Drafts, tone shifts and translation in 92 languages — agents stay one keystroke ahead." },
  { icon: BarChart3, title: "Insight Engine", desc: "Auto-tagged conversations surface trends, breakages and product gaps in real time." },
  { icon: Zap, title: "Workflow Automations", desc: "Triggers, SLAs, routing and macros — visual builder, no engineer required." },
  { icon: ShieldCheck, title: "Enterprise Trust", desc: "SOC 2 Type II, GDPR, EU data residency, RBAC and audit logs out of the box." },
];

export function Home() {
  return (
    <MarketingShell>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 grid-bg opacity-70" aria-hidden />
        <div className="container-page relative grid gap-12 py-20 md:grid-cols-12 md:py-28">
          <div className="md:col-span-7">
            <Badge variant="outline" className="rounded-full border-border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-success" /> New · Resolution Agent v3
            </Badge>
            <h1 className="mt-5 text-balance font-display text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
              Customer support that resolves itself.
            </h1>
            <p className="mt-5 max-w-xl text-balance text-lg text-muted-foreground">
              Helio is the AI support platform built for modern websites — an intelligent agent on the front, a calm inbox in the back, and analytics that actually move the needle.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to="/app">
                  Try the live dashboard <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/features">See how it works</Link>
              </Button>
            </div>
            <div className="mt-8 flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex -space-x-2">
                {[0,1,2,3].map((i) => (
                  <div key={i} className="h-6 w-6 rounded-full border-2 border-background bg-muted" style={{ background: `oklch(${0.7 - i*0.08} 0.05 ${240 + i*30})` }} />
                ))}
              </div>
              Trusted by 4,200+ support teams
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="md:col-span-5"
          >
            <ChatPreview />
          </motion.div>
        </div>

        {/* Logo strip */}
        <div className="border-t border-border bg-surface/60">
          <div className="container-page flex flex-wrap items-center justify-between gap-x-10 gap-y-4 py-6">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Powering support at</span>
            <div className="flex flex-wrap items-center gap-x-10 gap-y-3">
              {logos.map((l) => (
                <span key={l} className="font-display text-sm font-semibold text-muted-foreground/90">{l}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b border-border">
        <div className="container-page grid grid-cols-2 gap-6 py-12 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.k}>
              <div className="font-display text-3xl font-semibold tracking-tight md:text-4xl">{s.v}</div>
              <div className="mt-1 text-sm text-muted-foreground">{s.k}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="border-b border-border">
        <div className="container-page py-20">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">Platform</div>
            <h2 className="mt-3 text-balance font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Everything Zendesk, Intercom and Zoho do — rebuilt around an AI agent.
            </h2>
            <p className="mt-4 text-muted-foreground">
              We studied the leaders, kept the workflows that actually save time, and let an LLM do the rest.
            </p>
          </div>

          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="bg-card p-6">
                <f.icon className="h-5 w-5 text-primary" strokeWidth={1.75} />
                <h3 className="mt-4 font-display text-base font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section className="border-b border-border bg-surface/60">
        <div className="container-page py-20">
          <div className="flex items-end justify-between gap-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">Helio vs the field</div>
              <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-4xl">An honest comparison.</h2>
            </div>
            <Link to="/features" className="hidden text-sm text-muted-foreground hover:text-foreground md:inline-flex">
              See full breakdown →
            </Link>
          </div>

          <div className="mt-10 overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left">
                <tr className="text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Capability</th>
                  <th className="px-5 py-3 font-medium">Helio</th>
                  <th className="px-5 py-3 font-medium">Intercom</th>
                  <th className="px-5 py-3 font-medium">Zendesk</th>
                  <th className="px-5 py-3 font-medium">Zoho Desk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  ["AI agent with source citations", true, true, false, false],
                  ["Native multi-channel inbox", true, true, true, true],
                  ["Reply copilot in 90+ languages", true, true, false, true],
                  ["Visual workflow builder", true, false, true, true],
                  ["Transparent usage-based pricing", true, false, false, false],
                  ["Setup in under 10 minutes", true, false, false, false],
                ].map(([cap, ...vals]) => (
                  <tr key={cap as string}>
                    <td className="px-5 py-3 font-medium">{cap as string}</td>
                    {vals.map((v, i) => (
                      <td key={i} className="px-5 py-3">
                        {v ? (
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-success/10 text-success">
                            <Check className="h-3 w-3" />
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Testimonial */}
      <section className="border-b border-border">
        <div className="container-page grid gap-10 py-20 md:grid-cols-12">
          <div className="md:col-span-5">
            <Quote className="h-6 w-6 text-primary" />
            <p className="mt-4 font-display text-2xl font-medium leading-snug tracking-tight md:text-3xl">
              “We deflected 71% of tier-1 tickets in the first month. CSAT actually went up.”
            </p>
            <div className="mt-6 flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-muted" />
              <div>
                <div className="text-sm font-medium">Maya Okafor</div>
                <div className="text-xs text-muted-foreground">VP Support, Northwind</div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:col-span-7">
            {[
              { v: "−43%", k: "Median handle time" },
              { v: "+18", k: "NPS points in Q1" },
              { v: "24/7", k: "Coverage, no extra hires" },
              { v: "11min", k: "Time to first deploy" },
            ].map((s) => (
              <div key={s.k} className="bg-card p-6">
                <div className="font-display text-2xl font-semibold tracking-tight">{s.v}</div>
                <div className="mt-1 text-sm text-muted-foreground">{s.k}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="container-page py-20">
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl border border-border bg-card p-10 md:flex-row md:items-center">
            <div>
              <h3 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">Ready to give your support team a brain?</h3>
              <p className="mt-2 text-muted-foreground">No credit card. Live demo dashboard with sample data.</p>
            </div>
            <div className="flex gap-3">
              <Button asChild size="lg"><Link to="/app">Open dashboard</Link></Button>
              <Button asChild size="lg" variant="outline"><Link to="/contact">Talk to sales</Link></Button>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

function ChatPreview() {
  return (
    <div className="relative">
      <div className="absolute -inset-6 -z-10 dot-bg opacity-60" aria-hidden />
      <div className="rounded-2xl border border-border bg-card p-3 shadow-[0_30px_60px_-30px_rgba(15,23,42,0.25)]">
        <div className="flex items-center justify-between rounded-t-xl border-b border-border bg-surface px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-foreground text-background grid place-items-center text-[10px] font-semibold">H</div>
            <div>
              <div className="text-xs font-medium">Helio · Northwind support</div>
              <div className="text-[10px] text-success">● Online · replies in seconds</div>
            </div>
          </div>
          <span className="text-[10px] text-muted-foreground">AI</span>
        </div>
        <div className="space-y-3 p-4">
          <Bubble who="user">My invoice from March doesn't show the VAT line — can you re-issue it?</Bubble>
          <Bubble who="ai">
            I can re-issue invoice <span className="font-mono text-xs">#NW-3140</span> with the correct VAT breakdown. Send it to the email on file (m.okafor@northwind.io)?
            <div className="mt-2 flex flex-wrap gap-2">
              <Pill>Yes, re-issue</Pill>
              <Pill>Send to a different email</Pill>
              <Pill>Talk to a human</Pill>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="rounded bg-muted px-1.5 py-0.5">Source</span>
              billing-policy.md · §4.2
            </div>
          </Bubble>
          <Bubble who="user">Yes, re-issue please.</Bubble>
          <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
            <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            Helio is drafting a reply…
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({ who, children }: { who: "user" | "ai"; children: React.ReactNode }) {
  const isUser = who === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
          isUser
            ? "bg-foreground text-background rounded-br-md"
            : "bg-muted text-foreground rounded-bl-md"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <button className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground hover:bg-surface">
      {children}
    </button>
  );
}
