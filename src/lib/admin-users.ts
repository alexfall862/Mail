/** Superuser admin management (SPEC §7). */
import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { admins, sessions } from "@/db/schema";
import { logEvent } from "./events";
import { generateTempPassword, normalizeEmail } from "./admin-credentials";

export type UserOpResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string };

function fail<T>(status: number, message: string): UserOpResult<T> {
  return { ok: false, status, message };
}

/** Create an admin with a server-generated temp password (shown once). */
export async function createAdmin(input: {
  email: string;
  name: string;
  isSuperuser: boolean;
  actingAdminId: string;
}): Promise<UserOpResult<{ tempPassword: string }>> {
  const email = normalizeEmail(input.email);
  const tempPassword = generateTempPassword();
  try {
    const [created] = await db
      .insert(admins)
      .values({
        email,
        name: input.name,
        passwordHash: await hash(tempPassword),
        isSuperuser: input.isSuperuser,
        mustChangePassword: true,
      })
      .returning({ id: admins.id });
    await logEvent(db, {
      projectId: null,
      actor: "admin",
      actorId: input.actingAdminId,
      eventType: "admin.created",
      payload: { adminId: created!.id, email, isSuperuser: input.isSuperuser },
    });
    return { ok: true, value: { tempPassword } };
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      return fail(409, "An admin with that email already exists.");
    }
    throw err;
  }
}

/** Deactivate an admin and delete their sessions (§7). */
export async function deactivateAdmin(input: {
  adminId: string;
  actingAdminId: string;
}): Promise<UserOpResult<{ deactivated: true }>> {
  if (input.adminId === input.actingAdminId) {
    return fail(400, "You can't deactivate your own account.");
  }
  const [target] = await db
    .select()
    .from(admins)
    .where(eq(admins.id, input.adminId));
  if (!target) return fail(404, "Admin not found.");
  await db.transaction(async (tx) => {
    await tx
      .update(admins)
      .set({ active: false })
      .where(eq(admins.id, input.adminId));
    await tx.delete(sessions).where(eq(sessions.adminId, input.adminId));
    await logEvent(tx, {
      projectId: null,
      actor: "admin",
      actorId: input.actingAdminId,
      eventType: "admin.deactivated",
      payload: { adminId: input.adminId, email: target.email },
    });
  });
  return { ok: true, value: { deactivated: true } };
}

/** Reset an admin's password to a new temp password (shown once). */
export async function resetAdminPassword(input: {
  adminId: string;
  actingAdminId: string;
}): Promise<UserOpResult<{ tempPassword: string }>> {
  const [target] = await db
    .select()
    .from(admins)
    .where(eq(admins.id, input.adminId));
  if (!target) return fail(404, "Admin not found.");
  const tempPassword = generateTempPassword();
  await db.transaction(async (tx) => {
    await tx
      .update(admins)
      .set({ passwordHash: await hash(tempPassword), mustChangePassword: true })
      .where(eq(admins.id, input.adminId));
    await tx.delete(sessions).where(eq(sessions.adminId, input.adminId));
    await logEvent(tx, {
      projectId: null,
      actor: "admin",
      actorId: input.actingAdminId,
      eventType: "admin.password_reset",
      payload: { adminId: input.adminId, email: target.email },
    });
  });
  return { ok: true, value: { tempPassword } };
}

/** Reactivate a previously deactivated admin. */
export async function reactivateAdmin(input: {
  adminId: string;
  actingAdminId: string;
}): Promise<UserOpResult<{ reactivated: true }>> {
  const [target] = await db
    .select()
    .from(admins)
    .where(eq(admins.id, input.adminId));
  if (!target) return fail(404, "Admin not found.");
  await db
    .update(admins)
    .set({ active: true })
    .where(eq(admins.id, input.adminId));
  await logEvent(db, {
    projectId: null,
    actor: "admin",
    actorId: input.actingAdminId,
    eventType: "admin.reactivated",
    payload: { adminId: input.adminId, email: target.email },
  });
  return { ok: true, value: { reactivated: true } };
}

export async function listAdmins() {
  return db.select().from(admins).orderBy(admins.createdAt);
}
