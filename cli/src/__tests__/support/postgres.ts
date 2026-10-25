import { Pool } from "pg";

/** The integration database every Postgres-backed suite shares. */
export const TEST_DATABASE_URL = process.env.FLYD_TEST_DATABASE_URL ?? "postgres:///flyd_v1_test";

/**
 * Whether the Postgres-backed suites should run. With FLYD_TEST_DATABASE_URL
 * set (CI) the database is required, so a broken one fails loudly; on a
 * machine without the default local database the suites skip instead of
 * failing on a missing fixture.
 */
export async function postgresAvailable(connectionString = TEST_DATABASE_URL): Promise<boolean> {
  if (process.env.FLYD_TEST_DATABASE_URL) return true;
  const probe = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 2_000 });
  try {
    await probe.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}
