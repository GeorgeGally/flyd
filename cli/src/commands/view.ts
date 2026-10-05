import { execFile } from "node:child_process";
import { ClaudeCodeTranscriptSource, FIRSTMATE_PROJECT_DIR, resolveProjectDir } from "../conversation-view/claude-code-source.js";
import { FirstmateInbox } from "../conversation-view/firstmate-inbox.js";
import { ConversationViewServer, DEFAULT_VIEW_PORT, VIEW_HOST } from "../conversation-view/server.js";

export interface ViewOptions {
  project?: string;
  session?: string;
  port?: number;
  open?: boolean;
  /** Path to firstmate's fm-inbox.sh; default <firstmate home>/bin/fm-inbox.sh. */
  inbox?: string;
  /** Firstmate's home (FM_HOME); default $FIRSTMATE_HOME or ~/Documents/firstmate. */
  firstmateHome?: string;
  /** false: no message box, even when firstmate's inbox is available. */
  send?: boolean;
}

const PORT_ATTEMPTS = 10;

async function listenNear(server: ConversationViewServer, port: number, explicit: boolean): Promise<number> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await server.listen(port + attempt);
    } catch (error) {
      const busy = (error as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (!busy || explicit || attempt + 1 >= PORT_ATTEMPTS) throw error;
    }
  }
}

function openInBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  execFile(command, [url], () => {});
}

/** `flyd view`: a calm view of a conversation, served on loopback, with a box to message firstmate. */
export async function runView(options: ViewOptions = {}): Promise<void> {
  if (options.port !== undefined && !(Number.isInteger(options.port) && options.port > 0 && options.port < 65536)) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
  const projectDir = resolveProjectDir(options.project ?? FIRSTMATE_PROJECT_DIR);
  // Messages go to firstmate's own inbox, so the box only appears on
  // firstmate's conversation unless an inbox is named explicitly.
  const inbox = new FirstmateInbox({
    ...(options.firstmateHome ? { home: options.firstmateHome } : {}),
    ...(options.inbox ? { script: options.inbox } : {}),
  });
  const wantsInbox = options.send !== false && (options.project === undefined || options.inbox !== undefined);
  if (wantsInbox && options.inbox !== undefined && !inbox.available()) throw new Error(`No inbox script at ${inbox.script}`);
  const source = new ClaudeCodeTranscriptSource({ projectDir, ...(wantsInbox && inbox.available() ? { inbox } : {}) });
  const sessions = await source.listSessions();
  if (sessions.length === 0) throw new Error(`No Claude Code sessions in ${projectDir}`);
  if (options.session && !sessions.some((session) => session.id === options.session)) {
    throw new Error(`No session ${options.session} in ${projectDir}`);
  }

  const server = new ConversationViewServer(source);
  const port = await listenNear(server, options.port ?? DEFAULT_VIEW_PORT, options.port !== undefined);
  const url = `http://${VIEW_HOST}:${port}/${options.session ? `?session=${encodeURIComponent(options.session)}` : ""}`;
  console.log(`flyd view — ${source.assistantLabel} at ${url}`);
  console.log(source.canSend
    ? `Messages you type go to firstmate's inbox (${inbox.script}). Ctrl-C to stop.`
    : "Read-only. Ctrl-C to stop.");
  if (options.open !== false) openInBrowser(url);

  await new Promise<void>((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      void server.close().then(resolve);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}
