import pg from "pg";
import type { PoolClient } from "pg";

const { Pool } = pg;

export function runtimeDatabaseUrl(): string {
  return process.env.FLYD_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres:///flyd_v1_development";
}

export function createRuntimePool(connectionString = runtimeDatabaseUrl()): pg.Pool {
  return new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 3_000,
    options: "-c timezone=UTC",
  });
}

export async function withTransaction<T>(pool: pg.Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
