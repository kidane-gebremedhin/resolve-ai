// Extracted text is stored on the KnowledgeSource row, and MongoDB caps a
// document at 16MB. A file under the 25MB upload cap can carry more text than
// that. It used to fail with a raw BSON RangeError: a 500 on upload, or, on the
// ingest path, a source stuck in `processing` because the catch block's own
// save hit the same oversized field.

import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../test/app.js";
import { createOrgWithOwner, grantPlan } from "../test/factories.js";
import { KnowledgeSource } from "../models/index.js";
import { ingestCrawlResults } from "../services/kb/firecrawl.service.js";
import { MAX_EXTRACTED_TEXT_BYTES, ingestSource } from "../services/kb/ingestion.service.js";
import { isPermanent } from "../services/kb/ingestion-errors.js";

const tooBig = () => "Refunds take thirty days. ".repeat(Math.ceil((MAX_EXTRACTED_TEXT_BYTES + 1024) / 26));

const newSource = (extra: Record<string, unknown> = {}) =>
  KnowledgeSource.create({
    organizationId: new mongoose.Types.ObjectId(),
    agentId: new mongoose.Types.ObjectId(),
    type: "text",
    title: "Large",
    contentHash: `l-${new mongoose.Types.ObjectId()}`,
    createdBy: new mongoose.Types.ObjectId(),
    ...extra,
  });

describe("text too large to store", () => {
  it("rejects the upload with a 400 and a reason, and creates nothing", async () => {
    const app = createApp();
    const owner = await createOrgWithOwner(app, { email: `big-${Date.now()}@example.com` });
    await grantPlan(owner.orgId);
    const res = await request(app)
      .post("/api/v1/knowledge/upload")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .attach("file", Buffer.from(tooBig()), { filename: "huge.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/more text than one source can hold/);
    expect(await KnowledgeSource.countDocuments({ organizationId: owner.orgId })).toBe(0);
  });

  it("ends an ingest as a permanent, readable error instead of stuck in processing", async () => {
    const src = await newSource();
    await expect(ingestSource(src._id.toString(), { kind: "text", text: tooBig() })).rejects.toThrow(/too large/);
    const after = await KnowledgeSource.findById(src._id).lean();
    expect(after!.embeddingStatus).toBe("error");
    expect(after!.embeddingErrorCode).toBe("text_too_large");
    expect(isPermanent("text_too_large")).toBe(true);
    expect(after!.retryCount).toBe(0);
  });

  it("records a too-large crawl the same way", async () => {
    const src = await newSource({ type: "website", embeddingStatus: "processing", embeddingError: "firecrawl:c1" });
    await ingestCrawlResults(src._id.toString(), [{ url: "https://example.com/all", markdown: tooBig() }]);
    const after = await KnowledgeSource.findById(src._id).lean();
    expect(after!.embeddingStatus).toBe("error");
    expect(after!.embeddingErrorCode).toBe("text_too_large");
  });
});
