import { resolveModelConnection } from "./dist/lib/config.js";
import { respondToConversation } from "./dist/runtime/conversation-responder.js";

const t0 = Date.now();
const answer = await respondToConversation({
  sessionId: "smoke",
  turnNumber: 1,
  message: "In one sentence, what is flyd and what is its main memory store?",
  history: [],
  memory: { verdict: "insufficient", matches: [] },
  situation: null,
  onToken: (t) => process.stdout.write(t),
});
console.log("\n---");
console.log("elapsed:", ((Date.now() - t0) / 1000).toFixed(1) + "s");
console.log("model:", resolveModelConnection().model);
