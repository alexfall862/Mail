/**
 * The database side of an admin password reset, shared by the two break-glass
 * scripts (scripts/reset-password.ts and seed's --force-password). Kept free of
 * next/* imports so CLI entry points can use it.
 *
 * Always sets must_change_password: a recovery password is a way back in, never
 * a standing credential. The operator signs in with it and immediately picks a
 * real one, so the value in the environment stops working straight away.
 */
import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
// Relative, not "@/": tsx doesn't resolve tsconfig paths, and the CLI entry
// points import this file. The `../db` import is type-only, so it is erased and
// never constructs the app's connection pool.
import { admins, events, sessions } from "../db/schema";
import type { Db, Tx } from "../db";

/** §7: minimum length 12; no other composition rules. */
export const MIN_PASSWORD_LENGTH = 12;

export async function applyPasswordReset(
  tx: Db | Tx,
  input: { adminId: string; email: string; password: string; via: string },
): Promise<void> {
  await tx
    .update(admins)
    .set({
      passwordHash: await hash(input.password),
      mustChangePassword: true,
    })
    .where(eq(admins.id, input.adminId));
  // Anyone holding an old session must re-authenticate with the new password.
  await tx.delete(sessions).where(eq(sessions.adminId, input.adminId));
  await tx.insert(events).values({
    projectId: null,
    actor: "system",
    actorId: input.adminId,
    eventType: "admin.password_reset",
    payload: { adminId: input.adminId, email: input.email, via: input.via },
  });
}
