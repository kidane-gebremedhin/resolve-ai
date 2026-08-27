"use client";

// The repair half of the knowledge health panel.
//
// Every one of these mutates customer knowledge, so each is a deliberate,
// operator-initiated action with its consequence spelled out before it runs.
// The bulk delete in particular is a two-step flow by construction: the server
// issues a token over the exact set it showed you, and refuses a confirm that
// does not match it. The dialog below is the human half of that contract, not
// the whole of it — the guarantee lives in the API.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from "@csb/ui";
import { clientApi } from "@/lib/api";
import { toast } from "@/lib/toast";

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** Repair 1 — targeted re-ingest and re-embed of a single source. */
export function ReindexButton({ sourceId, title }: { sourceId: string; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await clientApi.post(`/index-health/sources/${sourceId}/reindex`);
      toast.success(`Re-indexing “${title}”. Its old vectors are torn down first.`);
      start(() => router.refresh());
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={run} disabled={busy || pending}>
      {busy ? "Re-indexing…" : "Re-index"}
    </Button>
  );
}

/** Repair 3 — mark stale, and/or lower authority. Metadata only, no re-embed. */
export function MarkSourceButton({
  sourceId,
  title,
  stale,
  priority,
}: {
  sourceId: string;
  title: string;
  stale: boolean;
  priority: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nextStale, setNextStale] = useState(stale);
  const [nextPriority, setNextPriority] = useState(priority);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await clientApi.post(`/index-health/sources/${sourceId}/mark`, {
        stale: nextStale,
        priority: nextPriority,
      });
      toast.success(`Updated “${title}”. Nothing was re-embedded.`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {stale ? "Stale" : "Mark…"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark “{title}”</DialogTitle>
            <DialogDescription>
              Both are metadata. The source stays indexed and retrievable — hiding it silently
              would turn “this answer is out of date” into “we have no answer”, which is worse.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={nextStale}
                onChange={(e) => setNextStale(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Out of date
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="priority">Authority ({nextPriority})</Label>
              <Input
                id="priority"
                type="range"
                min={-10}
                max={10}
                step={1}
                value={nextPriority}
                onChange={(e) => setNextPriority(Number(e.target.value))}
              />
              <p className="text-[11px] text-muted-foreground">
                Higher wins when two sources contradict each other. Lower this rather than
                deleting when something newer should win.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Repair 2 — answer a gap cluster with a Q&A pair that becomes its own source. */
export function AnswerGapButton({
  agentId,
  question,
  gapIds,
  volume,
}: {
  agentId: string | null;
  question: string;
  gapIds: string[];
  volume: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(question);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!agentId) {
      toast.error("Pick a single website first — a Q&A pair belongs to one agent's knowledge base.");
      return;
    }
    setBusy(true);
    try {
      const res = await clientApi.post<{ gapsAddressed: number }>(
        "/index-health/gap-clusters/answer",
        { agentId, question: q, answer, gapIds },
      );
      toast.success(
        `Added to the knowledge base and closed ${res.gapsAddressed} gap${res.gapsAddressed === 1 ? "" : "s"}.`,
      );
      setOpen(false);
      setAnswer("");
      router.refresh();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Answer this
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Answer a gap</DialogTitle>
            <DialogDescription>
              {volume} customer{volume === 1 ? "" : "s"} asked this and found nothing. The answer
              becomes its own high-authority source, stored with the question so it matches the
              words customers actually used.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="gap-question">Question</Label>
              <Input id="gap-question" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gap-answer">Answer</Label>
              <Textarea
                id="gap-answer"
                rows={6}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Write the answer as you would say it to a customer."
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Closes {gapIds.length} recorded gap{gapIds.length === 1 ? "" : "s"} on save.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || q.trim().length < 3 || answer.trim().length < 3}>
              {busy ? "Adding…" : "Add to knowledge base"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type PreviewSource = { _id: string; title: string; chunkCount: number };

/**
 * Repair 4 — bulk delete never-retrieved sources.
 *
 * Two steps, and the second cannot be reached without the first: the preview
 * returns a token over the exact set it listed, and the server refuses a
 * confirm whose set does not match, has expired, or covers a source that has
 * started being retrieved in the meantime.
 */
export function BulkDeleteDeadWeight({ count }: { count: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<PreviewSource[]>([]);
  const [token, setToken] = useState<string | null>(null);

  async function review() {
    setOpen(true);
    setLoading(true);
    try {
      const res = await clientApi.post<{ sources: PreviewSource[]; token: string | null }>(
        "/index-health/sources/bulk-delete/preview",
      );
      setSources(res.sources);
      setToken(res.token);
    } catch (err) {
      toast.error(message(err));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async function confirmDelete() {
    if (!token) return;
    setBusy(true);
    try {
      const res = await clientApi.post<{ deleted: number }>("/index-health/sources/bulk-delete", {
        sourceIds: sources.map((s) => s._id),
        token,
        confirm: true,
      });
      toast.success(`Deleted ${res.deleted} source${res.deleted === 1 ? "" : "s"}.`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  }

  if (count === 0) return null;

  return (
    <>
      <Button size="sm" variant="ghost" className="text-destructive" onClick={review}>
        Review &amp; delete…
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete never-retrieved sources</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the documents and their vectors. Review the exact list
              first — the confirm only applies to what is shown here, and is refused if any of it
              starts being retrieved before you press it.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {loading ? (
            <p className="text-sm text-muted-foreground">Checking what has been retrieved…</p>
          ) : sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing to delete: every indexed source was retrieved at least once in this window.
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-3 text-sm">
              {sources.map((s) => (
                <li key={s._id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{s.title}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {s.chunkCount} chunks
                  </span>
                </li>
              ))}
            </ul>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={busy || loading || sources.length === 0 || !token}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "Deleting…" : `Delete ${sources.length}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
