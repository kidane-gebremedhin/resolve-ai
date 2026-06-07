"use client";

// Tabbed embed-snippet UI. Each tab shows a copyable code block built from the
// agent's config (ID, org/website IDs, and saved Widget Studio cosmetics —
// position, primary color, theme) passed from the server page. Every snippet
// emits the same set of data-* attributes the embed loader honors, so the
// installed widget matches what was configured under /app/widget.
//   - HTML:  single <script> tag
//   - React: useEffect that injects the same tag
//   - Next.js: next/script with afterInteractive strategy
//   - NPM: coming-soon placeholder
//
// Copy uses navigator.clipboard with a small fallback for non-https contexts.

import { useState } from "react";
import { Copy, Check, Package, Code2, Globe } from "lucide-react";
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@csb/ui";

export type EmbedConfig = {
  agentId: string;
  embedUrl: string;
  widgetUrl?: string;
  apiUrl?: string;
  position?: string;
  primaryColor?: string;
  theme?: string;
};

type Props = {
  config: EmbedConfig;
};

// Maps each embed loader attribute to its HTML form (data-*), its HTMLElement
// `dataset` key (camelCase), and the EmbedConfig field it reads from. Order here
// is the order attributes appear in every snippet.
//
// Only `data-agent` identifies the install — the API derives the organization
// and website from the agent (one agent maps to one website). Appearance
// (position / primary color / theme) is fetched live by agentId from
// GET /widget/appearance on load, so it is NOT baked into the snippet: operators
// can change it in Widget Studio without re-copying or re-deploying the script.
// `data-api-url` tells the loader where that appearance endpoint lives, so the
// live fetch works on any host page (it can't be inferred from the widget URL).
const ATTR_DEFS: { attr: string; ds: string; key: keyof EmbedConfig }[] = [
  { attr: "data-agent", ds: "agent", key: "agentId" },
  { attr: "data-widget-url", ds: "widgetUrl", key: "widgetUrl" },
  { attr: "data-api-url", ds: "apiUrl", key: "apiUrl" },
];

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(code);
      } else {
        // Fallback for http:// dev hosts where the async clipboard API
        // isn't allowed. execCommand is deprecated but works everywhere.
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Last-resort: do nothing — the snippet is still visible to the user.
    }
  }

  return (
    <div className="relative">
      <pre className="max-h-[60vh] overflow-auto rounded-md border border-border bg-surface p-4 pr-12 font-mono text-xs leading-relaxed text-foreground">
        {code}
      </pre>
      <Button
        size="sm"
        variant="outline"
        onClick={copy}
        className="absolute right-2 top-2 gap-1.5"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function DevelopersClient({ config }: Props) {
  // The agent attribute is always present (placeholder or real); the rest are
  // only emitted when the value exists, so an unconfigured workspace still gets
  // a valid minimal snippet.
  const present = ATTR_DEFS.filter(
    (def) => def.key === "agentId" || Boolean(config[def.key]),
  );

  const htmlAttrLines = present
    .map((def) => `  ${def.attr}="${config[def.key]}"`)
    .join("\n");
  const htmlSnippet = `<!-- Drop this anywhere in your page (ideally before </body>). -->
<script
  async
  src="${config.embedUrl}"
${htmlAttrLines}
></script>`;

  const reactDatasetLines = present
    .map((def) => {
      const value = def.key === "agentId" ? "AGENT_ID" : JSON.stringify(config[def.key]);
      return `    s.dataset.${def.ds} = ${value};`;
    })
    .join("\n");
  const reactSnippet = `import { useEffect } from "react";

const EMBED_URL = "${config.embedUrl}";
const AGENT_ID = "${config.agentId}";

export function HelioWidget() {
  useEffect(() => {
    if (document.querySelector(\`script[data-agent="\${AGENT_ID}"]\`)) return;
    const s = document.createElement("script");
    s.async = true;
    s.src = EMBED_URL;
${reactDatasetLines}
    document.body.appendChild(s);
    return () => {
      s.remove();
    };
  }, []);
  return null;
}`;

  const nextAttrLines = present
    .map((def) => `          ${def.attr}="${config[def.key]}"`)
    .join("\n");
  const nextSnippet = `// app/layout.tsx (or any layout/page)
import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <Script
          src="${config.embedUrl}"
          strategy="afterInteractive"
${nextAttrLines}
        />
      </body>
    </html>
  );
}`;

  // Config values baked into the snippet, shown so developers can see exactly
  // what the Widget Studio settings resolved to. Excludes the agent ID (it has
  // its own card above).
  const configChips = present.filter((def) => def.key !== "agentId");

  return (
    <div className="container-page py-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Developers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Embed the AI chat widget on your site. The snippet below carries the
          appearance you configured under <span className="font-medium">Widget</span> —
          position, colour, and theme — so it installs ready to go.
        </p>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Agent ID</div>
          <div className="mt-1 truncate font-mono text-sm">{config.agentId}</div>
          {config.agentId === "YOUR_AGENT_ID" && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Create an agent under <span className="font-medium">AI agent</span> to replace this placeholder.
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Embed URL</div>
          <div className="mt-1 truncate font-mono text-sm">{config.embedUrl}</div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Configured via <code className="font-mono">EMBED_BASE_URL</code>.
          </p>
        </div>
      </div>

      {configChips.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Bundled widget configuration
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {configChips.map((def) => (
              <span
                key={def.attr}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 font-mono text-[11px]"
              >
                <span className="text-muted-foreground">{def.attr}</span>
                <span className="text-foreground">{String(config[def.key])}</span>
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Change these in <span className="font-medium">Widget</span> and the snippet updates automatically.
          </p>
        </div>
      )}

      <Tabs defaultValue="html" className="mt-8">
        <TabsList>
          <TabsTrigger value="html" className="gap-1.5">
            <Globe className="h-3.5 w-3.5" /> HTML
          </TabsTrigger>
          <TabsTrigger value="react" className="gap-1.5">
            <Code2 className="h-3.5 w-3.5" /> React
          </TabsTrigger>
          <TabsTrigger value="next" className="gap-1.5">
            <Code2 className="h-3.5 w-3.5" /> Next.js
          </TabsTrigger>
          <TabsTrigger value="npm" className="gap-1.5">
            <Package className="h-3.5 w-3.5" /> NPM
          </TabsTrigger>
        </TabsList>

        <TabsContent value="html" className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Paste this snippet into your site&apos;s HTML — ideally just before the closing
            <code className="mx-1 rounded bg-muted px-1 font-mono text-[11px]">&lt;/body&gt;</code> tag.
          </p>
          <CodeBlock code={htmlSnippet} />
        </TabsContent>

        <TabsContent value="react" className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Render the component once anywhere in your app — it injects the script on mount.
          </p>
          <CodeBlock code={reactSnippet} />
        </TabsContent>

        <TabsContent value="next" className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Use <code className="rounded bg-muted px-1 font-mono text-[11px]">next/script</code> in your root layout for optimal loading.
          </p>
          <CodeBlock code={nextSnippet} />
        </TabsContent>

        <TabsContent value="npm" className="mt-4">
          <div className="rounded-xl border border-dashed border-border bg-surface/40 p-8 text-center">
            <Package className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
            <div className="mt-3 font-display text-base font-semibold">NPM package — coming soon</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              We&apos;re packaging a typed React component you can install with <code className="font-mono">npm i @helio/widget</code>.
              For now, use the React snippet above.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      <div className="mt-10 rounded-xl border border-border bg-card p-5">
        <div className="font-display text-sm font-semibold">Need help?</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Reach out to our team if you need authenticated embeds, custom theming, or SSR-friendly bundles.
        </p>
      </div>
    </div>
  );
}
