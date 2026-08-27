"use client";

// The stage-by-stage record of what happened when this source was indexed.
//
// Grouped by run, because a source that failed and was retried four times is a
// different situation from one that failed once — and the status column shows
// only the latest outcome, which is what made repeated silent retries invisible.

import { useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Clock, SkipForward } from "lucide-react";
import { clientApi } from "@/lib/api";

type Stage = {
  stage: string;
  status: "ok" | "error" | "skipped";
  durationMs: number | null;
  chunkCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorAction: string | null;
  createdAt: string;
};

type Run = {
  runId: string;
  attempt: number;
  startedAt: string | null;
  failed: boolean;
  stages: Stage[];
};

const STAGE_LABEL: Record<string, string> = {
  parse: "Read the file",
  chunk: "Split into passages",
  embed: "Generate embeddings",
  upsert: "Write to the search index",
  cleanup: "Remove stale vectors",
  retry: "Automatic retry",
  recover: "Recovered after interruption",
};

function StageIcon({ status }: { status: Stage["status"] }) {
  if (status === "error") return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  if (status === "skipped") return <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />;
  return <Check className="h-3.5 w-3.5 text-success" />;
}

export function IngestionTimeline({ sourceId }: { sourceId: string }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    clientApi
      .get<{ runs: Run[] }>(`/knowledge/${sourceId}/events`)
      .then((res) => {
        if (cancelled) return;
        setRuns(res.runs);
        // Open the most recent run by default: it is the one being diagnosed.
        setExpanded(res.runs[0]?.runId ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load the indexing history.");
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  if (error) return <p className="text-xs text-muted-foreground">{error}</p>;
  if (!runs) return <p className="text-xs text-muted-foreground">Loading indexing history…</p>;
  if (runs.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No indexing history yet. Events are recorded from the next run onward.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="ingestion-timeline">
      {runs.map((run) => (
        <div key={run.runId} className="rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setExpanded(expanded === run.runId ? null : run.runId)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
          >
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform ${expanded === run.runId ? "rotate-90" : ""}`}
            />
            <span className="font-medium">Attempt {run.attempt}</span>
            <span className={run.failed ? "text-destructive" : "text-success"}>
              {run.failed ? "failed" : "succeeded"}
            </span>
            <span className="ml-auto flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}
            </span>
          </button>

          {expanded === run.runId && (
            <ul className="space-y-2 border-t border-border px-3 py-2">
              {run.stages.map((s, i) => (
                <li key={`${run.runId}-${i}`} className="flex gap-2 text-xs">
                  <span className="mt-0.5">
                    <StageIcon status={s.status} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{STAGE_LABEL[s.stage] ?? s.stage}</span>
                      {s.durationMs !== null && (
                        <span className="text-muted-foreground">{s.durationMs}ms</span>
                      )}
                      {s.chunkCount !== null && (
                        <span className="text-muted-foreground">{s.chunkCount} passages</span>
                      )}
                    </div>
                    {s.errorMessage && (
                      <p className="mt-0.5 text-destructive">{s.errorMessage}</p>
                    )}
                    {/* The suggested fix is the point of classifying at all. */}
                    {s.errorAction && (
                      <p className="mt-0.5 text-muted-foreground">{s.errorAction}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
