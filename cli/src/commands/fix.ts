import { repairLatestTurn } from "../runtime/turn-repair.js";

export async function runFix(feedback = ""): Promise<void> {
  const repair = await repairLatestTurn(feedback);
  console.log(`Recorded Flyd repair ${repair.id}.`);
  console.log(`Failure classes: ${repair.failureClasses.join(", ")}`);
  console.log(`Repair targets: ${repair.repairTargets.join(", ")}`);
}
