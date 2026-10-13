/**
 * seed-rag-metrics.ts
 *
 * Seeds RAG Quality dashboard data (`/app/analytics/rag`) into the manual-QA
 * workspace that `db:seed` creates, so the page can be checked against
 * something other than an empty collection.
 *
 * Writes, for the org owned by `owner@example.test` (override with `--email=`):
 *
 *   • 7 knowledge sources: 5 indexed, 1 failed, 1 empty, and the chunks of the
 *     indexed ones. One indexed source is never retrieved, so "never retrieved",
 *     "failing ingestion" and the passage-level health panel all have rows.
 *   • ~240 RagTurnMetric turns spread over the last 60 days, so both the
 *     selected 30-day window and the previous one have data and every
 *     period-over-period delta renders. Scores straddle AI_KB_SEARCH_MIN_SCORE,
 *     some turns widen on empty, some find nothing, ~15% carry a sampled
 *     faithfulness score and a few of those list unsupported claims.
 *   • The conversations those turns belong to, thumbs on some of the replies,
 *     and knowledge gaps for the questions that found nothing.
 *
 * Deterministic (fixed PRNG seed) and idempotent: everything it wrote last
 * time is removed first, by the markers below, and nothing else is touched.
 * Run `db:seed` first.
 *
 * Run with:  pnpm --filter @csb/api db:seed:rag-metrics
 */

import "dotenv/config";
import mongoose from "mongoose";
import {
  Agent,
  Conversation,
  KnowledgeGap,
  KbChunk,
  KnowledgeSource,
  Membership,
  MessageFeedback,
  RagTurnMetric,
  User,
} from "../src/models/index.js";
import { hashContent } from "../src/services/kb/ingestion.service.js";

/* eslint-disable no-console */

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const MONGODB_URI = flag("uri") ?? process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ No Mongo connection string. Set MONGODB_URI or pass --uri=<url>");
  process.exit(1);
}
const EMAIL = flag("email") ?? "owner@example.test";

// Markers that identify this script's rows, so a re-run replaces exactly them.
const MODEL = "seed/rag-metrics";
const THREAD_PREFIX = "seed-rag-";
const HASH_PREFIX = "seed-rag-";

/**
 * The text behind each seeded source. Indexed sources get real text and a real
 * content hash, so a re-index from the dashboard has something to embed and the
 * drift job does not mistake every seeded source for drifted. Sources that never
 * indexed have no text, as in production.
 */
function sourceText(s: (typeof SOURCES)[number]): string | null {
  if (s.status !== "synced") return null;
  return Array.from({ length: s.chunks }, (_, n) => `${s.title}, section ${n + 1}. Seeded passage for the RAG Quality page.`).join("\n\n");
}
const sourceHash = (s: (typeof SOURCES)[number]) => hashContent(sourceText(s) ?? `${HASH_PREFIX}${s.key}`);

// mulberry32: small, deterministic, good enough for fixture data.
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(39);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

const SOURCES = [
  { key: "refunds", title: "Refund policy", status: "synced", chunks: 6 },
  { key: "shipping", title: "Shipping and delivery", status: "synced", chunks: 9 },
  { key: "billing", title: "Billing FAQ", status: "synced", chunks: 4 },
  { key: "legacy", title: "Legacy API reference (v1)", status: "synced", chunks: 14 },
  // Indexed, never retrieved by any seeded turn: dead weight.
  { key: "holiday", title: "Holiday opening hours 2023", status: "synced", chunks: 3 },
  { key: "pricing-pdf", title: "Enterprise pricing.pdf", status: "error", chunks: 0 },
  { key: "careers", title: "Careers page", status: "empty", chunks: 0 },
] as const;

