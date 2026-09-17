/**
 * Admin session auth (SPEC §7). Session id lives in an httpOnly, Secure,
 * SameSite=Lax cookie; the row in `sessions` (30-day fixed expiry) is the
 * source of truth. Middleware only checks cookie presence for UX; every admin
 * page and API calls one of the helpers here for the real DB-backed check.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "@/db";
import { admins, sessions } from "@/db/schema";
import { SESSION_COOKIE } from "./session-cookie";

export { SESSION_COOKIE };
export { normalizeEmail } from "./admin-credentials";
export const SESSION_DAYS = 30;

export type SessionAdmin = {
  sessionId: string;
  admin: {
    id: string;
    email: string;
    name: string;
    isSuperuser: boolean;
    mustChangePassword: boolean;
  };
};

export async function createSession(adminId: string): Promise<{
  sessionId: string;
  expiresAt: Date;
}> {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(sessions)
    .values({ adminId, expiresAt })
    .returning({ id: sessions.id });
  // Opportunistic cleanup of this admin's expired sessions.
  await db
    .delete(sessions)
    .where(and(eq(sessions.adminId, adminId), lt(sessions.expiresAt, new Date())));
  return { sessionId: row!.id, expiresAt };
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

/**
 * Resolve the current admin from the session cookie, or null. Cached per
 * request so layout + page + actions share one lookup.
 */
export const getSessionAdmin = cache(async (): Promise<SessionAdmin | null> => {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId || !isUuid(sessionId)) return null;

  const rows = await db
    .select({
      sessionId: sessions.id,
      id: admins.id,
      email: admins.email,
      name: admins.name,
      isSuperuser: admins.isSuperuser,
      mustChangePassword: admins.mustChangePassword,
    })
    .from(sessions)
    .innerJoin(admins, eq(sessions.adminId, admins.id))
    .where(
      and(
        eq(sessions.id, sessionId),
        gt(sessions.expiresAt, new Date()),
        eq(admins.active, true),
      ),
    );
  const row = rows[0];
  if (!row) return null;
  return {
    sessionId: row.sessionId,
    admin: {
      id: row.id,
      email: row.email,
      name: row.name,
      isSuperuser: row.isSuperuser,
      mustChangePassword: row.mustChangePassword,
    },
  };
});

/** For API route handlers: current admin or null (caller returns 401). */
export async function requireAdmin(): Promise<SessionAdmin | null> {
  return getSessionAdmin();
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Delete an admin's other sessions (used after password change). */
export async function deleteOtherSessions(
  adminId: string,
  keepSessionId: string,
): Promise<void> {
  await db
    .delete(sessions)
    .where(and(eq(sessions.adminId, adminId), ne(sessions.id, keepSessionId)));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
