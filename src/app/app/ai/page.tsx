'use client';

import { useState } from "react";
import { Sparkles, FileText, MessageSquare, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const tones = ["Professional", "Friendly", "Casual", "Concise"] as const;
const models = [
  { id: "g3-flash", name: "Gemini 3 Flash", note: "Fast, default" },
  { id: "gpt-5", name: "GPT-5", note: "Best reasoning" },
  { id: "g3-pro", name: "Gemini 3 Pro", note: "Highest quality" },
];

function Page() {
  const [tone, setTone] = useState<(typeof tones)[number]>("Friendly");
  const [model, setModel] = useState("g3-flash");

  return (
    <div className="container-page py-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">AI agent</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tune personality, choose a model, and manage what the AI knows about your product.</p>
      </div>

      <Tabs defaultValue="personality" className="mt-6">
        <TabsList>
          <TabsTrigger value="personality">Personality</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="model">Model</TabsTrigger>
          <TabsTrigger value="fallback">Fallbacks</TabsTrigger>
        </TabsList>

        <TabsContent value="personality" className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tone</Label>
              <div className="mt-3 flex flex-wrap gap-2">
                {tones.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTone(t)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      tone === t ? "border-foreground bg-foreground text-background" : "border-border bg-background hover:bg-muted"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <Label htmlFor="instr" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Custom instructions</Label>
              <Textarea id="instr" rows={6} className="mt-3 font-mono text-xs" defaultValue={`You are Helio, the AI support agent for Northwind. Always cite the source article. If asked about pricing, link to /pricing. If you don't know, hand off to a human.`} />
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <Label htmlFor="greet" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Greeting</Label>
              <Input id="greet" className="mt-3" defaultValue="Hi there 👋 I'm Helio. What can I help you find today?" />
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Behavior</div>
              <div className="mt-4 space-y-3 text-sm">
                {[
                  ["Always offer human handoff", true],
                  ["Use emojis sparingly", true],
                  ["Match customer language", true],
                  ["Allow follow-up questions", false],
                ].map(([label, v]) => (
                  <div key={label as string} className="flex items-center justify-between">
                    <span>{label}</span>
                    <Switch defaultChecked={v as boolean} />
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-5 text-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" /> Preview
              </div>
              <div className="mt-3 rounded-lg bg-surface p-3 text-sm">
                <span className="text-muted-foreground">{tone}: </span>
                Hey! Looks like you were charged twice — I can fix that in seconds. Want me to refund the duplicate?
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="knowledge" className="mt-6">
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="font-display text-sm font-semibold">Sources</div>
              <Button size="sm" className="gap-2"><Plus className="h-4 w-4" /> Add source</Button>
            </div>
            <ul className="divide-y divide-border">
              {[
                { name: "Help Center sitemap", type: "URL crawl", count: "184 pages", icon: MessageSquare },
                { name: "Product handbook v3.pdf", type: "PDF", count: "62 pages", icon: FileText },
                { name: "Pricing FAQ", type: "Manual", count: "14 entries", icon: FileText },
              ].map((s) => (
                <li key={s.name} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <s.icon className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-[11px] text-muted-foreground">{s.type} · {s.count}</div>
                  </div>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>

        <TabsContent value="model" className="mt-6 grid gap-3 sm:grid-cols-3">
          {models.map((m) => (
            <button
              key={m.id}
              onClick={() => setModel(m.id)}
              className={`rounded-xl border p-4 text-left transition ${model === m.id ? "border-foreground bg-card ring-1 ring-foreground" : "border-border bg-card hover:bg-surface"}`}
            >
              <div className="font-display text-sm font-semibold">{m.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{m.note}</div>
            </button>
          ))}
        </TabsContent>

        <TabsContent value="fallback" className="mt-6">
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Fallback message</Label>
              <Textarea className="mt-2" rows={3} defaultValue="I'll loop in a teammate — usually within a few minutes during business hours." />
            </div>
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Escalation email</Label>
              <Input className="mt-2" defaultValue="support@northwind.io" />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}


export default Page;
