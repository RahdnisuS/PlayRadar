// Server-only Postgres access shared by API routes, scheduled jobs and offline scripts.
// On Vercel we keep one connection per function instance and go through Supabase's transaction pooler.
import pg from "pg";

const globalForPg = globalThis as unknown as { pgPool?: pg.Pool };

function pool(): pg.Pool {
  if (!globalForPg.pgPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL missing");
    globalForPg.pgPool = new pg.Pool({
      // Session pooler (5432) for scripts; transaction pooler (6543) on serverless.
      connectionString: process.env.VERCEL ? url.replace(":5432/", ":6543/") : url,
      ssl: { rejectUnauthorized: false },
      max: process.env.VERCEL ? 1 : 4,
    });
  }
  return globalForPg.pgPool;
}

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool().query<T>(text, params)).rows;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function closeDb() {
  await globalForPg.pgPool?.end();
  globalForPg.pgPool = undefined;
}
