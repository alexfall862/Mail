/**
 * Idempotent superuser seed (SPEC §4 "Seed").
 * Creates one superuser from SEED_SUPERUSER_EMAIL / SEED_SUPERUSER_PASSWORD
 * with must_change_password = true. Skips (no-op) if the email already exists.
 *
 * Recovery path (SPEC §7): with --force-password, an existing superuser's
 * password is rewritten from SEED_SUPERUSER_PASSWORD instead of skipped. This
 * is the way back in when the only superuser is locked out and there is no one
 * above them to reset from /admin/users.
 *
 *   npm run db:seed -- --force-password
 *
 * Deliberately opt-in and never automatic: `railway:start` runs `db:setup` on
 * every boot, and a seed that force-reset by default would silently revert real
 * password changes on each deploy.
 */
import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
const { admins } = schema;
import {
  applyPasswordReset,
  MIN_PASSWORD_LENGTH,
} from "../src/lib/admin-recovery";

async function main() {
  const forcePassword = process.argv.includes("--force-password");
  const email = process.env.SEED_SUPERUSER_EMAIL;
  const password = process.env.SEED_SUPERUSER_PASSWORD;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!email || !password) {
    throw new Error(
      "SEED_SUPERUSER_EMAIL and SEED_SUPERUSER_PASSWORD must be set",
    );
  }
  if (forcePassword && password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `SEED_SUPERUSER_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters ` +
        "(§7), otherwise the forced change on next sign-in would reject it.",
    );
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const db = drizzle(pool, { schema });
  try {
    const [existing] = await db
      .select({ id: admins.id, active: admins.active })
      .from(admins)
      .where(eq(admins.email, email));

    if (existing) {
      if (!forcePassword) {
        console.log(
          `Superuser ${email} already exists; skipping seed. ` +
            "(Locked out? Re-run with --force-password.)",
        );
        return;
      }
      await db.transaction(async (tx) => {
        await applyPasswordReset(tx, {
          adminId: existing.id,
          email,
          password,
          via: "seed-force-password",
        });
      });
      console.log(
        `Reset ${email} to SEED_SUPERUSER_PASSWORD.\n` +
          "Their sessions have been ended and a password change is forced on next sign-in.\n" +
          "Change it immediately, then clear the value from the environment.",
      );
      if (!existing.active) {
        console.warn(
          "\nWarning: this account is deactivated and still can't sign in.\n" +
            "Reactivate it from /admin/users first.",
        );
      }
      return;
    }

    if (forcePassword) {
      console.log(`No superuser ${email} yet; creating it.`);
    }
    // @node-rs/argon2 defaults to argon2id.
    const passwordHash = await hash(password);
    await db.insert(admins).values({
      email,
      name: "Superuser",
      passwordHash,
      isSuperuser: true,
      mustChangePassword: true,
    });
    console.log(`Seeded superuser ${email}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
