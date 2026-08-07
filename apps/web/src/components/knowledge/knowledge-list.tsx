"use client";

// Client-side list view. The server component fetches the initial sources
// array and hands it in; we render filter pills, per-row actions, and the
// "Add knowledge" modal. Mutations call clientApi and then `router.refresh()`
// so the server component re-fetches.
//
// Live updates: we subscribe to the operator Socket.io room and merge
// `knowledge:updated` events into local state so the StatusBadge swaps from
// `processing` → `synced` (or `error`) without a page reload.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Sparkles,
  FileText,
  Globe,
  Image as ImageIcon,
  Table,
  FileCode,
  File as FileGeneric,
  RefreshCcw,
  Trash2,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Button } from "@csb/ui";
import { clientApi, ApiError } from "@/lib/api";
import { useCan } from "@/hooks/use-permissions";
import { ReadOnlyNotice } from "@/components/layouts/read-only-notice";
import { getOperatorSocket } from "@/lib/socket";
import { StatusBadge } from "./status-badge";
import { AddKnowledgeDialog } from "./add-knowledge-dialog";
import { KnowledgeGapsDialog } from "./knowledge-gaps-dialog";
import type { KbType, KnowledgeSource } from "./types";

type KnowledgeUpdatedPayload = {
  sourceId: string;
  embeddingStatus?: KnowledgeSource["embeddingStatus"];
  chunkCount?: number;
  lastSyncedAt?: string;
  embeddingError?: string;
};

type FilterKey = "all" | "text" | "file" | "website" | "error";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "text", label: "Text" },
  { key: "file", label: "Files" },
  { key: "website", label: "Websites" },
  { key: "error", label: "Errored" },
];

const FILE_TYPES: KbType[] = ["pdf", "docx", "excel", "csv", "image", "html"];

function typeIconFor(type: KbType) {
  switch (type) {
    case "text":
      return FileText;
    case "website":
      return Globe;
    case "image":
      return ImageIcon;
    case "excel":
    case "csv":
      return Table;
    case "html":
      return FileCode;
    case "pdf":
    case "docx":
    default:
      return FileGeneric;
  }
}

