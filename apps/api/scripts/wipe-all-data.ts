/**
 * wipe-all-data.ts
 *
 * Drops ALL application data from MongoDB, deletes ALL vectors from Pinecone, and
 * removes ALL uploaded attachments (local disk or MinIO bucket).
 * Run with:  pnpm --filter @csb/api db:wipe
 *
 * ⚠️  DESTRUCTIVE — there is no undo!
 */

import "dotenv/config";
import { rm } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { Pinecone } from "@pinecone-database/pinecone";
import { Client as MinioClient } from "minio";

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

// Removes all uploaded attachments. Mirrors the storage adapter selection in
// apps/api/src/config/storage.ts: MinIO when MINIO_ENDPOINT + MINIO_ACCESS_KEY
// are set, otherwise the local-disk adapter (<cwd>/uploads).
async function wipeStorage(): Promise<void> {
    if (process.env.MINIO_ENDPOINT && process.env.MINIO_ACCESS_KEY) {
        const bucket = process.env.MINIO_BUCKET ?? "csb-attachments";
        console.log(`🔌 Connecting to MinIO bucket "${bucket}" …`);
        const client = new MinioClient({
            endPoint: process.env.MINIO_ENDPOINT,
            port: process.env.MINIO_PORT ? Number(process.env.MINIO_PORT) : 9000,
            useSSL: process.env.MINIO_USE_SSL === "true",
            accessKey: process.env.MINIO_ACCESS_KEY,
            secretKey: process.env.MINIO_SECRET_KEY ?? "",
        });
        if (!(await client.bucketExists(bucket))) {
            console.log("⏭️  MinIO bucket does not exist — nothing to wipe\n");
            return;
        }
        const keys: string[] = await new Promise((resolve, reject) => {
            const acc: string[] = [];
            const stream = client.listObjectsV2(bucket, "", true);
            stream.on("data", (o) => o.name && acc.push(o.name));
            stream.on("end", () => resolve(acc));
            stream.on("error", reject);
        });
        if (keys.length) await client.removeObjects(bucket, keys);
        console.log(`✅ MinIO wiped (${keys.length} object(s) removed)\n`);
        return;
    }

    // Local-disk adapter uses <cwd>/uploads (STORAGE_LOCAL_PATH is not consumed
    // by the adapter). Recreated automatically on the next upload.
    const dir = path.resolve(process.cwd(), "uploads");
    await rm(dir, { recursive: true, force: true });
    console.log(`✅ Local attachments wiped (${dir})\n`);
}

// Run a wipe phase independently — a failure in one (e.g. Pinecone unreachable
// offline) must NOT abort the others. Tracks whether anything failed.
async function step(label: string, fn: () => Promise<void>): Promise<boolean> {
    try {
        await fn();
        return true;
    } catch (err) {
        console.error(`⚠️  ${label} failed (continuing):`, (err as Error).message);
        return false;
    }
}

async function main() {
    console.log("\n🚨 WIPING ALL DATA 🚨\n");
    const results = await Promise.all([
        step("MongoDB", wipeMongo),
        step("Pinecone", wipePinecone),
        step("Storage", wipeStorage),
    ]);
    if (results.every(Boolean)) {
        console.log("🎉 All data has been wiped. Start fresh!\n");
    } else {
        console.log("\n⚠️  Wipe finished with some steps skipped (see warnings above).\n");
    }
}

main().catch((err) => {
    console.error("💥 Wipe failed:", err);
    process.exit(1);
});
