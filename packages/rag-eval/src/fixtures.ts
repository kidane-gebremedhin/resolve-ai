/**
 * Fixture workspace: a dedicated organization, agent and knowledge base that the
 * harness owns end to end.
 *
 * Two properties matter more than anything else here.
 *
 * First, **no live customer data**. Everything is created under a fixture org
 * with a fixed slug, and retrieval is scoped by `(organizationId, agentId)` the
 * same way production scopes it, so an eval run cannot read a real tenant's
 * knowledge even by accident.
 *
 * Second, **ingestion goes through the real pipeline**. The fixture documents
 * are written as `KnowledgeSource` rows and pushed through `ingestSource`, which
 * chunks, embeds and upserts to Pinecone exactly as an operator upload would.
 * Seeding vectors by hand would measure a pipeline that does not exist.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import {
  Agent,
  ContactSession,
  KnowledgeSource,
  Organization,
  User,
  Website,
} from "@api/models/index.js";
import { ingestSource } from "@api/services/kb/ingestion.service.js";

export const FIXTURE_ORG_SLUG = "rag-eval-fixture";
const FIXTURE_EMAIL = "rag-eval@fixture.invalid";
const FIXTURE_DOMAIN = "rag-eval.fixture.invalid";

export type FixtureWorkspace = {
  organizationId: string;
  websiteId: string;
  agentId: string;
  contactSessionId: string;
  /** Fixture document slug (the markdown filename) to its `KnowledgeSource` id. */
  sourceIdBySlug: Record<string, string>;
};

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Create or refresh the fixture workspace and return its ids.
 *
 * Idempotent by design: re-running reuses the same org, agent and sources, and
 * re-ingests a document only when its content hash changed. A full eval run
 * therefore costs embedding tokens once, not once per run.
 */
export async function ensureFixtureWorkspace(opts: {
  kbDir: string;
  /** Re-ingest every document even when its hash is unchanged. */
  force?: boolean;
  log?: (msg: string) => void;
}): Promise<FixtureWorkspace> {
  const log = opts.log ?? (() => {});

  const org = await Organization.findOneAndUpdate(
    { slug: FIXTURE_ORG_SLUG },
    { $setOnInsert: { name: "RAG Eval Fixture", slug: FIXTURE_ORG_SLUG } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const user = await User.findOneAndUpdate(
    { email: FIXTURE_EMAIL },
    {
      $setOnInsert: {
        email: FIXTURE_EMAIL,
        name: "RAG Eval Fixture",
        provider: "credentials",
        role: "user",
        // Never a real credential: this account exists only to satisfy
        // `KnowledgeSource.createdBy` and can never be logged into.
        passwordHash: "rag-eval-fixture-not-a-login",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const website = await Website.findOneAndUpdate(
    { organizationId: org._id, domain: FIXTURE_DOMAIN },
    {
      $setOnInsert: {
        organizationId: org._id,
        name: "RAG Eval Fixture",
        domain: FIXTURE_DOMAIN,
        allowedOrigins: [],
        isActive: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const agent = await Agent.findOneAndUpdate(
    { organizationId: org._id, websiteId: website._id, name: "RAG Eval Agent" },
    {
      $setOnInsert: {
        organizationId: org._id,
        websiteId: website._id,
        name: "RAG Eval Agent",
        isActive: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const contactSession = await ContactSession.findOneAndUpdate(
    { organizationId: org._id, token: "rag-eval-fixture-session" },
    {
      $setOnInsert: {
        organizationId: org._id,
        websiteId: website._id,
        token: "rag-eval-fixture-session",
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
      $set: { lastActiveAt: new Date() },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const files = (await readdir(opts.kbDir)).filter((f) => f.endsWith(".md")).sort();
  if (files.length === 0) throw new Error(`No fixture documents found in ${opts.kbDir}`);

  const sourceIdBySlug: Record<string, string> = {};

  for (const file of files) {
    const slug = path.basename(file, ".md");
    const text = await readFile(path.join(opts.kbDir, file), "utf8");
    const contentHash = hash(text);

    let source = await KnowledgeSource.findOne({
      organizationId: org._id,
      agentId: agent._id,
      title: slug,
    });

    const needsIngest =
      opts.force ||
      !source ||
      source.contentHash !== contentHash ||
      source.embeddingStatus !== "synced" ||
      (source.pineconeIds?.length ?? 0) === 0;

    if (!source) {
      source = await KnowledgeSource.create({
        organizationId: org._id,
        agentId: agent._id,
        type: "text",
        title: slug,
        content: text,
        extractedText: text,
        contentHash,
        createdBy: user._id,
        embeddingStatus: "pending",
      });
    } else if (needsIngest) {
      source.content = text;
      source.extractedText = text;
      source.contentHash = contentHash;
      source.embeddingStatus = "pending";
      await source.save();
    }

    sourceIdBySlug[slug] = source._id.toString();

    if (needsIngest) {
      log(`  ingesting ${slug}…`);
      await ingestSource(source._id.toString());
      const after = await KnowledgeSource.findById(source._id).lean();
      if (after?.embeddingStatus !== "synced") {
        throw new Error(
          `Fixture ingest failed for ${slug}: status=${after?.embeddingStatus} error=${after?.embeddingError ?? "none"}`,
        );
      }
      // A zero-chunk ingest reports success but retrieves nothing, which would
      // silently turn every case against this document into a false negative.
      if (!after.chunkCount) {
        throw new Error(`Fixture ingest produced 0 chunks for ${slug}`);
      }
    } else {
      log(`  ${slug} already ingested, skipping`);
    }
  }

  return {
    organizationId: org._id.toString(),
    websiteId: website._id.toString(),
    agentId: agent._id.toString(),
    contactSessionId: (contactSession._id as mongoose.Types.ObjectId).toString(),
    sourceIdBySlug,
  };
}
