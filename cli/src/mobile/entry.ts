import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireMobileOwner } from "./owner.js";
import { MobileAuth } from "./auth.js";

/** Separate adapter entry; no Rails, desktop Core launcher or FirstMate startup. */
export async function runMobile(args: string[] = []): Promise<void> {
  process.umask(0o077);
  const dir = join(homedir(), ".flyd");
  if (process.env.FLYD_DIR && resolve(process.env.FLYD_DIR) !== dir) {
    throw new Error("Mobile service requires FLYD_DIR=$HOME/.flyd while legacy home paths are being consolidated. Use a dedicated service user/home.");
  }
  process.env.FLYD_DIR = dir;
  const { FLYD_DIR } = await import("../lib/config.js");
  if (resolve(FLYD_DIR) !== dir) throw new Error("A cached Flyd configuration points at another state directory; launch the mobile entry in a fresh process");
  const privateDir = join(dir, "mobile"), auth = new MobileAuth(privateDir);
  const action = args[0] ?? "serve";
  if (args.length > 1 || !["serve", "pair", "revoke"].includes(action)) throw new Error("Usage: flyd mobile [serve|pair|revoke]");
  if (action === "pair") { console.log(`Pairing code (one use, expires in 10 minutes):\n${auth.pair()}`); return; }
  if (action === "revoke") { auth.revokeAll(); console.log("All mobile sessions and pairing codes revoked."); return; }
  const origin = process.env.FLYD_MOBILE_ORIGIN;
  if (!origin) throw new Error("Set FLYD_MOBILE_ORIGIN to your exact HTTPS origin");
  const port = Number(process.env.FLYD_MOBILE_PORT ?? 4819);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid FLYD_MOBILE_PORT");
  // Refuse a competing local desktop Core before taking ownership.
  const activeCore = await fetch("http://127.0.0.1:4815/health", { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
  if (activeCore) throw new Error("Stop local desktop Core before starting the mobile owner");
  const releaseOwner = acquireMobileOwner(dir);
  let close: (() => Promise<void>) | undefined;
  try {
    const [{ IntelligenceEventStore }, { MobileRequests }, { MobileServer }, { respondToConversation }] = await Promise.all([
      import("../intelligence/event-store.js"), import("./requests.js"), import("./server.js"), import("../runtime/conversation-responder.js"),
    ]);
    const accounts = process.env.FLYD_MOBILE_ACCOUNTS === "1", voice = process.env.FLYD_MOBILE_VOICE === "1";
    if (voice && !process.env.OPENAI_API_KEY) throw new Error("Mobile voice needs OPENAI_API_KEY, separately from any non-OpenAI chat key");
    const { chatModelChain, resolveModelConnection } = await import("../lib/config.js");
    resolveModelConnection(chatModelChain()[0]);
    const db = new IntelligenceEventStore(), requests = new MobileRequests(db);
    const mail = accounts ? new (await import("./mail.js")).MobileMail(db) : undefined;
    const scout = await import("../council/scout.js");
    const server = new MobileServer({
      origin, auth, requests,
      // Today's news with the desktop's more/less: a local preference write, no tool or outward action.
      news: () => {
        const edition = scout.latestEdition();
        return edition ? { date: edition.date, items: edition.items.map(({ n, title, url, source, why, kind }) => ({ n, title, url, source, why, kind })) } : null;
      },
      rateStory: ({ n, url, verdict }) => scout.latestEdition()?.items.find((item) => item.n === n)?.url === url && Boolean(scout.recordScoutFeedback(n, verdict)),
      ...(mail ? { mail: (action: string, input: Record<string, unknown>) => mail.run(action, input) } : {}),
      answer: (message, history, id) => respondToConversation({
        surface: "mobile", mobileAccounts: accounts,
        sessionId: "mobile", turnNumber: requests.list().findIndex(row => row.id === id) + 1,
        message, history, memory: { verdict: "insufficient", matches: [] }, situation: null, onToken: () => {},
      }),
      ...(accounts ? { whatsapp: async (name: string, input: Record<string, unknown>) => {
        const { runWhatsAppTool } = await import("../connectors/whatsapp-tools.js");
        return runWhatsAppTool(name, input);
      } } : {}),
      ...(voice ? { transcribe: async (pcm: Buffer): Promise<string> => {
        const { transcribeBufferedAudio } = await import("../transcription.js");
        let text: string | undefined, error: string | undefined;
        await transcribeBufferedAudio([pcm], { send: raw => {
          const result = JSON.parse(String(raw));
          if (result.type === "complete") text = result.text;
          if (result.type === "error") error = result.message;
        } }, { kind: "conversation" }, AbortSignal.timeout(50_000));
        if (error || text === undefined) throw new Error("Voice transcription unavailable");
        return text;
      } } : {}),
    });
    close = async () => {
      await server.close();
      if (accounts) { const { whatsappClient } = await import("../connectors/whatsapp.js"); whatsappClient().stop(); }
      db.close();
    };
    await server.listen(port);
    console.log(`Flyd mobile listening privately on 127.0.0.1:${port}; HTTPS origin ${origin}`);
    await new Promise<void>(done => {
      const stop = () => { process.off("SIGINT", stop); process.off("SIGTERM", stop); done(); };
      process.on("SIGINT", stop); process.on("SIGTERM", stop);
    });
  } finally {
    try { await close?.(); } finally { releaseOwner(); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMobile(process.argv.slice(2)).catch(error => { console.error(`Flyd mobile: ${error instanceof Error ? error.message : "could not start"}`); process.exitCode = 1; });
}
