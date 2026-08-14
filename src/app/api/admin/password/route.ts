import { NextResponse } from "next/server";
import { hash, verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { admins } from "@/db/schema";
import { deleteOtherSessions, requireAdmin } from "@/lib/auth";
import { assertSameOrigin, jsonError } from "@/lib/http";
import { changePasswordSchema } from "@/lib/schemas/auth";

export async function POST(request: Request): Promise<NextResponse> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const session = await requireAdmin();
  if (!session) return jsonError(401, "Not signed in.");

  const parsed = changePasswordSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return jsonError(
      400,
      parsed.error.issues[0]?.message ?? "Invalid request.",
    );
  }

  const [admin] = await db
    .select({ passwordHash: admins.passwordHash })
    .from(admins)
    .where(eq(admins.id, session.admin.id));
  if (!admin) return jsonError(401, "Not signed in.");

  const currentOk = await verify(
    admin.passwordHash,
    parsed.data.currentPassword,
  ).catch(() => false);
  if (!currentOk) return jsonError(400, "Current password is incorrect.");

  await db
    .update(admins)
    .set({
      passwordHash: await hash(parsed.data.newPassword),
      mustChangePassword: false,
    })
    .where(eq(admins.id, session.admin.id));

  // Keep this session; sign out everywhere else.
  await deleteOtherSessions(session.admin.id, session.sessionId);

  return NextResponse.json({ ok: true });
}
