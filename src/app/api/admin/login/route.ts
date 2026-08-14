import { NextResponse } from "next/server";
import { hash, verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { admins } from "@/db/schema";
import {
  createSession,
  normalizeEmail,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth";
import { logEvent } from "@/lib/events";
import { assertSameOrigin, getClientIp, jsonError, rateLimited } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/schemas/auth";
import { verifyTurnstile } from "@/lib/turnstile";

// Constant-shape failure so callers can't distinguish unknown email from bad
// password, and a dummy verify below keeps the timing similar too.
const LOGIN_FAILED = "Incorrect email or password.";
let dummyHashPromise: Promise<string> | null = null;

export async function POST(request: Request): Promise<NextResponse> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, "Enter your email, password, and complete the verification.");
  }
  const email = normalizeEmail(parsed.data.email);
  const ip = getClientIp(request);

  // §13: 5 attempts / 15 min per (IP, email).
  const limit = rateLimit("login", `${ip}:${email}`);
  if (!limit.allowed) return rateLimited(limit);

  if (!(await verifyTurnstile(parsed.data.turnstileToken, ip))) {
    return jsonError(400, "Verification failed. Please try again.");
  }

  const [admin] = await db.select().from(admins).where(eq(admins.email, email));

  if (!admin || !admin.active) {
    dummyHashPromise ??= hash("dummy-password-for-timing");
    await verify(await dummyHashPromise, parsed.data.password).catch(() => false);
    return jsonError(401, LOGIN_FAILED);
  }

  const passwordOk = await verify(admin.passwordHash, parsed.data.password).catch(
    () => false,
  );
  if (!passwordOk) return jsonError(401, LOGIN_FAILED);

  const { sessionId, expiresAt } = await createSession(admin.id);
  await logEvent(db, {
    projectId: null,
    actor: "admin",
    actorId: admin.id,
    eventType: "admin.login",
    payload: { email: admin.email },
  });

  const response = NextResponse.json({
    ok: true,
    mustChangePassword: admin.mustChangePassword,
  });
  response.cookies.set(SESSION_COOKIE, sessionId, sessionCookieOptions(expiresAt));
  return response;
}
