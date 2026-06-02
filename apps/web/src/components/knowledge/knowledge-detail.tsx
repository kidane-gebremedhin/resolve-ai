"use client";

// Detail / editor for a single KnowledgeSource. Server component fetches the
// initial doc; we manage local form state + mutations.
//   - type=text:    inline title/content editor -> PUT /knowledge/:id
//   - type=*:       read-only metadata + "Re-ingest" -> POST /knowledge/:id/reingest
//   - all types:    Delete -> DELETE /knowledge/:id (confirmed via window.confirm)

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  RefreshCcw,
  Trash2,
  Loader2,
  ExternalLink,
  Save,
} from "lucide-react";
import { Button, Input, Label, Textarea } from "@csb/ui";
import { clientApi, ApiError } from "@/lib/api";
import { StatusBadge } from "./status-badge";
import type { KnowledgeSource } from "./types";

const MAX_PREVIEW = 5000;

function formatBytes(n?: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function KnowledgeDetail({ source }: { source: KnowledgeSource }) {
  const router = useRouter();
  const [title, setTitle] = useState(source.title);
  const [content, setContent] = useState(source.content ?? source.extractedText ?? "");
  const [saving, setSaving] = useState(false);
  const [reingesting, setReingesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const isText = source.type === "text";
  const titleDirty = title !== source.title;
  const contentDirty = isText && content !== (source.content ?? "");
  const dirty = titleDirty || contentDirty;

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const payload: { title?: string; content?: string } = {};
      if (titleDirty) payload.title = title.trim();
      if (contentDirty) payload.content = content;
      await clientApi.put<KnowledgeSource>(`/knowledge/${source._id}`, payload);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function reingest() {
    setError(null);
    setReingesting(true);
    try {
      await clientApi.post(`/knowledge/${source._id}/reingest`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to re-ingest source.");
    } finally {
      setReingesting(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${source.title}"? Vectors will be purged.`)) return;
    setError(null);
    setDeleting(true);
    try {
      await clientApi.delete(`/knowledge/${source._id}`);
      router.replace("/app/knowledge");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete source.");
      setDeleting(false);
    }
  }

  // For non-text sources we just show the extracted text preview, truncated.
  const previewText = source.extractedText ?? "";
  const truncated = previewText.length > MAX_PREVIEW;
  const previewDisplay = truncated ? `${previewText.slice(0, MAX_PREVIEW)}…` : previewText;

  return (
    <div className="container-page py-8">
      <Link
        href="/app/knowledge"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to knowledge
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {isText ? (
            <div className="space-y-1.5">
              <Label htmlFor="kb-title" className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Title
              </Label>
              <Input
                id="kb-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-10 text-lg font-display font-semibold"
              />
            </div>
          ) : (
            <h1 className="font-display text-2xl font-semibold tracking-tight">{source.title}</h1>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="rounded-md bg-muted px-2 py-0.5 uppercase tracking-wider">
              {source.type}
            </span>
            <StatusBadge status={source.embeddingStatus} />
            <span>{source.chunkCount ?? 0} chunks</span>
            <span>v{source.version}</span>
            {source.retryCount ? <span>{source.retryCount} retries</span> : null}
          </div>
        </div>
        <div className="flex gap-2">
          {isText ? (
            <Button onClick={save} disabled={!dirty || saving}>
              {saving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-3.5 w-3.5" />
              )}
              {savedFlash ? "Saved" : "Save changes"}
            </Button>
          ) : (
            <Button onClick={reingest} disabled={reingesting}>
              {reingesting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Re-ingest
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last synced</div>
          <div className="mt-1 text-sm font-medium">{formatDate(source.lastSyncedAt)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Created</div>
          <div className="mt-1 text-sm font-medium">{formatDate(source.createdAt)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {source.type === "website" ? "Source URL" : source.fileName ? "File" : "Identifier"}
          </div>
          <div className="mt-1 truncate text-sm font-medium">
            {source.type === "website" && source.sourceUrl ? (
              <a
                href={source.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
              >
                {source.sourceUrl}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : source.fileName ? (
              <span title={source.fileName}>
                {source.fileName} <span className="text-muted-foreground">({formatBytes(source.fileSize)})</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{source._id}</span>
            )}
          </div>
        </div>
      </div>

      {source.embeddingError && source.embeddingStatus === "error" && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <span className="font-medium">Ingestion error: </span>
          {source.embeddingError}
        </div>
      )}

      <div className="mt-6 rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="font-display text-sm font-semibold">
            {isText ? "Content" : "Extracted text"}
          </div>
          {!isText && truncated ? (
            <div className="text-[11px] text-muted-foreground">
              Showing first {MAX_PREVIEW.toLocaleString()} of {previewText.length.toLocaleString()} characters
            </div>
          ) : null}
        </div>
        {isText ? (
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            className="rounded-none border-0 bg-transparent font-mono text-xs focus-visible:ring-0"
          />
        ) : (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-xs text-muted-foreground">
            {previewDisplay || "No extracted text available yet."}
          </pre>
        )}
      </div>

      <div className="mt-8 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-display text-sm font-semibold text-destructive">Danger zone</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Deleting this source removes its vectors from the AI agent's knowledge base. This cannot be undone.
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={remove} disabled={deleting}>
            {deleting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            Delete source
          </Button>
        </div>
      </div>
    </div>
  );
}
