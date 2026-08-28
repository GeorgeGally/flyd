import { respondToConversation } from "./dist/runtime/conversation-responder.js";
for (const model of ["gpt-5.6-sol", "gpt-5.6-luna"]) {
  const t0 = Date.now();
  const answer = await respondToConversation({
    sessionId: "smoke", turnNumber: 1,
    message: "In one sentence, what is flyd?",
    history: [], memory: { verdict: "insufficient", matches: [] }, situation: null,
    onToken: () => {},
  }, { resolveConnection: () => ({ model, apiKey: process.env.OPENAI_API_KEY, providerIdentity: `x/${model}` }) });
  console.log(`\n[${model}] ${(Date.now()-t0)/1000}s | ${answer.replace(/\s+/g," ").slice(0,110)}`);
}
