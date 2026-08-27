// Magic-byte validation for uploads (__specs/12 §5).
//
// `sourceTypeFor` routes an upload by its Content-Type header and its filename
// extension. Both are supplied by the caller and neither is evidence: a client
// can label anything `application/pdf` and name it `policy.pdf`, and the file is
// then handed to the PDF parser on that say-so alone.
//
// This reads the first bytes instead, which the caller cannot lie about, and
// checks them against the claim. It is deliberately a NARROW check:
//
//   - Container formats are verified. PDF, DOCX/XLSX (both ZIP) and legacy XLS
//     have unambiguous signatures, and a mismatch there means the claim is
//     simply false.
//   - Text formats are not. CSV, HTML, Markdown and plain text have no
//     signature to check — anything is a valid text file — so the honest answer
//     is that there is nothing to verify, not a fabricated one.
//   - What it REJECTS is a file whose bytes identify it as an executable or an
//     archive while claiming to be a document. That is the case worth blocking
//     and the one that has no innocent explanation.
//
// This is not malware scanning. It stops a mislabelled file reaching the wrong
// parser and stops obvious binaries being stored as "documents"; a hostile PDF
// is still a PDF and is still the parser's problem.

/** What the leading bytes actually say this file is. */
export type DetectedKind = "pdf" | "zip" | "xls" | "executable" | "unknown";

type Signature = { kind: DetectedKind; offset: number; bytes: number[] };

const SIGNATURES: Signature[] = [
  // %PDF-
  { kind: "pdf", offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  // PK\x03\x04 — every OOXML file (docx, xlsx) is a zip, as is a plain archive.
  { kind: "zip", offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  { kind: "zip", offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }, // empty archive
  // Legacy OLE2 compound file: .doc / .xls / .ppt
  { kind: "xls", offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  // ELF
  { kind: "executable", offset: 0, bytes: [0x7f, 0x45, 0x4c, 0x46] },
  // Windows PE / DOS MZ
  { kind: "executable", offset: 0, bytes: [0x4d, 0x5a] },
  // Mach-O, 32 and 64 bit, both endiannesses, plus the universal binary
  { kind: "executable", offset: 0, bytes: [0xfe, 0xed, 0xfa, 0xce] },
  { kind: "executable", offset: 0, bytes: [0xfe, 0xed, 0xfa, 0xcf] },
  { kind: "executable", offset: 0, bytes: [0xcf, 0xfa, 0xed, 0xfe] },
  { kind: "executable", offset: 0, bytes: [0xca, 0xfe, 0xba, 0xbe] },
  // #! — a script is not a document
  { kind: "executable", offset: 0, bytes: [0x23, 0x21] },
];

/** Identify a buffer from its leading bytes alone. */
export function detectKind(buffer: Buffer): DetectedKind {
  for (const sig of SIGNATURES) {
    if (buffer.length < sig.offset + sig.bytes.length) continue;
    if (sig.bytes.every((b, i) => buffer[sig.offset + i] === b)) return sig.kind;
  }
  return "unknown";
}

/** The byte-level kinds each declared source type may legitimately have. */
const ALLOWED: Record<string, DetectedKind[]> = {
  // A PDF must actually be a PDF.
  pdf: ["pdf"],
  // OOXML is a zip. Nothing else is a docx.
  docx: ["zip"],
  // xlsx is a zip; xls is the legacy OLE2 container.
  excel: ["zip", "xls"],
  // Text-ish formats have no signature. "unknown" is the expected answer and is
  // not evidence of anything.
  csv: ["unknown"],
  html: ["unknown"],
  text: ["unknown"],
};

export class FileSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileSignatureError";
  }
}

/**
 * Check an upload's bytes against the type it claims to be.
 *
 * Throws `FileSignatureError` with an operator-readable reason; the caller maps
 * it to a 400. Returns the detected kind so the caller can log it.
 */
export function assertSignatureMatches(args: {
  buffer: Buffer;
  declaredType: string;
  filename: string;
}): DetectedKind {
  const detected = detectKind(args.buffer);

  // An executable is refused whatever it claims to be — including when it
  // claims to be plain text, which is the one case the allow-list below would
  // otherwise wave through.
  if (detected === "executable") {
    throw new FileSignatureError(
      `"${args.filename}" is an executable or a script, not a document. Upload the document itself.`,
    );
  }

  const allowed = ALLOWED[args.declaredType];
  // An unknown declared type is not this function's business to police.
  if (!allowed) return detected;

  if (!allowed.includes(detected)) {
    throw new FileSignatureError(
      `"${args.filename}" is labelled as ${args.declaredType} but its contents are not. ` +
        "Re-save the file in the format its name says, or upload it with the right extension.",
    );
  }
  return detected;
}
