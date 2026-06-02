"use client";

// API tab — manage per-org API keys. Creation returns the plaintext key
// ONCE; we surface it in a modal with a copy button and a stark warning.
// Listing is hash-only — `prefix` is enough to identify which key the user
// wants to revoke.

import { useState } from "react";
import {
  Button,
  Input,
  Label,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@csb/ui";
import { AlertCircle, Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { clientApi, ApiError } from "@/lib/api";

export interface ApiKeyRow {
  _id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt?: string | null;
  createdAt?: string;
  expiresAt?: string | null;
}

interface CreateResponse extends ApiKeyRow {
  // Plaintext key shown exactly once.
  key: string;
}

export function ApiKeys({ initial }: { initial: ApiKeyRow[] }) {
  const [keys, setKeys] = useState<ApiKeyRow[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newScopes, setNewScopes] = useState<Array<"read" | "write">>(["read"]);
  const [createdKey, setCreatedKey] = useState<CreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    if (!newKeyName.trim()) {
      setError("Name is required.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const result = await clientApi.post<CreateResponse>("/api-keys", {
        name: newKeyName.trim(),
        scopes: newScopes,
      });
      // Persist the result for the "seen once" modal.
      setCreatedKey(result);
      setKeys((prev) => [
        {
          _id: result._id,
          name: result.name,
          prefix: result.prefix,
          scopes: result.scopes,
          createdAt: result.createdAt,
        },
        ...prev,
      ]);
      setOpenDialog(false);
      setNewKeyName("");
      setNewScopes(["read"]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this API key? This cannot be undone.")) return;
    setError(null);
    try {
      await clientApi.delete(`/api-keys/${id}`);
      setKeys((prev) => prev.filter((k) => k._id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  }

  async function copyKey() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  function toggleScope(scope: "read" | "write") {
    setNewScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 font-display text-base font-semibold">
            <KeyRound className="h-4 w-4" />
            API keys
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Issue programmatic credentials for server-to-server access. Pass them via the
            <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[11px]">X-API-Key</code>
            header.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpenDialog(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Create key
        </Button>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-5">
        {keys.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-muted-foreground">
            No API keys yet. Create one to start integrating.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Prefix</th>
                <th className="py-2 pr-3 font-medium">Scopes</th>
                <th className="py-2 pr-3 font-medium">Last used</th>
                <th className="py-2 pr-3 font-medium">Created</th>
                <th className="py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {keys.map((k) => (
                <tr key={k._id}>
                  <td className="py-3 pr-3 font-medium">{k.name}</td>
                  <td className="py-3 pr-3 font-mono text-xs">{k.prefix}…</td>
                  <td className="py-3 pr-3 text-xs">{k.scopes.join(", ")}</td>
                  <td className="py-3 pr-3 text-xs text-muted-foreground">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "—"}
                  </td>
                  <td className="py-3 pr-3 text-xs text-muted-foreground">
                    {k.createdAt ? new Date(k.createdAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5 text-destructive hover:text-destructive"
                      onClick={() => revoke(k._id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create dialog --------------------------------------------------- */}
      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>Pick a name and scopes — the secret is shown once.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Name
              </Label>
              <Input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Scopes
              </Label>
              <div className="flex gap-3 text-sm">
                {(["read", "write"] as const).map((s) => (
                  <label key={s} className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={newScopes.includes(s)}
                      onChange={() => toggleScope(s)}
                    />
                    <span className="capitalize">{s}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDialog(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={create} disabled={creating}>
              {creating ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Creating…
                </>
              ) : (
                "Create key"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* "Seen once" key modal ------------------------------------------ */}
      <Dialog
        open={createdKey !== null}
        onOpenChange={(open) => !open && setCreatedKey(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save your API key</DialogTitle>
            <DialogDescription>
              This is the only time we&apos;ll show the full key. Copy it now — we only store a
              hash on our side.
            </DialogDescription>
          </DialogHeader>
          {createdKey && (
            <div className="space-y-3">
              <code className="block break-all rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs">
                {createdKey.key}
              </code>
              <Button size="sm" variant="outline" onClick={copyKey} className="gap-1.5">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Use it as <code className="font-mono">X-API-Key: {createdKey.prefix}…</code>
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreatedKey(null)}>I&apos;ve saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
