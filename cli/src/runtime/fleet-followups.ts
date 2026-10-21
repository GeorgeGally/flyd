import { agendaPaths, readInbox, recordInbox } from "./agenda.js";

// Work stalled in the fleet is for Flyd and FirstMate to sort out, not George.
// It goes into Flyd's own inbox marked internal, so his briefing never shows it.

export interface FleetFollowup {
  id: string;
  task: string;
  status: string;
}

const PLAIN: Record<string, string> = {
  paused: "is paused and needs Flyd and FirstMate to get it moving again",
  failed: "stopped with a failure and needs Flyd and FirstMate to sort it out",
};

export function fleetFollowupSentence(row: FleetFollowup): string {
  return `${row.task} ${PLAIN[row.status] ?? "has gone quiet and needs Flyd and FirstMate to check on it"}.`;
}

export function syncFleetFollowups(rows: FleetFollowup[], paths = agendaPaths()): void {
  const filed = new Set(readInbox(paths).filter((entry) => entry.internal).map((entry) => `${entry.itemId}\n${entry.result}`));
  for (const row of rows) {
    const itemId = `fleet-${row.id}`;
    const result = fleetFollowupSentence(row);
    if (filed.has(`${itemId}\n${result}`)) continue;
    recordInbox({ itemId, task: row.task, status: "blocked", result, internal: true }, paths);
  }
}
