"use client";

// "Suggest gaps" — the knowledge-gap worklist.
//
// A gap is recorded by the agent runtime whenever a customer asks something the
// knowledge base could not answer well: the best-scoring KB chunk fell below
// AI_KB_GAP_SCORE_THRESHOLD. Each (org, agent, searchQuery) is upserted, so
// `occurrenceCount` is how many DIFFERENT customers hit the same wall — which is
// exactly the priority order for what to write next.
//
// This dialog turns that passive list into a worklist: read the question, write
// the answer (prefilled straight into the Add-knowledge dialog), or dismiss it.
// Source of truth is GET/PATCH /analytics/knowledge-gaps.

import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@csb/ui";
import { AlertCircle, Check, Loader2, MessageCircleQuestion, Sparkles } from "lucide-react";
import { clientApi, ApiError } from "@/lib/api";

export type KnowledgeGap = {
  _id: string;
  question: string;
  queryUsed: string;
  maxKbScore: number;
  occurrenceCount: number;
  status: "open" | "addressed";
  createdAt: string;
  updatedAt: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Scopes gaps to the active website's agent. Null = whole org. */
  agentId: string | null;
  /** Operator can write knowledge (kb.routes is requireOrgRole("agent")). */
  canManage: boolean;
  /** Hand a gap's question to the Add-knowledge dialog, prefilled. */
  onWriteAnswer: (question: string) => void;
};

// Gaps are ranked by recurrence, but the KB score says WHY it failed: a 0 means
// nothing in the KB was even close, while 0.5 means a near-miss that an existing
// source could probably be extended to cover.
function scoreLabel(score: number): { text: string; tone: string } {
  if (score <= 0.01) return { text: "nothing relevant found", tone: "text-destructive" };
  if (score < 0.45) return { text: `weak match (${score.toFixed(2)})`, tone: "text-amber-600" };
  return { text: `near miss (${score.toFixed(2)})`, tone: "text-muted-foreground" };
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function KnowledgeGapsDialog({
  open,
  onOpenChange,
  agentId,
  canManage,
  onWriteAnswer,
}: Props) {
  const [gaps, setGaps] = useState<KnowledgeGap[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Bumped by "Try again" to re-run the fetch effect. Effects must not reset
  // state synchronously (react-hooks/set-state-in-effect), so a retry is
  // modelled as a new input rather than an in-effect reset.
  const [reloadKey, setReloadKey] = useState(0);

  // Gaps accrue continuously from live conversations, so this component is
  // mounted only while the dialog is open (see the `open &&` guard at the call
  // site) and fetches once per mount — no cached, stale list.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ limit: "50", days: "90" });
        if (agentId) params.set("agentId", agentId);
        const data = await clientApi.get<{ items: KnowledgeGap[] }>(
          `/analytics/knowledge-gaps?${params.toString()}`,
        );
        if (!cancelled) setGaps(data.items ?? []);
      } catch (err) {
        // Leave `gaps` null on failure. Setting it to [] would render the
        // "No gaps right now" empty state next to the error banner, telling the
        // operator their knowledge base is complete when we simply never got an
        // answer — the opposite of the truth.
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load knowledge gaps.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, reloadKey]);

  async function dismiss(gap: KnowledgeGap) {
    setBusyId(gap._id);
    setError(null);
    try {
      await clientApi.patch(`/analytics/knowledge-gaps/${gap._id}`, { status: "addressed" });
      setGaps((prev) => prev?.filter((g) => g._id !== gap._id) ?? prev);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update the gap.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Suggested gaps
          </DialogTitle>
          <DialogDescription>
            Questions real customers asked that your knowledge base could not answer, ranked by how
            often they came up. Answer the top ones first.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {gaps === null ? (
          error ? (
            // Errored before we ever had a list — offer a retry, not an empty state.
            <div className="py-8 text-center">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setError(null);
                  setReloadKey((k) => k + 1);
                }}
              >
                Try again
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Looking for gaps…
            </div>
          )
        ) : gaps.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface/40 p-10 text-center">
            <MessageCircleQuestion className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
            <div className="mt-3 font-display text-base font-semibold">No gaps right now</div>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Gaps are detected automatically: when a customer asks something and nothing in your
              knowledge base scores well enough, the question is logged here. Nothing has fallen
              through in the last 90 days.
            </p>
          </div>
        ) : (
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {gaps.map((gap) => {
              const score = scoreLabel(gap.maxKbScore);
              return (
                <div
                  key={gap._id}
                  className="rounded-lg border border-border bg-card p-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{gap.question}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        searched for “{gap.queryUsed}” · <span className={score.tone}>{score.text}</span> ·
                        last asked {timeAgo(gap.updatedAt)}
                      </p>
                    </div>
                    <span
                      className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold"
                      title="Number of times customers hit this gap"
                    >
                      ×{gap.occurrenceCount}
                    </span>
                  </div>

                  {canManage && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={busyId === gap._id}
                        onClick={() => onWriteAnswer(gap.question)}
                      >
                        <Sparkles className="h-3.5 w-3.5" /> Write answer
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5 text-muted-foreground"
                        disabled={busyId === gap._id}
                        onClick={() => void dismiss(gap)}
                      >
                        {busyId === gap._id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Detected from live conversations — a gap is logged when the best knowledge-base match
          scores below the agent&apos;s gap threshold.
        </p>
      </DialogContent>
    </Dialog>
  );
}
