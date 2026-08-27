import { encrypt, decrypt, type EncryptedBlob } from "./crypto.service.js";

// Transparent encryption for single secret STRING fields on documents that
// predate the credential vault (User.totpSecret, PlatformSetting.smtp.secret).
//
// The vault stores structured EncryptedBlob subdocuments, which these fields
// cannot hold without a migration, so a sealed value is serialised to JSON and
// kept in the same String column. `open()` accepts both shapes, which is what
// makes this deployable without a backfill: rows written before this change are
// still plaintext and keep working, and each one is re-sealed the next time it
// is written.
//
// This is at-rest protection only. Anyone who holds both the database AND
// CREDENTIALS_ENCRYPTION_KEY can still read these; the threat it addresses is a
// leaked database dump, which is the realistic one.

function isSealed(value: string): boolean {
  if (!value.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(value) as Partial<EncryptedBlob>;
    return (
      typeof parsed.iv === "string" &&
      typeof parsed.ciphertext === "string" &&
      typeof parsed.authTag === "string"
    );
  } catch {
    return false;
  }
}

/** Encrypt a secret for storage in a String field. */
export function sealSecret(plaintext: string): string {
  return JSON.stringify(encrypt(plaintext));
}

/**
 * Read a secret written by `sealSecret`, or return it unchanged if it is a
 * legacy plaintext value. Returns "" for empty/absent input so callers can
 * treat "no secret" uniformly.
 */
export function openSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!isSealed(stored)) return stored; // legacy plaintext — not yet re-sealed
  return decrypt(JSON.parse(stored) as EncryptedBlob);
}

/** True when the stored value is already encrypted (used to avoid double-sealing). */
export function isSecretSealed(stored: string | null | undefined): boolean {
  return Boolean(stored) && isSealed(stored as string);
}
