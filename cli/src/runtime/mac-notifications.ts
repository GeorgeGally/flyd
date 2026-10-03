import { execFile } from "node:child_process";
import { connect } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ADAPTER_NOTIFICATION_PORT = 4818;

export interface MacNotificationDependencies {
  adapter?: (title: string, message: string) => Promise<boolean>;
  fallback?: (title: string, message: string) => Promise<void>;
}

async function adapterNotification(title: string, message: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port: ADAPTER_NOTIFICATION_PORT });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 2_000);
    timer.unref();
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ title, message })}\n`);
    });
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      clearTimeout(timer);
      try {
        finish((JSON.parse(buffer.slice(0, newline)) as { ok?: boolean }).ok === true);
      } catch {
        finish(false);
      }
    });
    socket.on("error", () => { clearTimeout(timer); finish(false); });
    socket.on("close", () => { clearTimeout(timer); finish(false); });
  });
}

async function osascriptNotification(title: string, message: string): Promise<void> {
  const script = "on run argv\n display notification (item 2 of argv) with title (item 1 of argv)\nend run";
  await execFileAsync("osascript", ["-e", script, title, message], { timeout: 10_000 });
}

export async function showMacNotification(
  title: string,
  message: string,
  deps: MacNotificationDependencies = {},
): Promise<void> {
  if (process.platform !== "darwin") return;
  const text = message.replace(/\s+/g, " ").slice(0, 220);
  const adapter = deps.adapter ?? adapterNotification;
  if (await adapter(title, text).catch(() => false)) return;
  const fallback = deps.fallback ?? osascriptNotification;
  await fallback(title, text);
}
