'use client';

// Websites CRUD. Server fetches initial list; we manage mutations locally with
// optimistic-ish state (we wait for the API to return then merge the response).
// All API calls go through clientApi so the NextAuth session token forwards.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Globe,
  Copy,
  Trash2,
  ExternalLink,
  Search,
  Code2,
  Check,
  Pencil,
  AlertCircle,
} from "lucide-react";
import {
  Button,
  Input,
  Badge,
  Label,
  Textarea,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@csb/ui";
import { clientApi, ApiError } from "@/lib/api";

export type Website = {
  _id: string;
  name: string;
  domain: string;
  allowedOrigins: string[];
  isActive: boolean;
  createdAt?: string;
};

export type Agent = { _id: string; name: string };

type DialogState =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "edit"; website: Website }
  | { kind: "embed"; website: Website };

export function WebsitesClient({
  initialWebsites,
  agent,
  apiBaseUrl,
}: {
  initialWebsites: Website[];
  agent: Agent | null;
  apiBaseUrl: string;
}) {
  const router = useRouter();
  const [sites, setSites] = useState<Website[]>(initialWebsites);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogState>({ kind: "closed" });
  const [error, setError] = useState<string | null>(null);

  const filtered = sites.filter((s) => s.domain.toLowerCase().includes(query.trim().toLowerCase()));

  async function handleDelete(site: Website) {
    if (!window.confirm(`Remove ${site.domain}? The widget will stop loading on that origin.`)) {
      return;
    }
    setError(null);
    try {
      await clientApi.delete(`/websites/${site._id}`);
      setSites((prev) => prev.filter((s) => s._id !== site._id));
      // Re-run server components so the workspace switcher in the app shell
      // drops the removed website too (its list is server-rendered).
      router.refresh();
    } catch (err) {
      setError(messageFor(err));
    }
  }

  async function handleSave(payload: SavePayload) {
    setError(null);
    try {
      if (payload.mode === "create") {
        const created = await clientApi.post<Website>("/websites", payload.data);
        setSites((prev) => [created, ...prev]);
      } else {
        const updated = await clientApi.patch<Website>(`/websites/${payload.id}`, payload.data);
        setSites((prev) => prev.map((s) => (s._id === updated._id ? updated : s)));
      }
      setDialog({ kind: "closed" });
      // Re-run server components so the workspace switcher in the app shell
      // reflects the new/renamed website without a manual page reload.
      router.refresh();
    } catch (err) {
      setError(messageFor(err));
    }
  }

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Websites</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Domains where your widget runs. Each entry pins its allowed origins for the embed script.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="gap-2"
          onClick={() => setDialog({ kind: "add" })}
        >
          <Plus className="h-4 w-4" /> Add website
        </Button>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search domains…"
            className="h-9 pl-8"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          {filtered.length} of {sites.length} site{sites.length === 1 ? "" : "s"}
        </div>
      </div>

      {sites.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
          <Globe className="mx-auto h-8 w-8 text-muted-foreground" />
          <div className="mt-3 font-display text-base font-semibold">No websites yet</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Add the first domain where your AI widget should load.
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-4 gap-2"
            onClick={() => setDialog({ kind: "add" })}
          >
            <Plus className="h-4 w-4" /> Add website
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => (
            <div key={s._id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted">
                    <Globe className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-medium">{s.domain}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {s.createdAt
                        ? `Added ${new Date(s.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`
                        : "Just added"}
                    </div>
                  </div>
                </div>
                <Badge variant={s.isActive ? "default" : "secondary"}>
                  {s.isActive ? "Active" : "Paused"}
                </Badge>
              </div>

              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Allowed origins
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {s.allowedOrigins.length === 0 ? (
                    <span className="text-[11px] italic text-muted-foreground">
                      (defaults to https://{s.domain})
                    </span>
                  ) : (
                    s.allowedOrigins.map((o) => (
                      <span
                        key={o}
                        className="rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[10.5px]"
                      >
                        {o}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => setDialog({ kind: "embed", website: s })}
                >
                  <Code2 className="h-3.5 w-3.5" /> Embed
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => setDialog({ kind: "edit", website: s })}
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <a
                  href={`https://${s.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Visit
                </a>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-destructive hover:text-destructive"
                  onClick={() => handleDelete(s)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(dialog.kind === "add" || dialog.kind === "edit") && (
        <WebsiteFormDialog
          mode={dialog.kind}
          initial={dialog.kind === "edit" ? dialog.website : undefined}
          onClose={() => setDialog({ kind: "closed" })}
          onSave={handleSave}
        />
      )}

      {dialog.kind === "embed" && (
        <EmbedDialog
          website={dialog.website}
          agent={agent}
          apiBaseUrl={apiBaseUrl}
          onClose={() => setDialog({ kind: "closed" })}
        />
      )}
    </div>
  );
}

type SavePayload =
  | { mode: "create"; data: { name: string; domain: string; allowedOrigins: string[]; isActive: boolean } }
  | { mode: "edit"; id: string; data: Partial<Pick<Website, "name" | "domain" | "allowedOrigins" | "isActive">> };

function WebsiteFormDialog({
  mode,
  initial,
  onClose,
  onSave,
}: {
  mode: "add" | "edit";
  initial?: Website;
  onClose: () => void;
  onSave: (p: SavePayload) => Promise<void>;
}) {
  const [domain, setDomain] = useState(initial?.domain ?? "");
  const [originsText, setOriginsText] = useState(
    initial?.allowedOrigins.join(", ") ?? "",
  );
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  async function submit() {
    const d = domain.trim().toLowerCase();
    if (!d) {
      setLocalErr("Domain is required.");
      return;
    }
    const origins = originsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const allowedOrigins = origins.length > 0 ? origins : [`https://${d}`];
    setBusy(true);
    setLocalErr(null);
    try {
      if (mode === "add") {
        await onSave({
          mode: "create",
          data: { name: d, domain: d, allowedOrigins, isActive },
        });
      } else if (initial) {
        await onSave({
          mode: "edit",
          id: initial._id,
          data: { name: d, domain: d, allowedOrigins, isActive },
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "Add website" : "Edit website"}</DialogTitle>
          <DialogDescription>
            We&apos;ll register this domain so the widget knows it&apos;s allowed to load.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label className="text-xs">Domain</Label>
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Allowed origins (comma-separated)</Label>
            <Textarea
              value={originsText}
              onChange={(e) => setOriginsText(e.target.value)}
              className="min-h-20 font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Leave blank to default to <code className="font-mono">https://{domain || "<domain>"}</code>.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4"
            />
            Active
          </label>
          {localErr && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {localErr}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Saving…" : mode === "add" ? "Add website" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmbedDialog({
  website,
  agent,
  apiBaseUrl,
  onClose,
}: {
  website: Website;
  agent: Agent | null;
  apiBaseUrl: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const snippet = `<script>
  (function(w,d){
    w.HelioConfig = {
      apiBase: "${apiBaseUrl}",
      websiteId: "${website._id}",${agent ? `\n      agentId: "${agent._id}",` : ""}
      domain: "${website.domain}"
    };
    var s = d.createElement("script");
    s.src = "${process.env.NEXT_PUBLIC_WIDGET_URL ?? "http://localhost:3001"}/widget.js";
    s.async = 1;
    d.head.appendChild(s);
  })(window, document);
</script>`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Embed snippet · {website.domain}</DialogTitle>
          <DialogDescription>
            Drop this into the &lt;head&gt; of {website.domain} to start the widget.
          </DialogDescription>
        </DialogHeader>
        <pre className="overflow-x-auto rounded-md border border-border bg-surface p-4 font-mono text-[11px] leading-relaxed">
          {snippet}
        </pre>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={copy} className="gap-2">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy snippet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
