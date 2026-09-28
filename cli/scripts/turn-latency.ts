// Where a chat turn's time goes before the answer starts, and whether Jev can
// pick the turn's route as well as the LLM room reading does.
// Run: npx tsx scripts/turn-latency.ts [--llm]   (--llm also times the LLM room reading)
import { compileContext } from "../src/cognition/context-compiler.js";
import { evaluatePredicates } from "../src/cognition/system-one/jev.js";
import { readTheRoom } from "../src/runtime/read-the-room.js";
import { buildRoomContext, privateNotes } from "../src/runtime/room-context.js";
import { readUserProfile } from "../src/lib/user-profile.js";
import { readMemoryEntries } from "../src/council/memory-store.js";
import { query } from "../src/lib/llm.js";
import { questionFor } from "../src/cognition/system-one/registry.js";

const ROUTE_QUESTION = questionFor("chat_turn_route");

const CASES: Array<{ message: string; route: string }> = [
  { message: "add a clock to the flyd TUI header showing local time", route: "delegate" },
  { message: "implement a dark mode setting across the whole flyd cli, with tests", route: "delegate" },
  { message: "can I make my 7:15 flight if I leave Canggu at 4:40?", route: "answer" },
  { message: "ugh, long day. anything I should know before tomorrow?", route: "answer" },
  { message: "book it", route: "clarify" },
  { message: "remind me to call Sam at 5", route: "act" },
  { message: "from now on talk to me in plain, literal simple English", route: "act" },
  { message: "DIR feels dead. I'm tired of it.", route: "answer" },
  { message: "what's the news this morning?", route: "answer" },
  { message: "research the three best venues in Cape Town for a generative art show and compare them", route: "delegate" },
  { message: "install rust with the rustup script", route: "act" },
  { message: "write a firm but friendly email chasing a $2,400 invoice that's 30 days late", route: "answer" },
  { message: "what's today's date?", route: "answer" },
  { message: "what's 17% of 2340?", route: "answer" },
  { message: "who won the most recent Formula 1 race?", route: "answer" },
  { message: "what reminders do I have open?", route: "answer" },
  { message: "remind me to water the plants tomorrow at 8am", route: "act" },
  { message: "remember that my passport expires in March 2027", route: "act" },
  { message: "what's the latest commit in the flyd repo?", route: "answer" },
  { message: "where in flyd is chat model failover implemented?", route: "answer" },
  { message: "what's the status of the project?", route: "answer" },
  { message: "run rm -rf dist in the flyd cli folder for me", route: "act" },
  { message: "thanks, that's all for now", route: "answer" },
  { message: "I need to send the invoice to Acme by Friday", route: "act" },
  { message: "every weekday at 8am give me a short morning brief", route: "act" },
  { message: "check tomorrow at 9am whether flyd PR 53 got merged and let me know", route: "act" },
  { message: "should I raise CleanX's starter pack price?", route: "answer" },
  { message: "I have 3 hours tonight. Fix the flyd CI, write the CleanX launch post, or reply to 20 emails — which one?", route: "answer" },
  { message: "what's on my to-do list?", route: "answer" },
  { message: "I'm not working on Bridgestone anymore", route: "act" },
  { message: "coach, how did my week go?", route: "answer" },
  { message: "generate three new DIR mixes with better prompts and tell me which is best", route: "delegate" },
  { message: "fix the typo in the README title of flyd, it says Flyed", route: "delegate" },
  { message: "draft a 2-page proposal for the Brilliant Labs glasses demo", route: "delegate" },
];
const withLlm = process.argv.includes("--llm");

const ms = (start: number) => Math.round(performance.now() - start);
const now = new Date();
const rows: Array<Record<string, unknown>> = [];
for (const { message, route } of CASES) {
  let t = performance.now();
  await compileContext({ intent: message, projectRoot: process.cwd(), environment: { app: "cli_chat" }, conversation: [], capabilities: ["conversation", "memory", "git", "files", "shell", "web"] }).catch(() => null);
  const compileMs = ms(t);
  t = performance.now();
  const notes = await privateNotes(now).catch(() => []);
  const ctx = buildRoomContext({ profile: readUserProfile(), memory: readMemoryEntries(), retrieved: [] });
  const notesMs = ms(t);
  t = performance.now();
  const room = !withLlm ? null : await readTheRoom({ message, history: [], now, core: ctx.core, knowledge: ctx.knowledge, notes }, (p) => query(p, undefined, undefined, undefined, undefined, { json: true }));
  const roomMs = ms(t);
  t = performance.now();
  const jev = await evaluatePredicates({ utterance: message, conversation_recap: "" }, [ROUTE_QUESTION], { apiKey: process.env.TYPESAFE_API_KEY, timeoutMs: 4_000 });
  const jevMs = ms(t);
  const jevRoute = jev.answers[ROUTE_QUESTION.id]?.choice ?? `error:${jev.error}`;
  rows.push({ message: message.slice(0, 44), expected: route, ...(withLlm ? { llm: room?.route ?? "null" } : {}), jev: jevRoute, jevConf: jev.answers[ROUTE_QUESTION.id]?.confidence?.toFixed(2), compileMs, notesMs, roomMs, jevMs });
}
console.table(rows);
const agree = (key: string) => rows.filter((row) => row[key] === row.expected).length;
const median = (key: string) => rows.map((row) => Number(row[key])).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
if (withLlm) console.log(`llm route correct ${agree("llm")}/${rows.length}, median ${median("roomMs")}ms`);
console.log(`jev route correct ${agree("jev")}/${rows.length}, median ${median("jevMs")}ms`);
console.log(`compileContext median ${median("compileMs")}ms, notes median ${median("notesMs")}ms`);
process.exit(0);
