// Recording what happened during an ingest.
//
// Two constraints shape this. Events must never fail an ingest — a diagnostic
// write that breaks the thing it is diagnosing is worse than no diagnostics. And
// they must stay off the request path: a single ingest emits up to five stage
// events, so they are buffered per run and flushed once rather than issuing five
// round trips inline.
import { randomUUID } from "node:crypto";
import { IngestionEvent } from "../../models/index.js";
import { logger } from "../../config/logger.js";
import type { ClassifiedError } from "./ingestion-errors.js";

export type IngestionStage = "parse" | "chunk" | "embed" | "upsert" | "cleanup" | "retry" | "recover";

type PendingEvent = {
  stage: IngestionStage;
  status: "ok" | "error" | "skipped";
  durationMs?: number;
  chunkCount?: number;
  byteSize?: number;
  errorCode?: string;
  errorMessage?: string;
  errorAction?: string;
  errorRaw?: string;
};

/**
 * Collects the stages of one ingest run and writes them in a single batch.
 *
 * The `runId` is what makes a timeline readable: it ties five stage rows to one
 * attempt, so an operator looking at a source that has been silently re-ingested
 * four times sees four runs rather than twenty ungrouped rows.
 */
export class IngestionRun {
  readonly runId: string;
  private readonly events: PendingEvent[] = [];
  private stageStartedAt = Date.now();

  constructor(
    private readonly ctx: {
      sourceId: string;
      organizationId: string;
      agentId?: string;
      attempt?: number;
    },
    runId?: string,
  ) {
    this.runId = runId ?? randomUUID();
  }

  /** Mark the start of a stage, so `finish` can report a duration. */
  begin(): void {
    this.stageStartedAt = Date.now();
  }

  ok(stage: IngestionStage, extra: { chunkCount?: number; byteSize?: number } = {}): void {
    this.events.push({
      stage,
      status: "ok",
      durationMs: Date.now() - this.stageStartedAt,
      ...extra,
    });
    this.stageStartedAt = Date.now();
  }

  skipped(stage: IngestionStage, reason: string): void {
    this.events.push({ stage, status: "skipped", errorMessage: reason });
    this.stageStartedAt = Date.now();
  }

  failed(stage: IngestionStage, error: ClassifiedError): void {
    this.events.push({
      stage,
      status: "error",
      durationMs: Date.now() - this.stageStartedAt,
      errorCode: error.code,
      errorMessage: error.message,
      errorAction: error.action,
      ...(error.raw ? { errorRaw: error.raw.slice(0, 2000) } : {}),
    });
    this.stageStartedAt = Date.now();
  }

  /**
   * Write everything recorded so far.
   *
   * Never throws. An ingest that succeeded must not be reported as failed
   * because the audit trail could not be written.
   */
  async flush(): Promise<void> {
    if (this.events.length === 0) return;
    const rows = this.events.map((e) => ({
      ...e,
      sourceId: this.ctx.sourceId,
      organizationId: this.ctx.organizationId,
      ...(this.ctx.agentId ? { agentId: this.ctx.agentId } : {}),
      attempt: this.ctx.attempt ?? 1,
      runId: this.runId,
      createdAt: new Date(),
    }));
    this.events.length = 0;
    try {
      await IngestionEvent.insertMany(rows, { ordered: false });
    } catch (err) {
      logger.warn("[kb] ingestion events could not be written", {
        runId: this.runId,
        sourceId: this.ctx.sourceId,
        err: (err as Error).message,
      });
    }
  }
}

/** One-off event, for callers outside an ingest run (the reconcile job). */
export async function recordIngestionEvent(args: {
  sourceId: string;
  organizationId: string;
  agentId?: string;
  stage: IngestionStage;
  status: "ok" | "error" | "skipped";
  attempt?: number;
  runId?: string;
  errorCode?: string;
  errorMessage?: string;
  errorAction?: string;
}): Promise<void> {
  try {
    await IngestionEvent.create({
      ...args,
      attempt: args.attempt ?? 1,
      runId: args.runId ?? randomUUID(),
      createdAt: new Date(),
    });
  } catch (err) {
    logger.warn("[kb] ingestion event could not be written", { err: (err as Error).message });
  }
}
