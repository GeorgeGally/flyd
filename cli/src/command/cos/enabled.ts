/** Explicit operator rollback values for FLYD_COS; anything else, including unset, keeps the Chief of Staff on. */
const ROLLBACK = new Set(["0", "off", "false", "no"]);

/**
 * The Chief of Staff path is the default. `FLYD_COS=0` is the emergency rollback: new delegated work takes the
 * legacy direct path, and existing objectives pause while keeping ownership of their runs and reports
 * (docs/product/flyd-command-architecture-prd.md). Unknown values never turn it off.
 */
export function cosEnabled(value = process.env.FLYD_COS): boolean {
  return !ROLLBACK.has((value ?? "").trim().toLowerCase());
}
