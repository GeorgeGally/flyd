import { EpisodicMemory } from "../intelligence/episodes/service.js";

function printNode(node: { id: string; startTime: string; endTime: string; eventCount: number; summary: string }): void {
  const from = node.startTime.slice(0, 10);
  const to = node.endTime.slice(0, 10);
  const range = from === to ? from : `${from} → ${to}`;
  console.log(`${node.id}  ${range}  (${node.eventCount} events)\n  ${node.summary}`);
}

export function runEpisodes(
  action = "timeline",
  arg?: string,
  options: { budget?: number } = {},
): void {
  const memory = new EpisodicMemory();
  if (action === "rebuild") {
    const result = memory.rebuild();
    console.log(`episodic cache rebuilt: ${result.eventCount} events, ${result.leafCount} leaves, ${result.nodeCount} nodes`);
    return;
  }
  if (action === "verify") {
    const result = memory.verify();
    console.log(result.ok ? `episodic cache OK (${result.nodes} nodes)` : `episodic cache invalid:\n- ${result.issues.join("\n- ")}`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (action === "drill") {
    if (!arg) throw new Error("flyd episodes drill <node-id>");
    const result = memory.drill(arg);
    if (!result) throw new Error(`Unknown episode node: ${arg}`);
    printNode(result.node);
    if (result.children.length) {
      console.log("\nchildren:");
      for (const child of result.children) printNode(child);
    } else {
      console.log("\nevidence:");
      for (const event of result.events) {
        console.log(`  event:${event.sequence} ${event.capturedAt} ${event.kind} [${event.sourceId}]${event.erased ? " (erased)" : ""}`);
      }
    }
    return;
  }
  if (action !== "timeline") throw new Error("flyd episodes [timeline|rebuild|verify|drill <node-id>]");
  const nodes = memory.timeline(options.budget ?? 12);
  if (!nodes.length) {
    console.log("No episodic cache yet. Run: flyd episodes rebuild");
    return;
  }
  for (const node of nodes) printNode(node);
}
