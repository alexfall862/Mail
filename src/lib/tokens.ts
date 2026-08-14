/**
 * Vendor magic-link tokens (SPEC §7). Raw token: 32 random bytes, base64url,
 * shown only in URLs/emails. The database stores sha256(raw) — tokens are
 * never logged and never persisted in raw form.
 */
import { createHash, randomBytes } from "node:crypto";

export function generateVendorToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashVendorToken(raw) };
}

export function hashVendorToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Magic-link URL for a raw token. */
export function vendorLinkUrl(rawToken: string): string {
  return `${process.env.APP_URL}/p/${rawToken}`;
}
