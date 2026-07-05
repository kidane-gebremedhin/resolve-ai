/**
 * wipe-all-data.ts
 *
 * Drops ALL application data from MongoDB, deletes ALL vectors from Pinecone
 * (every namespace), removes ALL uploaded attachments (local disk or MinIO), and
 * cancels ALL subscriptions in the platform's Paddle account (PADDLE_API_KEY).
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

    // List all namespaces (vectors are currently upserted into the default
    // namespace; org-scoped namespaces are planned for a future migration).
    // Wipe each namespace individually so nothing is left behind.
    let namespaces: string[] = [];
    try {
        const stats = await index.describeIndexStats();
        namespaces = Object.keys(stats.namespaces ?? {});
    } catch {
        // describeIndexStats may be unsupported on some index types — fall back
        // to wiping the default namespace only.
    }

    if (namespaces.length === 0) {
        // No named namespaces found — wipe the default (unnamed) namespace.
        console.log(`🗑️  Deleting all vectors from index "${indexName}" (default namespace) …`);
        await index.deleteAll();
        console.log("✅ Pinecone index wiped\n");
        return;
    }

    console.log(`🗑️  Deleting vectors from ${namespaces.length} namespace(s) in "${indexName}" …`);
    for (const ns of namespaces) {
        await index.namespace(ns).deleteAll();
        console.log(`   ✓ namespace "${ns}" wiped`);
    }
    // Also wipe the default (unnamed) namespace in case anything landed there.
    await index.deleteAll();
    console.log("✅ Pinecone index wiped\n");
}

// Cancels ALL subscriptions in the platform's own Paddle account (the one behind
// PADDLE_API_KEY — i.e. the SaaS's billing, the subs created while testing checkout/
// upgrade flows). Paddle has no "delete subscription", so every non-canceled sub is
// canceled immediately. Uses the env key + PADDLE_ENVIRONMENT, independent of Mongo.
async function wipePaddle(): Promise<void> {
    const apiKey = process.env.PADDLE_API_KEY;
    if (!apiKey) {
        console.log("⏭️  Skipping Paddle (PADDLE_API_KEY not set)");
        return;
    }
    const sandbox = (process.env.PADDLE_ENVIRONMENT ?? "sandbox").toLowerCase() !== "production";
    const baseUrl = sandbox ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
    const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    console.log(`🔌 Connecting to Paddle (${sandbox ? "sandbox" : "production"}) …`);

    let after: string | undefined;
    let canceled = 0;
    let failed = 0;
    // Page through every non-canceled subscription and cancel it immediately.
    for (let page = 0; page < 1000; page++) {
        const url = new URL(`${baseUrl}/subscriptions`);
        url.searchParams.set("per_page", "100");
        for (const s of ["active", "trialing", "paused", "past_due"]) url.searchParams.append("status", s);
        if (after) url.searchParams.set("after", after);

        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`list subscriptions HTTP ${res.status}`);
        const body = (await res.json()) as {
            data?: { id: string }[];
            meta?: { pagination?: { has_more?: boolean } };
        };
        const subs = body.data ?? [];
        if (subs.length === 0) break;

        for (const sub of subs) {
            const c = await fetch(`${baseUrl}/subscriptions/${sub.id}/cancel`, {
                method: "POST",
                headers,
                body: JSON.stringify({ effective_from: "immediately" }),
            });
            if (c.ok) {
                canceled++;
            } else {
                failed++;
                console.log(`   ⚠️  ${sub.id}: cancel HTTP ${c.status}`);
            }
        }

        if (!body.meta?.pagination?.has_more) break;
        after = subs[subs.length - 1]!.id;
    }
    console.log(`✅ Paddle subscriptions canceled (${canceled} canceled${failed ? `, ${failed} failed` : ""})\n`);
}

// Removes all uploaded attachments. Mirrors the storage adapter selection in
// apps/api/src/config/storage.ts: MinIO when MINIO_ENDPOINT + MINIO_ACCESS_KEY
// are set, otherwise the local-disk adapter.
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

    // Local-disk adapter. Prefer STORAGE_LOCAL_PATH from env, fall back to ./uploads.
    const localPath = process.env.STORAGE_LOCAL_PATH ?? "./uploads";
    const dir = path.resolve(process.cwd(), localPath);
    await rm(dir, { recursive: true, force: true });
    console.log(`✅ Local attachments wiped (${dir})\n`);
}

// Run a wipe phase independently — a failure in one (e.g. Pinecone unreachable
// offline) must NOT abort the others.
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
        step("Paddle", wipePaddle),
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
