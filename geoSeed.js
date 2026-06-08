// Postgres connection. Two ways to configure it:
//   1) DATABASE_URL — a single connection string, OR
//   2) PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE — separate values
//      (use this when your password has symbols that would break a URL).
// When neither is set, the app falls back to the JSON store (local dev).

export const usingPg = !!(process.env.DATABASE_URL || process.env.PGHOST);

let pool = null;

export async function initDb() {
  if (!usingPg || pool) return pool;
  const pg = (await import("pg")).default;
  const ssl = process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false };
  const max = Number(process.env.DB_POOL_MAX || 10);
  pool = new pg.Pool(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL, ssl, max, idleTimeoutMillis: 30000 }
      // host/user/password/database/port are read from PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT
      : { ssl, max, idleTimeoutMillis: 30000 }
  );
  return pool;
}

export function query(text, params) {
  if (!pool) throw new Error("DB pool not initialised — call initDb() first.");
  return pool.query(text, params);
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function closePool() { if (pool) await pool.end(); }
