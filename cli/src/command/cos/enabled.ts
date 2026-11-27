/** The CoS remains opt-in until every user-facing fleet item has reliable objective provenance. */
export function cosEnabled(value = process.env.FLYD_COS): boolean {
  return value === "1";
}
