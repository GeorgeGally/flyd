import pg from "pg";
import type { PoolClient } from "pg";
import { ensureRuntimeSchema } from "./runtime-schema.js";

const { Pool } = pg;

// Raw query executors for bootstrapped pools, so the schema DDL (and
// transactions, which bypass the query wrapper) never recurse through it.
const rawQueries = new WeakMap<pg.Pool, (sql: string) => Promise<unknown>>();
const databaseKeys = new WeakMap<pg.Pool, string>();

function ensurePoolSchema(pool: pg.Pool): Promise<void> {
  return ensureRuntimeSchema(pool, rawQueries.get(pool), databaseKeys.get(pool));
}

export function runtimeDatabaseUrl(): string {
  return process.env.FLYD_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres:///flyd_v1_development";
}

export function createRuntimePool(
  connectionString = runtimeDatabaseUrl(),
  options: { connectionTimeoutMillis?: number; statementTimeoutMs?: number } = {},
): pg.Pool {
  const pool = new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 3_000,
    // A stalled database must hang queries, not requests waiting on them.
    statement_timeout: options.statementTimeoutMs ?? 30_000,
    options: "-c timezone=UTC",
  });
  // Runtime schema is owned by Core, not the retired Rails tree: every query
  // waits for the idempotent bootstrap so a fresh database needs no db:prepare.
  // ponytail: concurrent first-touch from two processes can race on CREATE
  // TABLE; add a pg_advisory_lock around the bootstrap if Core ever runs multi-process.
  const rawQuery = pool.query.bind(pool);
  rawQueries.set(pool, (sql) => rawQuery(sql));
  databaseKeys.set(pool, connectionString);
  pool.query = ((...args: Parameters<typeof rawQuery>) =>
    ensurePoolSchema(pool).then(() => rawQuery(...args))) as typeof pool.query;
  return pool;
}

export async function withTransaction<T>(pool: pg.Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensurePoolSchema(pool);
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
