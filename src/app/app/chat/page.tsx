'use client';

import { useState } from "react";
import { Send, Bot, User, Globe, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Msg = { from: "ai" | "user" | "agent"; text: string; time: string };
type Session = { id: string; name: string; site: string; status: "Active" | "AI" | "Resolved"; preview: string; updated: string; messages: Msg[] };

const sessions: Session[] = [
  { id: "s1", name: "Visitor · IP 91.…", site: "northwind.io", status: "Active", preview: "I'm comparing you with Intercom…", updated: "now", messages: [
    { from: "user", text: "Hey, I'm comparing Helio vs Intercom. Big differences?", time: "10:24" },
    { from: "ai", text: "Great question. Helio's AI agent resolves 70%+ on average and pricing scales by usage, not seats. Want a quick side-by-side?", time: "10:24" },
    { from: "user", text: "Yes please.", time: "10:25" },
  ]},
  { id: "s2", name: "Anya Petrov", site: "northwind.io", status: "AI", preview: "Hitting 429s on /v2/orders…", updated: "6m", messages: [
    { from: "user", text: "Hitting 429s on /v2/orders even though we're on Growth.", time: "10:18" },
    { from: "ai", text: "Looking at your usage — you're at 4.8k req/min, cap is 5k. I can bump you to Pro burst limits.", time: "10:18" },
  ]},
  { id: "s3", name: "Sam Reyes", site: "docs.northwind.io", status: "Resolved", preview: "SSO loop fixed, thanks!", updated: "1h", messages: [
    { from: "user", text: "SSO loop after we enabled Okta.", time: "09:02" },
    { from: "agent", text: "Disable the legacy IDP toggle in settings — done.", time: "09:12" },
    { from: "user", text: "Fixed, thanks!", time: "09:13" },
  ]},
];

function Page() {
  const [activeId, setActiveId] = useState("s1");
  const active = sessions.find((s) => s.id === activeId)!;
  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-w-0">
      <aside className="hidden w-80 shrink-0 flex-col border-r border-border bg-background md:flex">
        <div className="border-b border-border px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live chat</div>
          <div className="mt-1 text-sm">{sessions.filter((s) => s.status !== "Resolved").length} active sessions</div>
        </div>
        <ul className="flex-1 overflow-y-auto">
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => setActiveId(s.id)}
                className={`w-full border-b border-border px-4 py-3 text-left transition ${s.id === activeId ? "bg-surface" : "hover:bg-surface/60"}`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{s.name}</div>
                  <span className="text-[11px] text-muted-foreground">{s.updated}</span>
                </div>
                <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{s.preview}</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[10px]"><Globe className="h-2.5 w-2.5" /> {s.site}</Badge>
                  <Badge variant={s.status === "Resolved" ? "secondary" : "default"} className="px-1.5 py-0 text-[10px]">{s.status}</Badge>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border bg-background px-5 py-3">
          <div>
            <div className="text-sm font-semibold">{active.name}</div>
            <div className="text-[11px] text-muted-foreground">{active.site} · session {active.id}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline">Add note</Button>
            <Button size="sm">Take over</Button>
          </div>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto bg-surface/40 p-6">
          {active.messages.map((m, i) => {
            const mine = m.from === "ai" || m.from === "agent";
            return (
              <div key={i} className={`flex gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                {!mine && <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted"><User className="h-3.5 w-3.5" /></div>}
                <div className={`max-w-[68%] rounded-2xl px-3.5 py-2 text-sm ${mine ? "rounded-br-sm bg-foreground text-background" : "rounded-bl-sm bg-card border border-border"}`}>
                  {m.text}
                  <div className={`mt-1 flex items-center gap-1 text-[10px] ${mine ? "text-background/60" : "text-muted-foreground"}`}>
                    <Clock className="h-2.5 w-2.5" /> {m.time}
                  </div>
                </div>
                {mine && (
                  <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${m.from === "ai" ? "bg-primary text-primary-foreground" : "bg-foreground text-background"}`}>
                    {m.from === "ai" ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="border-t border-border bg-background p-3">
          <form className="flex items-center gap-2" onSubmit={(e) => e.preventDefault()}>
            <Input placeholder="Reply as agent…" className="h-10" />
            <Button size="sm" className="h-10 gap-2"><Send className="h-4 w-4" /> Send</Button>
          </form>
        </div>
      </section>
    </div>
  );
}


export default Page;
