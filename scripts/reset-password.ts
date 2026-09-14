/**
 * Break-glass admin password reset (SPEC §7).
 *
 * The in-app reset at /admin/users covers every admin *except* a locked-out
 * superuser, whom no one can reset from the UI. This CLI is that recovery
 * path: run it against the database by whoever holds DATABASE_URL.
 *
 *   npm run admin:reset-password -- someone@example.com
 *
 * Sets a fresh temp password (forced change on next login), ends the target's
 * sessions, and writes an `admin.password_reset` event with actor `system`.
 * It never reveals an existing password — argon2id hashes are one-way.
 */
import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { admins, events, sessions } from "../src/db/schema";
import {
  generateTempPassword,
  normalizeEmail,
} from "../src/lib/admin-credentials";

async function main() {
  const email = normalizeEmail(process.argv[2] ?? "");
  if (!email) {
    throw new Error(
      "Usage: npm run admin:reset-password -- <email>",
    );
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const db = drizzle(pool);
  try {
    const [target] = await db
      .select({
        id: admins.id,
        email: admins.email,
        name: admins.name,
        active: admins.active,
        isSuperuser: admins.isSuperuser,
      })
      .from(admins)
      .where(eq(admins.email, email));
    if (!target) {
      throw new Error(
        `No admin with email ${email}. Run it against the right DATABASE_URL, or create the account from /admin/users.`,
      );
    }

    const tempPassword = generateTempPassword();
    await db.transaction(async (tx) => {
      await tx
        .update(admins)
        .set({ passwordHash: await hash(tempPassword), mustChangePassword: true })
        .where(eq(admins.id, target.id));
      await tx.delete(sessions).where(eq(sessions.adminId, target.id));
      await tx.insert(events).values({
        projectId: null,
        actor: "system",
        actorId: target.id,
        eventType: "admin.password_reset",
        payload: { adminId: target.id, email: target.email, via: "cli" },
      });
    });

    console.log(
      `\nTemporary password for ${target.name} <${target.email}>` +
        `${target.isSuperuser ? " (superuser)" : ""}:\n\n  ${tempPassword}\n\n` +
        "Hand it over out of band. A password change is forced on next sign-in,\n" +
        "and all of their existing sessions have been ended.",
    );
    if (!target.active) {
      console.warn(
        "\nWarning: this account is deactivated and still can't sign in.\n" +
          "Reactivate it from /admin/users first.",
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Password reset failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
