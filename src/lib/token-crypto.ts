/**
 * Reversible encryption for the vendor magic-link token (see DECISIONS.md):
 * §12 puts the magic link in every vendor email, so the server must be able
 * to reproduce it at transition time; §7 stores only sha256 for lookup. The
 * raw token is kept AES-256-GCM-encrypted under a key derived from existing
 * env secrets — a database-only leak still reveals nothing.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

function key(): Buffer {
  return createHash("sha256")
    .update(
      `${process.env.R2_SECRET_ACCESS_KEY ?? ""}|${process.env.TURNSTILE_SECRET_KEY ?? ""}|kdp-vendor-token-encryption`,
    )
    .digest();
}

export function encryptVendorToken(rawToken: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(rawToken, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64url",
  );
}

/** Returns the raw token, or null if the value can't be decrypted. */
export function decryptVendorToken(stored: string | null): string | null {
  if (!stored) return null;
  try {
    const buf = Buffer.from(stored, "base64url");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
