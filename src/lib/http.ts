import { NextResponse } from "next/server";
import type { RateLimitResult } from "./rate-limit";

/** JSON error body shape used by every API route. */
export function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function rateLimited(result: RateLimitResult): NextResponse {
  const retryAfter = result.allowed ? 60 : result.retryAfterSeconds;
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

/**
 * Same-origin check for state-changing endpoints (SPEC §13). Browsers always
 * send Origin on cross-site POSTs; we reject anything that doesn't match
 * APP_URL. Requests without an Origin header (curl, same-origin GET) pass —
 * cookie/token auth is the actual credential; this only blunts CSRF.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const appUrl = process.env.APP_URL;
  if (!appUrl) return false;
  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

export function assertSameOrigin(request: Request): NextResponse | null {
  if (isSameOrigin(request)) return null;
  return jsonError(403, "Cross-origin request rejected.");
}

/** Client IP for rate limiting; Railway sits behind a proxy. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}
