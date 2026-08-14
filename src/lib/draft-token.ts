/**
 * Draft project id token (SPEC §6): for a first submission, the project id is
 * generated at presign time and threaded through the form session as a signed
 * token; the project row is only created on successful final submit. The
 * token proves (a) the id was minted by this server — so presigns can never
 * target someone else's project prefix — and (b) the holder passed Turnstile
 * when the flow began. HMAC key is derived from existing secrets (§14 defines
 * no separate app secret; rotating either underlying key invalidates
 * in-flight drafts, which is acceptable).
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const DRAFT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function hmacKey(): Buffer {
  return createHash("sha256")
    .update(
      `${process.env.R2_SECRET_ACCESS_KEY ?? ""}|${process.env.TURNSTILE_SECRET_KEY ?? ""}|kdp-draft-token`,
    )
    .digest();
}

function sign(payload: string): string {
  return createHmac("sha256", hmacKey()).update(payload).digest("base64url");
}

export function issueDraftToken(
  projectId: string,
  now: number = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({ pid: projectId, iat: now }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Returns the draft project id, or null if invalid/expired. */
export function verifyDraftToken(
  token: string,
  now: number = Date.now(),
): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      pid?: unknown;
      iat?: unknown;
    };
    if (typeof data.pid !== "string" || typeof data.iat !== "number") return null;
    if (now - data.iat > DRAFT_TOKEN_TTL_MS) return null;
    return data.pid;
  } catch {
    return null;
  }
}