const ANSWERED = [
  { q: "how long do refunds take", src: ["refunds"] },
  { q: "can I return a sale item", src: ["refunds"] },
  { q: "do you ship to canada", src: ["shipping"] },
  { q: "where is my order", src: ["shipping"] },
  { q: "how do I update my card", src: ["billing"] },
  { q: "why was I charged twice", src: ["billing", "refunds"] },
  { q: "what is the delivery time for express", src: ["shipping"] },
] as const;

const UNANSWERED = [
  "do you offer a student discount",
  "is there a mobile app",
  "how do I export my data to [EMAIL]",
  "can I change my username",
] as const;

const UNSUPPORTED = [
  { claim: "Refunds are processed within 3 business days.", verdict: "contradicted", reason: "The policy gives 5 to 10 business days." },
  { claim: "Express shipping is free on all orders.", verdict: "unsupported", reason: "No passage mentions free express shipping." },
  { claim: "You can pay with PayPal.", verdict: "unsupported", reason: "The billing FAQ lists cards only." },
] as const;

async function main(): Promise<void> {
  await mongoose.connect(MONGODB_URI!);

  const user = await User.findOne({ email: EMAIL }).lean();
  if (!user) throw new Error(`No user ${EMAIL}. Run \`pnpm db:seed\` first.`);
  const membership = await Membership.findOne({ userId: user._id, status: "active" }).lean();
  if (!membership) throw new Error(`${EMAIL} has no active membership.`);
  const orgId = membership.organizationId;
  const agent = await Agent.findOne({ organizationId: orgId }).lean();
  if (!agent) throw new Error("The workspace has no agent. Run `pnpm db:seed` first.");

  // ---- Clear the previous run ----
  const oldConversations = await Conversation.find(
    { organizationId: orgId, threadId: { $regex: `^${THREAD_PREFIX}` } },
    { _id: 1 },
  ).lean();
  const oldIds = oldConversations.map((c) => c._id);
  const seededSourceMatch = {
    organizationId: orgId,
    // The second clause catches rows from earlier runs, which used a marker hash.
    $or: [{ contentHash: { $in: SOURCES.map(sourceHash) } }, { contentHash: { $regex: `^${HASH_PREFIX}` } }],
  };
  // Passages are removed by source, not by marker: a re-index from the
  // dashboard writes fresh chunks that do not carry the seed's marker.
  const oldSourceIds = (await KnowledgeSource.find(seededSourceMatch, { _id: 1 }).lean()).map((s) => s._id);
  await Promise.all([
    RagTurnMetric.deleteMany({ organizationId: orgId, "generation.model": MODEL }),
    MessageFeedback.deleteMany({ organizationId: orgId, conversationId: { $in: oldIds } }),
    Conversation.deleteMany({ _id: { $in: oldIds } }),
    KnowledgeGap.deleteMany({ organizationId: orgId, queryUsed: { $in: [...UNANSWERED] } }),
    KnowledgeSource.deleteMany(seededSourceMatch),
    KbChunk.deleteMany({
      organizationId: orgId,
      $or: [{ sourceId: { $in: oldSourceIds } }, { url: `${HASH_PREFIX}chunk` }],
    }),
  ]);

  // ---- Sources ----
  const sources = await KnowledgeSource.insertMany(
    SOURCES.map((s) => ({
      organizationId: orgId,
      agentId: agent._id,
      type: s.key.endsWith("pdf") ? "pdf" : "text",
      title: s.title,
      contentHash: sourceHash(s),
      ...(sourceText(s) ? { content: sourceText(s), extractedText: sourceText(s) } : {}),
      embeddingStatus: s.status,
      chunkCount: s.chunks,
      createdBy: user._id,
    })),
  );
  const sourceId = Object.fromEntries(SOURCES.map((s, i) => [s.key, String(sources[i]!._id)]));

  // Chunk ids match the `${sourceId}:${n}` ids the turns below record, so
  // passages 0 and 1 of a retrieved source carry telemetry and the rest are
  // dead weight. `url` marks them as this script's for the next clean-up.
  await KbChunk.insertMany(
    SOURCES.flatMap((s) =>
      Array.from({ length: s.chunks }, (_, n) => ({
        organizationId: orgId,
        agentId: agent._id,
        sourceId: sourceId[s.key],
        chunkIndex: n,
        chunkId: `${sourceId[s.key]}:${n}`,
        text: `${s.title}, section ${n + 1}. Seeded passage for the RAG Quality page.`,
        headingPath: [s.title],
        url: `${HASH_PREFIX}chunk`,
      })),
    ),
  );

  // An established corpus: indexed well before the 60 days of telemetry below.
  // Dead weight is only judged for content indexed for the whole window, so
  // sources created "now" would never show up as never retrieved. Through the
  // driver, because Mongoose strips `createdAt` from updates.
  const indexedAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  await KnowledgeSource.collection.updateMany(
    { _id: { $in: sources.map((s) => s._id) } },
    { $set: { createdAt: indexedAt } },
  );
  await KbChunk.collection.updateMany(
    { organizationId: orgId, url: `${HASH_PREFIX}chunk` },
    { $set: { createdAt: indexedAt } },
  );

  // ---- Conversations ----
  const conversations = await Conversation.insertMany(
    Array.from({ length: 40 }, (_, i) => ({
      threadId: `${THREAD_PREFIX}${i}`,
      organizationId: orgId,
      websiteId: agent.websiteId,
      agentId: agent._id,
      contactSessionId: new mongoose.Types.ObjectId(),
      status: "resolved",
    })),
  );

  // ---- Turns ----
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const minScore = Number(process.env.AI_KB_SEARCH_MIN_SCORE ?? 0.2);
  const turns: Array<{ originalQuery: string } & Record<string, unknown>> = [];
  const feedback: Record<string, unknown>[] = [];

  for (let i = 0; i < 240; i++) {
    // Older window slightly worse, so the deltas show an improvement.
    const daysAgo = rand() * 60;
    const older = daysAgo > 30;
    const conversation = conversations[i % conversations.length]!;
    const messageId = new mongoose.Types.ObjectId();
    const noHit = rand() < (older ? 0.14 : 0.08);

    if (noHit) {
      const q = pick(UNANSWERED);
      turns.push({
        organizationId: orgId, agentId: agent._id, conversationId: conversation._id, messageId,
        originalQuery: q, rewrittenQuery: q,
        retrieval: {
          topK: 8, minScore, hitCount: 0, topScore: null, meanScore: null, scoreSpread: null,
          retrievalConfidence: 0, widenedOnEmpty: true, sourceIds: [], chunks: [],
          latencyMs: 90 + Math.round(rand() * 120), searchCount: 1,
        },
        generation: {
          confidence: 0.2 + rand() * 0.2, action: rand() < 0.6 ? "escalate" : "reply",
          citationCount: 0, citedSourceIds: [], answerLength: 140, model: MODEL,
          promptTokens: 900, completionTokens: 80, costUsd: 0.0009, latencyMs: 700,
        },
        flags: { noHits: true, lowConfidence: true, escalated: rand() < 0.6, conflicted: false },
        toolTurns: 1, faithfulness: { sampled: false, score: null, claimCount: null, unsupported: [] },
        status: "ok", durationMs: 1800 + Math.round(rand() * 1500),
        createdAt: new Date(now - daysAgo * day),
      });
      continue;
    }

    const a = pick(ANSWERED);
    const cited = a.src.map((k) => sourceId[k]!);
    // Ranked list: the cited sources, sometimes behind a distractor.
    const distractor = sourceId[pick(["legacy", "billing", "shipping"] as const)]!;
    const ranked = rand() < 0.3 ? [distractor, ...cited] : [...cited, distractor];
    const sourceIds = [...new Set(ranked)];
    // Scores mostly well clear of the floor, with a tail that straddles it.
    const topScore = clamp(rand() < 0.12 ? minScore - 0.08 + rand() * 0.16 : 0.45 + rand() * 0.45 - (older ? 0.05 : 0));
    const confidence = clamp(topScore + 0.15 + (rand() - 0.5) * 0.3);
    const sampled = rand() < 0.15;
    const unsupported = sampled && rand() < 0.3 ? [pick(UNSUPPORTED)] : [];
    const chunks = sourceIds.flatMap((sid, rank) =>
      [0, 1].map((n) => ({
        chunkId: `${sid}:${n}`, sourceId: sid, rank: rank * 2 + n,
        score: clamp(topScore - (rank * 2 + n) * 0.05), rerankScore: null,
        cited: cited.includes(sid) && n === 0,
      })),
    );
    const escalated = confidence < 0.5 && rand() < 0.5;
    const priced = rand() > 0.05;

    turns.push({
      organizationId: orgId, agentId: agent._id, conversationId: conversation._id, messageId,
      originalQuery: a.q, rewrittenQuery: a.q,
      retrieval: {
        topK: 8, minScore, hitCount: chunks.length, topScore,
        meanScore: clamp(topScore - 0.08), scoreSpread: 0.12,
        retrievalConfidence: clamp(topScore + 0.1), widenedOnEmpty: topScore < minScore,
        sourceIds, chunks, latencyMs: 80 + Math.round(rand() * 160), searchCount: 1,
      },
      generation: {
        confidence, action: escalated ? "escalate" : "reply",
        citationCount: cited.length, citedSourceIds: cited, answerLength: 300 + Math.round(rand() * 400),
        model: MODEL,
        promptTokens: priced ? 1800 + Math.round(rand() * 1200) : null,
        completionTokens: priced ? 150 + Math.round(rand() * 200) : null,
        costUsd: priced ? Number((0.0015 + rand() * 0.002).toFixed(5)) : null,
        latencyMs: 900 + Math.round(rand() * 900),
      },
      flags: { noHits: false, lowConfidence: confidence < 0.7, escalated, conflicted: false },
      toolTurns: 2,
      faithfulness: sampled
        ? {
            sampled: true,
            score: unsupported.length ? 0.5 + rand() * 0.25 : 0.9 + rand() * 0.1,
            claimCount: 4, unsupported,
            judgeModel: "seed/judge", judgedAt: new Date(now - daysAgo * day), skippedReason: null,
          }
        : { sampled: false, score: null, claimCount: null, unsupported: [] },
      status: "ok",
      // A slow tail, so p95 sits well above p50.
      durationMs: (rand() < 0.07 ? 7000 : 1600) + Math.round(rand() * 1600),
      createdAt: new Date(now - daysAgo * day),
    });

    if (rand() < 0.25) {
      feedback.push({
        messageId, conversationId: conversation._id, organizationId: orgId,
        contactSessionId: conversation.contactSessionId,
        rating: unsupported.length || confidence < 0.6 ? "down" : rand() < 0.85 ? "up" : "down",
        createdAt: new Date(now - daysAgo * day),
      });
    }
  }

  await RagTurnMetric.insertMany(turns);
  await MessageFeedback.insertMany(feedback);

  // ---- Knowledge gaps for what found nothing ----
  await KnowledgeGap.insertMany(
    UNANSWERED.map((q, i) => ({
      organizationId: orgId, agentId: agent._id,
      question: q.charAt(0).toUpperCase() + q.slice(1) + "?",
      queryUsed: q, maxKbScore: 0.05 + i * 0.03, occurrenceCount: turns.filter((t) => t.originalQuery === q).length,
    })),
  );

  console.log(
    `✅ Seeded ${turns.length} turns, ${feedback.length} thumbs, ${SOURCES.length} sources and ${UNANSWERED.length} gaps for ${EMAIL}.`,
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("❌", err);
  await mongoose.disconnect();
  process.exit(1);
});
