// Simulated George: real conversations through the real chat path, read-only
// (state-changing tools are recorded, never run). Prints each turn's route,
// tools, time and answer, plus a summary of what to look at.
// Run: npx tsx scripts/simulate.ts [conversation-name…]
import { respondToConversation } from "../src/runtime/conversation-responder.js";
import { loadAgentSituation, retrieveAgentMemory } from "../src/commands/code.js";
import { refreshRepoRegistry } from "../src/runtime/repo-registry.js";

const CONVERSATIONS: Record<string, string[]> = {
  morning: ["morning", "what's worth reading today?", "tell me more about the second one", "ok, remind me to read it properly tonight at 9"],
  slump: ["I'm stuck on the CleanX launch, zero energy for it", "yeah, do that"],
  work: ["what did I ship in flyd yesterday?", "add a /time command to the flyd chat that prints my local time", "how's that going?"],
  reminder: ["remind me to call mum on sunday", "actually make it saturday at 10am"],
  quick: ["usd to idr right now?", "write a reply to Sam: can't make thursday, friday works", "why is the sky blue, one line"],
  skills: ["GNM still hasn't paid me, sort it out", "what do I need to do to get Bloom live by Sunday?"],
  startup: ["thinking of pricing CleanX at $5 a month vs $29 lifetime, gut check?", "ok, $5 a month, no lifetime", "draft the Product Hunt tagline and first comment for it"],
  art: ["I want to make a new generative piece that brings back the car-tyre brushes idea, riff with me", "find open calls for generative or on-chain art closing in October or November"],
  money: ["where am I with money this month, who owes me what?", "I need paid work soon, who should I reach out to first?"],
  overwhelm: ["too many things on. what can I drop this week?", "ok, park Tastemaker for now"],
  recall: ["who coined the name radarboy?", "what's the story with GNM?", "what have I been building lately?"],
};

interface Row { conversation: string; turn: number; message: string; seconds: number; route: string; tools: string[]; failed: string[]; answer: string; error?: string }

const names = process.argv.slice(2).filter((name) => name in CONVERSATIONS);
const situation = await loadAgentSituation().catch(() => null);
const crossRepo = await refreshRepoRegistry(situation?.projectRoot).catch(() => []);
const rows: Row[] = [];

for (const name of names.length ? names : Object.keys(CONVERSATIONS)) {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const [turn, message] of CONVERSATIONS[name].entries()) {
    const memory = await retrieveAgentMemory(message).catch(() => ({ verdict: "insufficient" as const, matches: [] }));
    let receipt: { plan?: { route: string; source?: string; skill?: string }; toolCalls?: Array<{ name: string; input: unknown; succeeded: boolean; error?: string }> } = {};
    const started = Date.now();
    const row: Row = { conversation: name, turn: turn + 1, message, seconds: 0, route: "", tools: [], failed: [], answer: "" };
    try {
      row.answer = await respondToConversation(
        { sessionId: `sim-${name}-${Date.now()}`, turnNumber: turn + 1, message, history: [...history], memory, situation, crossRepo, onToken: () => {} },
        { readOnly: true, persistReceipt: async (input) => { receipt = input as typeof receipt; return input as never; } },
      );
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
    }
    row.seconds = Math.round((Date.now() - started) / 1000);
    row.route = receipt.plan ? `${receipt.plan.route}${receipt.plan.source ? `/${receipt.plan.source}` : ""}${receipt.plan.skill ? ` +${receipt.plan.skill}` : ""}` : "?";
    row.tools = (receipt.toolCalls ?? []).map((call) => `${call.name}${call.succeeded ? "" : "✗"} ${JSON.stringify(call.input).slice(0, 140)}`);
    row.failed = (receipt.toolCalls ?? []).filter((call) => !call.succeeded && !String(call.error).startsWith("Skipped (evaluation run)")).map((call) => `${call.name}: ${String(call.error).slice(0, 120)}`);
    rows.push(row);
    history.push({ role: "user", content: message }, { role: "assistant", content: row.answer || "(no answer)" });
    console.log(`\n── ${name} ${row.turn} · ${row.seconds}s · ${row.route}\nGeorge: ${message}`);
    for (const tool of row.tools) console.log(`   · ${tool}`);
    console.log(row.error ? `   ERROR ${row.error}` : `Flyd: ${row.answer.replace(/\n+/g, "\n      ")}`);
  }
}

const seconds = rows.map((row) => row.seconds).sort((a, b) => a - b);
console.log(`\n${rows.length} turns · median ${seconds[Math.floor(seconds.length / 2)]}s · max ${seconds.at(-1)}s · unplanned ${rows.filter((row) => row.route === "unplanned").length} · errors ${rows.filter((row) => row.error).length}`);
for (const row of rows.filter((item) => item.failed.length)) console.log(`failed tool calls in ${row.conversation} ${row.turn}: ${row.failed.join("; ")}`);
process.exit(0);
