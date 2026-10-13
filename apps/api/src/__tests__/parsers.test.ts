// Every supported upload type, parsed for real.
//
// There was no parser test at all, which is how DOCX ingestion stayed broken
// from 2026-08-27: a security override forced `@xmldom/xmldom` 0.9, which
// requires a MIME type that `mammoth` never passes, so every Word upload failed
// at parse and nothing noticed (__specs/38 S2).

import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseFile, sourceTypeFor } from "../services/kb/parsers.js";

const fixture = (name: string) => readFileSync(path.resolve(process.cwd(), "src/test/fixtures", name));

describe("parseFile", () => {
  it("extracts text from a real DOCX", async () => {
    const out = await parseFile({
      buffer: fixture("sample.docx"),
      mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename: "policy.docx",
    });
    expect(out.text).toContain("Refund policy");
    expect(out.text).toContain("Refunds are processed within five business days.");
  });

  it("extracts text from a real PDF", async () => {
    const out = await parseFile({ buffer: fixture("sample.pdf"), mimetype: "application/pdf", filename: "shipping.pdf" });
    expect(out.text).toContain("Shipping takes three to five days.");
  });

  it("reads CSV as text, without SheetJS", async () => {
    const csv = 'id,question,answer\n1,"Do you ship to Canada?","Yes, in five days."\n';
    const out = await parseFile({ buffer: Buffer.from(csv), mimetype: "text/csv", filename: "faq.csv" });
    // Byte-for-byte: no spreadsheet round trip reformatting the rows.
    expect(out.text).toBe(csv);
    expect(sourceTypeFor({ buffer: Buffer.from(csv), mimetype: "text/csv", filename: "faq.csv" })).toBe("csv");
  });

  it("extracts every sheet from an XLSX", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["q", "a"], ["Opening hours?", "9 to 5"]]), "FAQ");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const out = await parseFile({
      buffer,
      mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: "faq.xlsx",
    });
    expect(out.text).toContain("Opening hours?");
    expect(out.text).toContain("9 to 5");
  });

  it("extracts text from HTML and plain text", async () => {
    const html = await parseFile({
      buffer: Buffer.from("<html><body><h1>Returns</h1><p>Within 30 days.</p></body></html>"),
      mimetype: "text/html",
      filename: "returns.html",
    });
    expect(html.text).toContain("Returns");
    expect(html.text).toContain("Within 30 days.");
    const txt = await parseFile({ buffer: Buffer.from("# Title\n\nBody"), mimetype: "text/plain", filename: "a.txt" });
    expect(txt.text).toBe("# Title\n\nBody");
  });
});
