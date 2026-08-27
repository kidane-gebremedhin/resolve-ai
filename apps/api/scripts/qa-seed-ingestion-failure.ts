/**
 * QA fixture for P8: a source that failed permanently, with a stage timeline.
 *
 * Seeds the state the reconcile job would have produced for an unsupported file
 * type — terminal, retries exhausted without being spent, and an event trail
 * showing why.
 */
import "dotenv/config";
import { connectDb, disconnectDb } from "../src/config/db.js";
import { Agent, IngestionEvent, KnowledgeSource, Website } from "../src/models/index.js";
import { describeError } from "../src/services/kb/ingestion-errors.js";
import { randomUUID } from "node:crypto";

async function main(): Promise<void> {
  await connectDb();
  const website = await Website.findOne({ domain: /acme/ }).lean();
  if (!website) throw new Error("run pnpm --filter @csb/api db:seed first");
  const agent = await Agent.findOne({ websiteId: website._id }).lean();

  await KnowledgeSource.deleteMany({ title: "Scanned Contract.pdf" });
  const classified = describeError("parse_failure");

  const source = await KnowledgeSource.create({
    organizationId: website.organizationId,
    agentId: agent!._id,
    type: "pdf",
    title: "Scanned Contract.pdf",
    fileName: "Scanned Contract.pdf",
    contentHash: `qa-${randomUUID()}`,
    createdBy: agent!._id,
    embeddingStatus: "error",
    embeddingError: classified.message,
    embeddingErrorCode: classified.code,
    embeddingErrorAction: classified.action,
    retryCount: 3,
    content: "(the PDF could not be opened)",
  });

  const runA = randomUUID();
  const runB = randomUUID();
  await IngestionEvent.insertMany([
    { sourceId: source._id, organizationId: website.organizationId, stage: "parse", status: "error",
      durationMs: 412, errorCode: classified.code, errorMessage: classified.message,
      errorAction: classified.action, attempt: 1, runId: runA,
      createdAt: new Date(Date.now() - 600_000) },
    { sourceId: source._id, organizationId: website.organizationId, stage: "retry", status: "ok",
      errorMessage: "Retrying after parse_failure (attempt 2 of 3)", attempt: 2, runId: runB,
      createdAt: new Date(Date.now() - 300_000) },
    { sourceId: source._id, organizationId: website.organizationId, stage: "parse", status: "error",
      durationMs: 388, errorCode: classified.code, errorMessage: classified.message,
      errorAction: classified.action, attempt: 2, runId: runB,
      createdAt: new Date(Date.now() - 299_000) },
  ]);

  console.log("sourceId:", source._id.toString());
  await disconnectDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
