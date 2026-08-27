// Dataset integrity.
//
// The negative-case check is the one that earns its keep. A "negative" case
// whose answer is actually sitting in the fixture KB is not measuring refusal
// correctness, it is measuring a bug in the dataset, and it would quietly
// reward the model for refusing to answer something it should have answered.
// So the claim "the KB genuinely does not contain this" is verified here rather
// than asserted in a comment.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { datasetSchema, isNegativeCase } from "../types.js";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const KB_DIR = path.join(PKG, "fixtures", "kb");

const dataset = datasetSchema.parse(
  JSON.parse(readFileSync(path.join(PKG, "fixtures", "golden.json"), "utf8")),
);
const kbFiles = readdirSync(KB_DIR).filter((f) => f.endsWith(".md"));
const kbText = kbFiles.map((f) => readFileSync(path.join(KB_DIR, f), "utf8")).join("\n").toLowerCase();

/**
 * Word-boundary match, not `includes`.
 *
 * A plain substring search reports "sla" as present because the KB mentions
 * Slack, which would fail a perfectly good negative case and teach whoever hits
 * it to weaken the probe instead of trusting it. Probes are about subjects the
 * KB discusses, and subjects are words.
 */
function mentions(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}
const kbSlugs = new Set(kbFiles.map((f) => path.basename(f, ".md")));

/** Terms that, if present in the KB, would mean the "negative" case is answerable. */
const NEGATIVE_PROBES: Record<string, string[]> = {
  "neg-mobile-app": ["mobile app", "ios app", "android"],
  "neg-uptime-sla": ["uptime", "99.9", "sla"],
  "neg-free-trial": ["free trial", "trial period"],
  "neg-student-discount": ["student discount", "nonprofit", "non-profit"],
  "neg-sso-saml": ["saml", "single sign-on", "single sign on", "okta"],
  "neg-datacenter-provider": ["aws", "amazon web services", "google cloud", "azure"],
  "neg-pdf-export": ["export", "pdf"],
  "neg-phone-number": ["phone number", "call us", "telephone"],
};

describe("golden dataset", () => {
  it("has at least 40 cases", () => {
    expect(dataset.cases.length).toBeGreaterThanOrEqual(40);
  });

  it("covers every case type the harness is meant to measure", () => {
    const tags = new Set(dataset.cases.flatMap((c) => c.tags));
    for (const required of ["fact", "multi-hop", "negative", "paraphrase", "typo", "follow-up"]) {
      expect(tags.has(required), `missing tag: ${required}`).toBe(true);
    }
  });

  it("has unique case ids", () => {
    const ids = dataset.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("references only fixture documents that exist", () => {
    for (const c of dataset.cases) {
      for (const slug of c.expectedSourceIds) {
        expect(kbSlugs.has(slug), `case ${c.id} references unknown document "${slug}"`).toBe(true);
      }
    }
  });

  it("gives every follow-up case the history that makes it meaningful", () => {
    const followUps = dataset.cases.filter((c) => c.tags.includes("follow-up"));
    expect(followUps.length).toBeGreaterThan(0);
    for (const c of followUps) {
      expect(c.history.length, `follow-up ${c.id} has no history`).toBeGreaterThan(0);
    }
  });

  it("gives every non-negative case some expected evidence", () => {
    for (const c of dataset.cases.filter((x) => !x.tags.includes("negative"))) {
      expect(
        c.expectedSourceIds.length + c.expectedChunkIds.length,
        `case ${c.id} declares no evidence but is not tagged negative`,
      ).toBeGreaterThan(0);
    }
  });

  it("treats exactly the negative-tagged cases as negative", () => {
    for (const c of dataset.cases) {
      expect(isNegativeCase(c), `case ${c.id} negative/tag mismatch`).toBe(c.tags.includes("negative"));
    }
  });

  describe("negative cases are genuinely unanswerable from the fixture KB", () => {
    const negatives = dataset.cases.filter((c) => c.tags.includes("negative"));

    it("has a probe for every negative case", () => {
      // Without this, adding a negative case and forgetting its probe would
      // silently skip the verification below.
      for (const c of negatives) {
        expect(NEGATIVE_PROBES[c.id], `no probe defined for ${c.id}`).toBeDefined();
      }
    });

    for (const [id, probes] of Object.entries(NEGATIVE_PROBES)) {
      it(`${id}: the KB mentions none of its subject terms`, () => {
        const found = probes.filter((p) => mentions(kbText, p.toLowerCase()));
        expect(found, `fixture KB answers "${id}" via: ${found.join(", ")}`).toEqual([]);
      });
    }
  });
});
