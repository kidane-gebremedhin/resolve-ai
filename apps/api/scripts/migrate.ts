// Index sync — Mongoose auto-creates indexes when autoIndex is true.
// In production we disable autoIndex and run this script explicitly.
import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../src/config/db.js";
import "../src/models/index.js";

async function main() {
  await connectDb();
  for (const [name, model] of Object.entries(mongoose.models)) {
    // eslint-disable-next-line no-console
    console.log(`[migrate] syncing indexes for ${name}`);
    await model.syncIndexes();
  }
  await disconnectDb();
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("[migrate] failed", err);
  await mongoose.disconnect();
  process.exit(1);
});
