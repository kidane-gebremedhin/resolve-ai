// The pre-launch security checklist (__specs/12 §176-191), as tests.
//
// Sixteen items sat unchecked because verifying them was manual, and manual
// verification is a thing that happens once. Everything below is a control that
// can be asserted from code — so it is, and it stays asserted.
//
// Three of these were genuinely absent when this file was written: magic-byte
// upload validation, log redaction, and authorization on socket room joins.
// (The last has its own file, `socket-room-auth.test.ts`.)

import { readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../test/app.js";
import { createOrgWithOwner, grantPlan } from "../test/factories.js";
import { Writable } from "node:stream";
import winston from "winston";
import { REDACTED, logger, redact } from "../config/logger.js";
import { assertSignatureMatches, detectKind, FileSignatureError } from "../services/kb/file-signature.js";

// ---------------------------------------------------------------------------
// §5 — upload validation by content, not by label
// ---------------------------------------------------------------------------

const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj", "binary");
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
const PE = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
const SCRIPT = Buffer.from("#!/bin/sh\nrm -rf /\n");
const TEXT = Buffer.from("name,email\nAda,ada@example.test\n");

describe("uploads are identified by their bytes", () => {
  it.each([
    ["a PDF", PDF, "pdf"],
    ["a zip/OOXML container", ZIP, "zip"],
    ["a legacy OLE2 document", OLE2, "xls"],
    ["an ELF binary", ELF, "executable"],
    ["a Windows executable", PE, "executable"],
    ["a shell script", SCRIPT, "executable"],
    ["plain text", TEXT, "unknown"],
  ])("recognises %s", (_label, buffer, expected) => {
    expect(detectKind(buffer)).toBe(expected);
  });

  it("accepts a file whose bytes match its claim", () => {
    expect(assertSignatureMatches({ buffer: PDF, declaredType: "pdf", filename: "a.pdf" })).toBe("pdf");
    expect(assertSignatureMatches({ buffer: ZIP, declaredType: "docx", filename: "a.docx" })).toBe("zip");
    expect(assertSignatureMatches({ buffer: OLE2, declaredType: "excel", filename: "a.xls" })).toBe("xls");
  });

  it("refuses an executable renamed as a document", () => {
    // The case the whole control exists for: `Content-Type: application/pdf`,
    // filename `invoice.pdf`, contents a binary.
    for (const [name, buf] of [["ELF", ELF], ["PE", PE], ["script", SCRIPT]] as const) {
      expect(
        () => assertSignatureMatches({ buffer: buf, declaredType: "pdf", filename: "invoice.pdf" }),
        name,
      ).toThrow(FileSignatureError);
    }
  });

  it("refuses an executable even when it claims to be plain text", () => {
    // The allow-list lets text through on "unknown"; an executable must not
    // slip past by claiming the one type with nothing to verify.
    expect(() =>
      assertSignatureMatches({ buffer: ELF, declaredType: "text", filename: "notes.txt" }),
    ).toThrow(FileSignatureError);
  });

  it("refuses a text file dressed up as a PDF", () => {
    expect(() =>
      assertSignatureMatches({ buffer: TEXT, declaredType: "pdf", filename: "report.pdf" }),
    ).toThrow(/labelled as pdf but its contents are not/i);
  });

  it("leaves genuinely signature-less formats alone", () => {
    // CSV, HTML and text have no magic bytes. Inventing a check for them would
    // reject valid uploads to look thorough.
    for (const type of ["csv", "html", "text"]) {
      expect(assertSignatureMatches({ buffer: TEXT, declaredType: type, filename: `a.${type}` })).toBe(
        "unknown",
      );
    }
  });

  it("rejects a mislabelled upload at the API, not at the parser", async () => {
    const app = createApp();
    const owner = await createOrgWithOwner(app, { email: `up-${Date.now()}@example.com` });
    // Uploading consumes plan quota, which is 0 without a plan — the request
    // would 402 before ever reaching the signature check.
    await grantPlan(owner.orgId);
    const res = await request(app)
      .post("/api/v1/knowledge/upload")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .attach("file", ELF, { filename: "policy.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/executable|not a document/i);
  });
});

// ---------------------------------------------------------------------------
// §5.6 / §10 — nothing sensitive reaches a log
// ---------------------------------------------------------------------------

describe("log redaction", () => {
  it("redacts credentials by field name, whatever they contain", () => {
    const out = redact({
      password: "hunter2",
      apiKey: "sk-or-v1-real",
      authorization: "Bearer abc",
      totpSecret: "JBSWY3DP",
      clientSecret: "s3cr3t",
      refreshToken: "rt_live",
    }) as Record<string, string>;
    for (const [k, v] of Object.entries(out)) expect(v, k).toBe(REDACTED);
  });

  it("redacts an unfamiliar field because of what it is called", () => {
    // The point of a name-based rule: it fails closed on things nobody
    // predicted the shape of.
    const out = redact({ webhookSecret: "x", privateKey: "y", accessToken: "z" }) as Record<string, string>;
    expect(Object.values(out)).toEqual([REDACTED, REDACTED, REDACTED]);
  });

  it("keeps personal data out while leaving something to correlate on", () => {
    const out = redact({ email: "ada@example.test" }) as Record<string, string>;
    expect(out.email).not.toContain("ada@example.test");
    expect(out.email).toBe(`${REDACTED}(16)`);
  });

  it("reaches into nested objects and arrays", () => {
    const out = redact({
      user: { name: "Ada", email: "a@b.test" },
      connections: [{ credential: "abc" }, { credential: "def" }],
    }) as { user: Record<string, string>; connections: Record<string, string>[] };
    expect(out.user.name).toBe("Ada");
    expect(out.user.email).toContain(REDACTED);
    expect(out.connections.map((c) => c.credential)).toEqual([REDACTED, REDACTED]);
  });

  it("leaves ordinary diagnostic fields readable", () => {
    // Redaction that eats the useful half of a log is its own outage.
    const out = redact({ organizationId: "abc", durationMs: 42, status: "ok" });
    expect(out).toEqual({ organizationId: "abc", durationMs: 42, status: "ok" });
  });

  it("still actually emits a log line", () => {
    // The regression this catches: redaction was added as a formatter that
    // rebuilt `info` from its string keys, which dropped winston's
    // `Symbol.for("message")` and silenced EVERY log line in the API. Nothing
    // errored. The unit tests above all passed, because they test `redact()`
    // and not the wiring — so this one asserts the transport's output.
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const probe = winston.createLogger({
      format: logger.format,
      transports: [new winston.transports.Stream({ stream: sink })],
    });

    probe.info("hello", { organizationId: "org1", password: "hunter2" });

    expect(lines.length, "the logger emitted nothing").toBe(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.message).toBe("hello");
    expect(parsed.level).toBe("info");
    expect(parsed.organizationId).toBe("org1");
    expect(parsed.password).toBe(REDACTED);
  });

  it("survives a cyclic object rather than hanging the process", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    expect(JSON.stringify(redact(a))).toContain("[Circular]");
  });

  it("bounds depth and breadth so a huge payload cannot stall logging", () => {
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 40; i++) deep = { nested: deep };
    expect(JSON.stringify(redact(deep))).toContain("[Object]");
    expect((redact(new Array(500).fill({ a: 1 })) as unknown[]).length).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Transport and configuration controls
// ---------------------------------------------------------------------------

describe("transport hardening", () => {
  const INDEX = readFileSync(path.resolve(process.cwd(), "src/index.ts"), "utf8");

  it("enables helmet before any route", () => {
    expect(INDEX).toContain("app.use(helmet())");
  });

  it("locks dashboard CORS to the configured allowlist, with credentials", () => {
    expect(INDEX).toContain("cors({ origin: env.corsOrigins, credentials: true })");
    // The widget is embedded on arbitrary customer sites and must reflect any
    // origin — but credentialless, so a cookie cannot ride along.
    expect(INDEX).toContain('app.use("/api/v1/widget", cors({ origin: true }))');
    expect(INDEX).not.toContain('origin: "*", credentials: true');
  });

  it("does not trust the whole proxy chain", () => {
    // `trust proxy: true` lets any client forge X-Forwarded-For and walk
    // through every IP-keyed rate limit.
    expect(INDEX).toContain('app.set("trust proxy", trustProxy)');
    expect(INDEX).not.toMatch(/trust proxy",\s*true/);
  });
});

describe("credentials and configuration", () => {
  const ENV_EXAMPLE = readFileSync(path.resolve(process.cwd(), "../../.env.example"), "utf8");
  const ENV_SRC = readFileSync(path.resolve(process.cwd(), "src/config/env.ts"), "utf8");

  it("hashes passwords at cost 12 or above", () => {
    const src = readFileSync(path.resolve(process.cwd(), "src/services/auth.service.ts"), "utf8");
    const cost = Number(/const BCRYPT_COST = (\d+)/.exec(src)?.[1]);
    expect(cost).toBeGreaterThanOrEqual(12);
  });

  it("documents every required variable in .env.example", () => {
    // A `required()` var missing from the example is a deploy that boots, throws
    // on the first request, and takes someone an hour to diagnose.
    const required = [...ENV_SRC.matchAll(/required\("([A-Z0-9_]+)"\)/g)].map((m) => m[1]!);
    expect(required.length).toBeGreaterThan(5);
    const missing = [...new Set(required)].filter(
      (name) => !new RegExp(`^${name}=`, "m").test(ENV_EXAMPLE),
    );
    expect(missing, `undocumented required env vars: ${missing.join(", ")}`).toEqual([]);
  });

  it("ships no real credential in .env.example", () => {
    // Placeholders only. A live key committed here is a leak in the repository
    // itself, not in a deployment.
    expect(ENV_EXAMPLE).not.toMatch(/sk-or-v1-[a-z0-9]{20,}/i);
    expect(ENV_EXAMPLE).not.toMatch(/pcsk_[A-Za-z0-9_]{20,}/);
    expect(ENV_EXAMPLE).not.toMatch(/\bsk-[A-Za-z0-9]{32,}\b/);
  });
});
