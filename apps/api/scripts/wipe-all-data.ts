/**
 * wipe-all-data.ts
 *
 * Drops ALL application data from MongoDB and deletes ALL vectors from Pinecone.
 * Run with:  pnpm --filter @csb/api db:wipe
 *
 * ⚠️  DESTRUCTIVE — there is no undo!
 */

import "dotenv/config";
import mongoose from "mongoose";
import { Pinecone } from "@pinecone-database/pinecone";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI is not set");
    process.exit(1);
}

async function wipeMongo(): Promise<void> {
    console.log("🔌 Connecting to MongoDB …");
    await mongoose.connect(MONGODB_URI!);
    const db = mongoose.connection.db;
    if (!db) throw new Error("No database connection");

    const collections = await db.listCollections().toArray();
    console.log(`📦 Found ${collections.length} collection(s)`);

    for (const col of collections) {
        const count = await db.collection(col.name).countDocuments();
        await db.collection(col.name).deleteMany({});
        console.log(`   ✓ ${col.name}: ${count} document(s) deleted`);
    }

    await mongoose.disconnect();
    console.log("✅ MongoDB wiped\n");
}

async function wipePinecone(): Promise<void> {
    const apiKey = process.env.PINECONE_API_KEY;
    const indexName = process.env.PINECONE_INDEX;
    if (!apiKey || !indexName) {
        console.log("⏭️  Skipping Pinecone (PINECONE_API_KEY or PINECONE_INDEX not set)");
        return;
    }

    console.log("🔌 Connecting to Pinecone …");
    const pc = new Pinecone({ apiKey });
    const index = pc.index(indexName);

    // deleteAll removes every vector in the default namespace.
    console.log(`🗑️  Deleting all vectors from index "${indexName}" …`);
    await index.deleteAll();
    console.log("✅ Pinecone index wiped\n");
}

async function main() {
    console.log("\n🚨 WIPING ALL DATA 🚨\n");
    await wipeMongo();
    await wipePinecone();
    console.log("🎉 All data has been wiped. Start fresh!\n");
}

main().catch((err) => {
    console.error("💥 Wipe failed:", err);
    process.exit(1);
});
