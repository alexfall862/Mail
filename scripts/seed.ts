/**
 * Idempotent superuser seed (SPEC §4 "Seed").
 * Creates one superuser from SEED_SUPERUSER_EMAIL / SEED_SUPERUSER_PASSWORD
 * with must_change_password = true. Skips (no-op) if the email already exists.
 */
import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { admins } from "../src/db/schema";

async function main() {
  const email = process.env.SEED_SUPERUSER_EMAIL;
  const password = process.env.SEED_SUPERUSER_PASSWORD;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!email || !password) {
    throw new Error(
      "SEED_SUPERUSER_EMAIL and SEED_SUPERUSER_PASSWORD must be set",
    );
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const db = drizzle(pool);
  try {
    const existing = await db
      .select({ id: admins.id })
      .from(admins)
      .where(eq(admins.email, email));
    if (existing.length > 0) {
      console.log(`Superuser ${email} already exists; skipping seed.`);
      return;
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
  console.error("Seed failed:", err);
  process.exit(1);
});
