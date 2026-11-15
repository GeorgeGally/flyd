import { calendarMetadataConsented, runProactiveCare } from "../runtime/proactive-care.js";
import { CALENDAR_METADATA_CONTRACT, SourceContractRegistry } from "../intelligence/sensors/source-contracts.js";

/** Separate explicit opt-in. An assistant cannot assume Calendar access. */
export async function runCareCommand(action = "status"): Promise<void> {
  const registry = new SourceContractRegistry();
  registry.register(CALENDAR_METADATA_CONTRACT);
  if (action === "enable") {
    if (registry.status(CALENDAR_METADATA_CONTRACT.sourceId) === "revoked") {
      registry.renew(CALENDAR_METADATA_CONTRACT.sourceId);
    }
    registry.setStatus(CALENDAR_METADATA_CONTRACT.sourceId, "enabled");
    console.log("Enabled local, metadata-only Calendar preparation. Flyd may use verified People memory for quiet pre-call cards; no attendee addresses, notes, location, notification or model egress.");
    console.log("Use flyd care disable to stop Calendar preparation.");
    return;
  }
  if (action === "disable" || action === "pause") {
    registry.setStatus(CALENDAR_METADATA_CONTRACT.sourceId, action === "pause" ? "paused" : "disabled");
    console.log(action === "pause" ? "Calendar preparation paused." : "Calendar preparation disabled.");
    return;
  }
  if (action === "run") {
    console.log(JSON.stringify(await runProactiveCare(), null, 2));
    return;
  }
  if (action !== "status") throw new Error("Usage: flyd care status | enable | disable | pause | run");
  console.log([
    "Flyd proactive personal care",
    "Creative references: " + (process.env.FLYD_PROACTIVE_CARE === "0" ? "off" : "ambient, local, source-backed"),
    "Calendar preparation: " + (calendarMetadataConsented(registry) ? "opted in" : registry.status(CALENDAR_METADATA_CONTRACT.sourceId)),
    "Calendar reader: Mac only; requires Calendar running and macOS permission.",
    "People memory: local, verified and freshness checked.",
    "Output: quiet activity cards, not push notifications.",
    "Enable Calendar preparation explicitly with flyd care enable.",
  ].join("\n"));
}
