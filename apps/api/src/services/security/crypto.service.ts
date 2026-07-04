import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../../config/env.js";

export type EncryptedBlob = {
  iv: string;
  ciphertext: string;
  authTag: string;
  keyVersion: number;
};

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  return Buffer.from(env.credentialsEncryptionKey, "hex");
}

export function encrypt(plaintext: string): EncryptedBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
    keyVersion: 1,
  };
}

export function decrypt(blob: EncryptedBlob): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(blob.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(blob.authTag, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
