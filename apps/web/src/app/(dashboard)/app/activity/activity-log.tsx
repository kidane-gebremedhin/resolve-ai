"use client";

import { useState } from "react";
import { Button } from "@csb/ui";
import { Loader2, CheckCircle2, XCircle, ShieldOff, Clock } from "lucide-react";
import { clientApi, ApiError } from "@/lib/api";

export type ToolCallItem = {
  _id: string;
  toolKey: string;
  conversationId: string;
  agentId?: string;
  argsMasked: Record<string, unknown>;
  resultSummary?: string | null;
  status: "success" | "guardrail_blocked" | "error" | "otp_pending";
  durationMs: number;
  createdAt: string;
};

type ToolCallResponse = {
  items: ToolCallItem[];
  nextCursor: string | null;
};

function StatusBadge({ status }: { status: ToolCallItem["status"] }) {
  const map = {
    success: { icon: CheckCircle2, className: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40", label: "Success" },
    error: { icon: XCircle, className: "text-red-600 bg-red-50 dark:bg-red-950/40", label: "Error" },
    guardrail_blocked: { icon: ShieldOff, className: "text-amber-600 bg-amber-50 dark:bg-amber-950/40", label: "Blocked" },
    otp_pending: { icon: Clock, className: "text-blue-600 bg-blue-50 dark:bg-blue-950/40", label: "Pending" },
  };
  const { icon: Icon, className, label } = map[status] ?? map.error;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function ResultCell({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const tooLong = text.length > 120;

  return (
    <div className="max-w-[220px]">
      <span className={`text-xs text-muted-foreground ${open ? "" : "line-clamp-2"}`}>
        {text}
      </span>
      {tooLong && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 text-[10px] text-primary underline underline-offset-2"
        >
          {open ? "collapse" : "expand"}
        </button>
      )}
    </div>
  );
}

function ArgsCell({ args }: { args: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  // Guard against a missing/undefined argsMasked (older logs, or a record written
  // without it): JSON.stringify(undefined) returns undefined, and .slice() on it
  // throws — which would crash the whole activity table render.
  let full = "{}";
  let str = "{}";
  try {
    full = JSON.stringify(args ?? {}) ?? "{}";
    str = JSON.stringify(args ?? {}, null, 2) ?? "{}";
  } catch {
    full = "{}";
    str = "{}";
  }
  const preview = full.slice(0, 80);
  const tooLong = full.length > 80;

  return (
    <div className="max-w-xs">
      {open ? (
        <pre className="whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 text-[10px] font-mono text-muted-foreground">
          {str}
        </pre>
      ) : (
        <span className="font-mono text-[11px] text-muted-foreground">
          {tooLong ? `${preview}…` : preview}
        </span>
      )}
      {tooLong && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 text-[10px] text-primary underline underline-offset-2"
        >
          {open ? "collapse" : "expand"}
        </button>
      )}
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ActivityLog({
  initialItems,
  initialCursor,
  days,
}: {
  initialItems: ToolCallItem[];
  initialCursor: string | null;
  days: number;
}) {
  const [items, setItems] = useState<ToolCallItem[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await clientApi.get<ToolCallResponse>(
        `/analytics/tool-calls?limit=50&days=${days}&cursor=${cursor}`,
      );
      setItems((prev) => [...prev, ...next.items]);
      setCursor(next.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <Clock className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No tool calls recorded in the last {days} days.</p>
        <p className="text-xs text-muted-foreground/60">
          Tool calls are logged automatically when the AI agent invokes an action.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Time</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Tool</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Duration</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Args (masked)</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item) => (
              <tr key={item._id} className="group hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {formatDate(item.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                    {item.toolKey}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={item.status} />
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {formatMs(item.durationMs)}
                </td>
                <td className="px-4 py-3">
                  <ArgsCell args={item.argsMasked as Record<string, unknown>} />
                </td>
                <td className="px-4 py-3">
                  {item.resultSummary ? (
                    <ResultCell text={item.resultSummary} />
                  ) : (
                    <span className="text-xs text-muted-foreground/40">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="mt-3 text-xs text-destructive">{error}</p>
      )}

      {cursor && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Loading…
              </>
            ) : (
              "Load more"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
