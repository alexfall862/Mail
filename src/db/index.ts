import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// One pool per server process. At ~100 submissions/year a handful of
// connections is plenty; keep the pool small so a hobby-tier Postgres is happy.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

export const db = drizzle(pool, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
