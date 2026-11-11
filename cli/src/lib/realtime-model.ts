/** The LIVE session model: FLYD_REALTIME_MODEL, else the default. */
export function realtimeModel(): string {
  return process.env.FLYD_REALTIME_MODEL || "gpt-realtime-2.1";
}