function relativeTime(iso?: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function matchesFilter(s: KnowledgeSource, f: FilterKey): boolean {
  if (f === "all") return true;
  if (f === "text") return s.type === "text";
  if (f === "website") return s.type === "website";
  if (f === "file") return FILE_TYPES.includes(s.type);
  if (f === "error") return s.embeddingStatus === "error";
  return true;
}

export function KnowledgeList({
  sources,
  agentId,
  websiteLabel,
}: {
  sources: KnowledgeSource[];
  /** Active website's agent (null = "All websites" — can't add without one). */
  agentId: string | null;
  websiteLabel: string | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [gapsOpen, setGapsOpen] = useState(false);
  // Set when the operator picks a gap to answer — seeds the Add-knowledge title.
  const [gapPrefill, setGapPrefill] = useState<string | undefined>(undefined);
  // kb.routes mounts requireOrgRole("agent"), so viewers are read-only here
  // while agents and above can curate sources. Still needs a scoped website.
  const canManage = useCan("manageKnowledge");
  const canAdd = canManage && Boolean(agentId);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Local mirror of the prop so the operator socket can patch rows in-place
  // when the API broadcasts a `knowledge:updated` event. The server-component
  // prop seeds it and reseeds on `router.refresh()`.
  const [rows, setRows] = useState<KnowledgeSource[]>(sources);
  useEffect(() => {
    setRows(sources);
  }, [sources]);

  // Subscribe to live status updates. We grab the operator's bearer token via
  // /api/session-token (same path clientApi uses) and join the org room
  // automatically via the API's socket middleware.
  useEffect(() => {
    let socketRef: ReturnType<typeof getOperatorSocket> | null = null;
    let cancelled = false;
    (async () => {
      const tokenRes = await fetch("/api/session-token", { cache: "no-store" });
      const { accessToken } = (await tokenRes.json()) as { accessToken?: string };
      if (cancelled || !accessToken) return;
      const socket = getOperatorSocket(accessToken);
      socketRef = socket;
      const onUpdate = (payload: KnowledgeUpdatedPayload) => {
        setRows((prev) =>
          prev.map((s) =>
            s._id === payload.sourceId
              ? {
                  ...s,
                  embeddingStatus: payload.embeddingStatus ?? s.embeddingStatus,
                  chunkCount: payload.chunkCount ?? s.chunkCount,
                  lastSyncedAt: payload.lastSyncedAt ?? s.lastSyncedAt,
                }
              : s,
          ),
        );
      };
      socket.on("knowledge:updated", onUpdate);
      // Remove a row when another tab/operator deletes the source.
      const onDeleted = (payload: { sourceId: string }) => {
        setRows((prev) => prev.filter((s) => s._id !== payload.sourceId));
      };
      socket.on("knowledge:deleted", onDeleted);
      // Stash the off so the cleanup can detach without disconnecting the
      // shared socket (other tabs/pages may still need it).
      socketRef = Object.assign(socket, {
        __kbCleanup: () => {
          socket.off("knowledge:updated", onUpdate);
          socket.off("knowledge:deleted", onDeleted);
        },
      });
    })();
    return () => {
      cancelled = true;
      const s = socketRef as (ReturnType<typeof getOperatorSocket> & { __kbCleanup?: () => void }) | null;
      s?.__kbCleanup?.();
    };
  }, []);

  const filtered = useMemo(() => rows.filter((s) => matchesFilter(s, filter)), [rows, filter]);

  async function reingest(id: string) {
    setBusyId(id);
    try {
      await clientApi.post(`/knowledge/${id}/reingest`);
      // Optimistic: mark the row as processing so the badge flips immediately;
      // the socket event will follow up with synced/error.
      setRows((prev) =>
        prev.map((s) => (s._id === id ? { ...s, embeddingStatus: "processing" } : s)),
      );
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to re-ingest source.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string, title: string) {
    if (!window.confirm(`Delete "${title}"? Vectors will be purged.`)) return;
    setBusyId(id);
    try {
      await clientApi.delete(`/knowledge/${id}`);
      // Optimistic: drop the row locally; the deletion job will purge vectors
      // server-side and emit a final status if it surfaces an error.
      setRows((prev) => prev.filter((s) => s._id !== id));
      router.refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete source.");
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: rows.length, text: 0, file: 0, website: 0, error: 0 };
    for (const s of rows) {
      if (s.type === "text") c.text++;
      else if (s.type === "website") c.website++;
      else if (FILE_TYPES.includes(s.type)) c.file++;
      if (s.embeddingStatus === "error") c.error++;
    }
    return c;
  }, [rows]);

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Knowledge</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {canAdd
              ? `Sources for ${websiteLabel ?? "this website"}. Keep them fresh.`
              : "Knowledge is per website. Pick a website in the sidebar switcher to add or scope sources."}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setGapsOpen(true)}
              title="Questions customers asked that your knowledge base couldn't answer"
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" /> Suggest gaps
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setAddOpen(true)}
              disabled={!canAdd}
              title={canAdd ? undefined : "Select a website in the sidebar switcher first"}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add knowledge
            </Button>
          </div>
        )}
      </div>

      <ReadOnlyNotice capability="manageKnowledge" className="mt-4" />

      <div className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-foreground/80 hover:bg-muted"
              }`}
            >
              {f.label}
              <span
                className={`rounded-full px-1.5 text-[10px] ${
                  active ? "bg-background/20" : "bg-muted text-muted-foreground"
                }`}
              >
                {counts[f.key]}
              </span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-border bg-surface/40 p-12 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
          <div className="mt-3 font-display text-base font-semibold">No knowledge sources yet</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {canManage
              ? "Add text, upload a document, or crawl a website to train your agent."
              : "Nothing has been added yet. Ask an agent or admin to train this workspace."}
          </p>
          {canManage && (
            <Button
              type="button"
              size="sm"
              className="mt-4"
              onClick={() => setAddOpen(true)}
              disabled={!canAdd}
              title={canAdd ? undefined : "Select a website in the sidebar switcher first"}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add your first source
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Source</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Chunks</th>
                <th className="px-5 py-3 font-medium">Last sync</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((s) => {
                const Icon = typeIconFor(s.type);
                const busy = busyId === s._id;
                return (
                  <tr key={s._id} className="group transition hover:bg-surface">
                    <td className="px-5 py-3">
                      <Link href={`/app/knowledge/${s._id}`} className="flex items-center gap-3">
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted">
                          <Icon className="h-4 w-4 text-primary" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{s.title}</div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {s.type === "website"
                              ? s.sourceUrl ?? "website"
                              : s.fileName ?? s.type}
                          </div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={s.embeddingStatus} />
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{s.chunkCount ?? 0}</td>
                    <td className="px-5 py-3 text-muted-foreground">{relativeTime(s.lastSyncedAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/app/knowledge/${s._id}`}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                        {canManage && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy || s.embeddingStatus === "deleting"}
                              onClick={() => reingest(s._id)}
                              title="Re-ingest"
                            >
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RefreshCcw className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => remove(s._id, s.title)}
                              className="text-destructive hover:text-destructive"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {agentId && (
        <AddKnowledgeDialog
          open={addOpen}
          onOpenChange={(o) => {
            setAddOpen(o);
            if (!o) setGapPrefill(undefined);
          }}
          agentId={agentId}
          initialTitle={gapPrefill}
        />
      )}

      {/* Gaps are readable by any member; only agent+ sees the write actions. */}
      <KnowledgeGapsDialog
        open={gapsOpen}
        onOpenChange={setGapsOpen}
        agentId={agentId}
        canManage={canManage}
        onWriteAnswer={(question) => {
          // Hand off: close the worklist, open Add-knowledge titled with the
          // customer's exact wording so the answer is written against the real
          // question rather than a paraphrase.
          setGapsOpen(false);
          setGapPrefill(question);
          setAddOpen(true);
        }}
      />
    </div>
  );
}
