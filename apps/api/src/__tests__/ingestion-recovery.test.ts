// Recovery from a process death mid-ingest.
//
// The DONE WHEN for this says to test it by actually killing the process, and
// that is the right instruction: the failure is a process ceasing to exist
// between two writes. A mocked crash tests the mock. What matters is what the
// database looks like afterwards — a source marked `processing` with nothing
// running — and whether anything notices.

import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import mongoose from "mongoose";
import { IngestionEvent, KnowledgeSource } from "../models/index.js";
import { env } from "../config/env.js";
import { reconcileOnce } from "../jobs/embedding-reconcile.job.js";

// Resolved from the working directory rather than `import.meta.url`: this
// package compiles under NodeNext, where `import.meta` is rejected. Vitest runs
// with `apps/api` as cwd.
const API_ROOT = process.cwd();
const FIXTURE = path.resolve(API_ROOT, "src/test/fixtures/kill-mid-ingest.ts");

/** Start the child, wait until it reports it is mid-ingest, then SIGKILL it. */
function killMidIngest(uri: string, sourceId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", FIXTURE, uri, sourceId], {
      cwd: API_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("child never reported PROCESSING"));
    }, 60_000);

    child.stdout.on("data", (buf: Buffer) => {
      if (buf.toString().includes("PROCESSING")) {
        clearTimeout(timer);
        // SIGKILL, not SIGTERM: no cleanup handler gets to run, which is the
        // whole point. A graceful shutdown is a different scenario.
        child.kill("SIGKILL");
        child.on("exit", () => resolve());
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("a process killed mid-ingest", () => {
  it(
    "leaves a stranded source that the reconcile job recovers, visibly",
    async () => {
      const source = await KnowledgeSource.create({
        organizationId: new mongoose.Types.ObjectId(),
        agentId: new mongoose.Types.ObjectId(),
        type: "text",
        title: "Killed mid-ingest",
        content: "Some text that would have been indexed.",
        extractedText: "Some text that would have been indexed.",
        contentHash: `kill-${Date.now()}`,
        createdBy: new mongoose.Types.ObjectId(),
        embeddingStatus: "pending",
      });

      await killMidIngest(process.env.MONGODB_URI!, source._id.toString());

      // The state a crash actually leaves behind: `processing`, with nothing
      // running. Nothing in the system would ever revisit it on its own.
      const stranded = await KnowledgeSource.findById(source._id).lean();
      expect(stranded!.embeddingStatus).toBe("processing");

      // Not yet old enough to be considered stuck, so the job leaves it alone —
      // an ingest that is genuinely in flight must not be interrupted.
      await reconcileOnce();
      expect(await IngestionEvent.countDocuments({ sourceId: source._id, stage: "recover" })).toBe(0);

      // Age it past the configured threshold.
      await KnowledgeSource.updateOne(
        { _id: source._id },
        { $set: { updatedAt: new Date(Date.now() - env.kb.ingestStuckProcessingMs - 60_000) } },
        { timestamps: false },
      );

      await reconcileOnce();

      // Recovered, and the recovery is visible rather than silent — an operator
      // can now see that this source was re-ingested, which was the gap.
      const events = await IngestionEvent.find({ sourceId: source._id, stage: "recover" }).lean();
      expect(events).toHaveLength(1);
      expect(events[0]!.status).toBe("ok");
      expect(events[0]!.errorMessage).toMatch(/interrupted/i);

      const after = await KnowledgeSource.findById(source._id).lean();
      expect(after!.embeddingStatus).not.toBe("processing");
    },
    120_000,
  );
});
