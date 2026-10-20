import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";

export interface FleetFollowup {
  id: string;
  task: string;
  status: string;
  detail: string;
}

export function syncFleetFollowups(rows: FleetFollowup[], dir = join(FLYD_DIR, "view")): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "fleet-followups.json"), `${JSON.stringify(rows)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function fleetFollowupsBlock(dir = join(FLYD_DIR, "view")): string {
  const path = join(dir, "fleet-followups.json");
  if (!existsSync(path)) return "";
  try {
    const rows: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(rows)) return "";
    const items = rows.filter((row): row is FleetFollowup => row && typeof row.id === "string" && typeof row.task === "string" && typeof row.status === "string" && typeof row.detail === "string");
    return items.length ? `\n<flyd-work-to-sort>\nWork stopped in the fleet; sort it out without asking George to manage internal progress:\n${items.map((item) => `- ${item.task}: ${item.status}. ${item.detail}`).join("\n")}\n</flyd-work-to-sort>\n` : "";
  } catch {
    return "";
  }
}
