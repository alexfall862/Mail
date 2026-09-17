/**
 * Admin credential helpers with no framework imports, so the break-glass CLI
 * (scripts/reset-password.ts) can share them with the app without pulling in
 * next/headers or the request-scoped db client.
 */
import { randomBytes } from "node:crypto";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Server-generated temp password, shown once (SPEC §7). */
export function generateTempPassword(): string {
  return randomBytes(12).toString("base64url"); // 16 chars, over the 12 minimum
}
