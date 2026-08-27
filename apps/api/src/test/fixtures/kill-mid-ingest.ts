/**
 * A child process that starts an ingest and is killed part-way through.
 *
 * Spawned by `ingestion-recovery.test.ts`. It exists as a real process because
 * the failure being tested is a process death: mocking it would test a mock of
 * SIGKILL, and the property that matters is what the DATABASE looks like when
 * the process stops existing mid-write.
 *
 * Connects, sets a source to `processing` exactly as `ingestSource` does, then
 * signals readiness and blocks forever waiting to be killed.
 */
import mongoose from "mongoose";
import { KnowledgeSource } from "../../models/index.js";

async function main(): Promise<void> {
  const [uri, sourceId] = process.argv.slice(2);
  await mongoose.connect(uri!);

  await KnowledgeSource.updateOne(
    { _id: sourceId },
    { $set: { embeddingStatus: "processing" } },
  );

  // Tell the parent we are mid-ingest, then hang. The parent kills us here.
  process.stdout.write("PROCESSING\n");
  await new Promise(() => {});
}

main().catch((err) => {
  process.stderr.write(String(err));
  process.exit(1);
});
