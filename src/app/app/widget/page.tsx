'use client';

import { useState } from "react";
import {
  Copy, MessageSquare, Send, Sparkles, Paperclip, Smile,
  Minus, Bot, Check, Monitor, Smartphone, Code2, Palette,
  Type as TypeIcon, Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

const positions = [
  { id: "bottom-right", label: "Bottom right" },
  { id: "bottom-left", label: "Bottom left" },
] as const;

const colors = [
  "#0a0a0a", "#1e40af", "#0f766e", "#16a34a",
  "#ea580c", "#db2777", "#7c3aed", "#dc2626",
];

const avatarStyles = ["bot", "initial", "image"] as const;

function Page() {
  const [color, setColor] = useState(colors[0]);
  const [pos, setPos] = useState<(typeof positions)[number]["id"]>("bottom-right");
  const [title, setTitle] = useState("How can we help?");
  const [subtitle, setSubtitle] = useState("Typically reply in under 2 minutes");
  const [placeholder, setPlaceholder] = useState("Write a message…");
  const [agentName, setAgentName] = useState("Maya");
  const [radius, setRadius] = useState([16]);
  const [avatar, setAvatar] = useState<(typeof avatarStyles)[number]>("bot");
  const [showBranding, setShowBranding] = useState(true);
  const [showLauncherLabel, setShowLauncherLabel] = useState(false);
  const [launcherLabel, setLauncherLabel] = useState("Chat with us");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [copied, setCopied] = useState(false);

  const snippet = `<script>
  (function(w,d){
    w.HelioConfig = { apiKey: "hl_live_8f3c2a91…", color: "${color}", position: "${pos}" };
    var s = d.createElement("script");
    s.src = "https://cdn.helio.app/widget.js";
    s.async = 1;
    d.head.appendChild(s);
  })(window, document);
</script>`;

  const copy = async () => {
    try { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {}
  };

  const r = radius[0];
  const isBottom = pos.includes("bottom");
  const isRight = pos.includes("right");

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Widget studio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tune every detail — preview updates live. No code redeploy required.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-success" /> Connected · northwind.io</Badge>
          <Button size="sm">Publish changes</Button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* CONTROLS */}
        <div className="space-y-4">
          <Tabs defaultValue="design">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="design" className="gap-1.5"><Palette className="h-3.5 w-3.5" />Design</TabsTrigger>
              <TabsTrigger value="content" className="gap-1.5"><TypeIcon className="h-3.5 w-3.5" />Content</TabsTrigger>
              <TabsTrigger value="behavior" className="gap-1.5"><Settings2 className="h-3.5 w-3.5" />Behavior</TabsTrigger>
            </TabsList>

            <TabsContent value="design" className="mt-4 space-y-4">
              <div className="rounded-xl border border-border bg-card p-5">
                <Label className="text-xs font-medium">Accent color</Label>
                <div className="mt-2.5 grid grid-cols-8 gap-2">
                  {colors.map((c) => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={`group relative aspect-square rounded-md transition ${color === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-card" : "hover:scale-105"}`}
                      style={{ backgroundColor: c }}
                      aria-label={c}
                    >
                      {color === c && <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white mix-blend-difference" />}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-8 w-8 rounded-md border border-border" style={{ background: color }} />
                  <Input value={color} onChange={(e) => setColor(e.target.value)} className="h-8 font-mono text-xs" />
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Corner radius</Label>
                  <span className="font-mono text-xs text-muted-foreground">{r}px</span>
                </div>
                <Slider value={radius} onValueChange={setRadius} min={4} max={28} step={2} className="mt-3" />
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <Label className="text-xs font-medium">Launcher position</Label>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  {positions.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPos(p.id)}
                      className={`rounded-md border px-3 py-2 text-xs font-medium transition ${pos === p.id ? "border-foreground bg-foreground text-background" : "border-border bg-background hover:bg-muted"}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                <Label className="text-xs font-medium">Agent avatar</Label>
                <div className="grid grid-cols-3 gap-2">
                  {avatarStyles.map((a) => (
                    <button
                      key={a}
                      onClick={() => setAvatar(a)}
                      className={`rounded-md border px-3 py-2 text-xs capitalize transition ${avatar === a ? "border-foreground bg-foreground text-background" : "border-border bg-background hover:bg-muted"}`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="content" className="mt-4 space-y-4">
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div>
                  <Label className="text-xs">Header title</Label>
                  <Input className="mt-1.5" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Header subtitle</Label>
                  <Input className="mt-1.5" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Agent name</Label>
                  <Input className="mt-1.5" value={agentName} onChange={(e) => setAgentName(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Input placeholder</Label>
                  <Input className="mt-1.5" value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Welcome message</Label>
                  <Textarea className="mt-1.5 min-h-20" defaultValue={`Hi 👋 I'm ${agentName}, an AI assistant. Ask me anything about pricing, features, or setup.`} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="behavior" className="mt-4 space-y-4">
              <div className="rounded-xl border border-border bg-card divide-y divide-border">
                {[
                  { label: "Show launcher label", desc: "Display a callout next to the chat button", state: showLauncherLabel, set: setShowLauncherLabel },
                  { label: "“Powered by Helio” badge", desc: "Hide on Growth & Scale plans", state: showBranding, set: setShowBranding },
                ].map((row) => (
                  <div key={row.label} className="flex items-start justify-between gap-4 p-5">
                    <div>
                      <div className="text-sm font-medium">{row.label}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{row.desc}</div>
                    </div>
                    <Switch checked={row.state} onCheckedChange={row.set} />
                  </div>
                ))}
                {showLauncherLabel && (
                  <div className="p-5">
                    <Label className="text-xs">Launcher label text</Label>
                    <Input className="mt-1.5" value={launcherLabel} onChange={(e) => setLauncherLabel(e.target.value)} />
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <div className="font-display text-sm font-semibold flex items-center gap-2"><Code2 className="h-4 w-4" /> Install snippet</div>
                <pre className="mt-3 overflow-x-auto rounded-md bg-surface p-4 font-mono text-[11px] leading-relaxed">{snippet}</pre>
                <Button size="sm" variant="outline" className="mt-3 gap-2" onClick={copy}>
                  {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy snippet</>}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* PREVIEW */}
        <div>
          <div className="sticky top-20">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">Live preview</div>
              <div className="inline-flex rounded-md border border-border bg-card p-0.5">
                <button onClick={() => setDevice("desktop")} className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs ${device === "desktop" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                  <Monitor className="h-3.5 w-3.5" /> Desktop
                </button>
                <button onClick={() => setDevice("mobile")} className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs ${device === "mobile" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
                  <Smartphone className="h-3.5 w-3.5" /> Mobile
                </button>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
                  <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
                </div>
                <div className="ml-2 flex-1 truncate rounded-md bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
                  northwind.io / pricing
                </div>
              </div>

              <div className="relative dot-bg" style={{ height: device === "mobile" ? 600 : 560 }}>
                {/* Fake page content */}
                <div className="absolute inset-0 p-8">
                  <div className={`mx-auto ${device === "mobile" ? "max-w-[320px]" : "max-w-md"} space-y-3 opacity-40`}>
                    <div className="h-6 w-2/3 rounded bg-foreground/15" />
                    <div className="h-3 w-full rounded bg-foreground/10" />
                    <div className="h-3 w-5/6 rounded bg-foreground/10" />
                    <div className="mt-4 h-24 rounded-lg bg-foreground/10" />
                  </div>
                </div>

                {/* WIDGET PANEL */}
                <div
                  className="absolute w-[340px] max-w-[calc(100%-32px)] overflow-hidden border border-border bg-background shadow-2xl"
                  style={{
                    borderRadius: r + 4,
                    ...(isBottom ? { bottom: 88 } : { top: 24 }),
                    ...(isRight ? { right: 24 } : { left: 24 }),
                  }}
                >
                  {/* Header */}
                  <div className="relative px-4 pb-5 pt-4 text-white" style={{ background: color }}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="relative">
                          <div className="grid h-9 w-9 place-items-center rounded-full bg-white/15 backdrop-blur" style={{ borderRadius: avatar === "bot" ? 999 : r }}>
                            {avatar === "bot" && <Bot className="h-4.5 w-4.5" />}
                            {avatar === "initial" && <span className="text-sm font-semibold">{agentName[0]}</span>}
                            {avatar === "image" && <span className="text-sm">🧑‍💼</span>}
                          </div>
                          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2" style={{ boxShadow: `0 0 0 2px ${color}` }} />
                        </div>
                        <div>
                          <div className="text-[13px] font-semibold leading-tight">{agentName}</div>
                          <div className="text-[10px] opacity-80">AI assistant · online</div>
                        </div>
                      </div>
                      <button className="opacity-80 hover:opacity-100"><Minus className="h-4 w-4" /></button>
                    </div>
                    <div className="mt-3.5 font-display text-[17px] font-semibold leading-snug">{title}</div>
                    <div className="mt-1 text-[11.5px] opacity-85">{subtitle}</div>
                  </div>

                  {/* Messages */}
                  <div className="space-y-3 bg-background px-4 py-4">
                    <div className="flex items-end gap-2">
                      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-white" style={{ background: color }}>
                        <Bot className="h-3 w-3" />
                      </div>
                      <div className="max-w-[78%] rounded-2xl bg-muted px-3 py-2 text-[12.5px]" style={{ borderRadius: r, borderBottomLeftRadius: 4 }}>
                        Hi 👋 I'm {agentName}. How can I help today?
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <div className="max-w-[78%] px-3 py-2 text-[12.5px] text-white" style={{ background: color, borderRadius: r, borderBottomRightRadius: 4 }}>
                        What's included in the Growth plan?
                      </div>
                    </div>

                    <div className="flex items-end gap-2">
                      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-white" style={{ background: color }}>
                        <Bot className="h-3 w-3" />
                      </div>
                      <div className="max-w-[78%] space-y-2">
                        <div className="rounded-2xl bg-muted px-3 py-2 text-[12.5px]" style={{ borderRadius: r, borderBottomLeftRadius: 4 }}>
                          Growth includes unlimited conversations, 5 seats, custom branding, and the analytics dashboard.
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {["See pricing", "Compare plans", "Book a demo"].map((s) => (
                            <button key={s} className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-foreground transition hover:bg-muted">
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-end gap-2">
                      <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-white" style={{ background: color }}>
                        <Bot className="h-3 w-3" />
                      </div>
                      <div className="flex items-center gap-1 rounded-2xl bg-muted px-3 py-2.5" style={{ borderRadius: r, borderBottomLeftRadius: 4 }}>
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/50 [animation-delay:-0.3s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/50 [animation-delay:-0.15s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground/50" />
                      </div>
                    </div>
                  </div>

                  {/* Composer */}
                  <div className="border-t border-border bg-background p-2.5">
                    <div className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-2.5 py-1.5" style={{ borderRadius: r }}>
                      <button className="text-muted-foreground hover:text-foreground"><Paperclip className="h-4 w-4" /></button>
                      <input
                        readOnly
                        placeholder={placeholder}
                        className="flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
                      />
                      <button className="text-muted-foreground hover:text-foreground"><Smile className="h-4 w-4" /></button>
                      <button className="grid h-7 w-7 place-items-center rounded-lg text-white" style={{ background: color }}>
                        <Send className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {showBranding && (
                      <div className="mt-2 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                        <Sparkles className="h-2.5 w-2.5" /> Powered by Helio
                      </div>
                    )}
                  </div>
                </div>

                {/* Launcher */}
                <div
                  className="absolute flex items-center gap-2"
                  style={{
                    ...(isBottom ? { bottom: 20 } : { top: 20 }),
                    ...(isRight ? { right: 20, flexDirection: "row" } : { left: 20, flexDirection: "row-reverse" }),
                  }}
                >
                  {showLauncherLabel && (
                    <div className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-md">
                      {launcherLabel}
                    </div>
                  )}
                  <button
                    className="grid h-14 w-14 place-items-center rounded-full text-white shadow-xl ring-1 ring-black/10 transition hover:scale-105"
                    style={{ background: color }}
                  >
                    <MessageSquare className="h-6 w-6" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


export default Page;
