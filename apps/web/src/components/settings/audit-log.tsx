"use client";

// Audit tab — read-only view of mutations against the org. Cursor-based
// "Load more" rather than offset pagination, mirroring the API contract
// (audit.routes.ts returns `{ items, nextCursor }`).

import { useState } from "react";
import { Button } from "@csb/ui";
import { ClipboardList, Loader2 } from "lucide-react";
import { clientApi, ApiError } from "@/lib/api";

export interface AuditItem {
  _id: string;
  action: string;
  target?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  user: { _id?: string; email?: string | null; name?: string | null } | null;
}

interface AuditResponse {
  items: AuditItem[];
  nextCursor: string | null;
}

export function AuditLog({
  initialItems,
  initialCursor,
}: {
  initialItems: AuditItem[];
  initialCursor: string | null;
}) {
  const [items, setItems] = useState<AuditItem[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await clientApi.get<AuditResponse>(`/audit?limit=20&cursor=${cursor}`);
      setItems((prev) => [...prev, ...next.items]);
      setCursor(next.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-center gap-2 font-display text-base font-semibold">
        <ClipboardList className="h-4 w-4" />
        Audit log
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Every operator-level mutation is recorded here.
      </p>

      {error && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mt-5">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-muted-foreground">
            No audit events yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">User</th>
                <th className="py-2 pr-3 font-medium">Action</th>
                <th className="py-2 pr-3 font-medium">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((it) => (
                <tr key={it._id}>
                  <td className="py-3 pr-3 text-xs text-muted-foreground">
                    {new Date(it.createdAt).toLocaleString()}
                  </td>
                  <td className="py-3 pr-3 text-sm">
                    {it.user?.email ?? it.user?.name ?? (
                      <span className="text-muted-foreground">system</span>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {it.action}
                    </code>
                  </td>
                  <td className="py-3 pr-3 font-mono text-xs text-muted-foreground">
                    {it.target ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {cursor && (
          <div className="mt-4 flex justify-center">
            <Button size="sm" variant="outline" onClick={loadMore} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Loading…
                </>
              ) : (
                "Load more"
              )}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
