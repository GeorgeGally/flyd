import { execFile } from "node:child_process";
import { ClaudeCodeTranscriptSource, FIRSTMATE_PROJECT_DIR, resolveProjectDir } from "../conversation-view/claude-code-source.js";
import { ConversationViewServer, DEFAULT_VIEW_PORT, VIEW_HOST } from "../conversation-view/server.js";

export interface ViewOptions {
  project?: string;
  session?: string;
  port?: number;
  open?: boolean;
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

/** `flyd view`: a calm, read-only view of a conversation, served on loopback. */
export async function runView(options: ViewOptions = {}): Promise<void> {
  if (options.port !== undefined && !(Number.isInteger(options.port) && options.port > 0 && options.port < 65536)) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
  const projectDir = resolveProjectDir(options.project ?? FIRSTMATE_PROJECT_DIR);
  const source = new ClaudeCodeTranscriptSource({ projectDir });
  const sessions = await source.listSessions();
  if (sessions.length === 0) throw new Error(`No Claude Code sessions in ${projectDir}`);
  if (options.session && !sessions.some((session) => session.id === options.session)) {
    throw new Error(`No session ${options.session} in ${projectDir}`);
  }

  const server = new ConversationViewServer(source);
  const port = await listenNear(server, options.port ?? DEFAULT_VIEW_PORT, options.port !== undefined);
  const url = `http://${VIEW_HOST}:${port}/${options.session ? `?session=${encodeURIComponent(options.session)}` : ""}`;
  console.log(`flyd view — ${source.assistantLabel} at ${url}`);
  console.log("Read-only. Ctrl-C to stop.");
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
