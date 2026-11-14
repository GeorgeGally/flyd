import { execFile } from "node:child_process";
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { LIESEL_LOCAL_ORIGIN, lieselCommand, startLiesel } from "../conversation-view/liesel.js";

// Every lab lands on a Liesel board, where George reviews: each version is a frame shown at desktop,
// iPad and phone size, he pins notes on any of them, and he can mark one as final. Before this a lab
// was only a card in his column, so nothing was ever picked or built. Flyd listens to the board the
// way an agent does (Liesel's own poll): a final becomes a build of that version, and notes become the
// next round, both through the lab's usual follow-up path (command/followup.ts).

export interface LabBoard {
  /** The board on this Mac: http://127.0.0.1:4747/board/<key>. */
  url: string;
  key: string;
  /** The board's folder: board.json beside a copy of each version's page. */
  dir: string;
  /** He ended the board's session; nothing more comes from it. */
  ended?: boolean;
}

/** Runs the liesel CLI with arguments; resolves with what it printed. Injectable for tests. */
export type LieselCli = (args: string[]) => Promise<string>;

/** Liesel's CLI, run with Core's own node: a GUI launch has no PATH to find one. */
export const runLieselCli: LieselCli = (args) => {
  if (process.env.VITEST) return Promise.reject(new Error("no real Liesel under vitest"));
  const { cwd } = lieselCommand();
  const script = join(cwd, "bin", "liesel.js");
  if (!existsSync(script)) return Promise.reject(new Error(`Liesel is not at ${cwd}`));
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [script, ...args], { cwd, timeout: 90_000, maxBuffer: 1 << 20, env: { ...process.env, BROWSER: "none" } }, (error, stdout, stderr) => {
      if (error) reject(new Error(`liesel ${args[0]} ${args[1] ?? ""} failed: ${(stderr || stdout || error.message).trim().slice(0, 300)}`));
      else resolve(`${stdout}\n${stderr}`);
    });
  });
};

/** Whether anything answers on Liesel's port. */
async function lieselAnswers(): Promise<boolean> {
  try {
    const response = await fetch(`${LIESEL_LOCAL_ORIGIN}/`, { signal: AbortSignal.timeout(1500), redirect: "manual" });
    await response.body?.cancel().catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Starts Liesel the way Flyd's board opener does (on the phone's address too) when nothing answers yet. */
export async function ensureLiesel(waitMs = 20_000): Promise<void> {
  if (process.env.VITEST || await lieselAnswers()) return;
  startLiesel();
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (await lieselAnswers()) return;
  }
  throw new Error("Liesel did not start");
}

const BOARD_URL = /https?:\/\/[^\s"'<>]+\/board\/([A-Za-z0-9_-]{6,64})/;

function boardFiles(dir: string): string[] {
  try {
    const board = JSON.parse(readFileSync(join(dir, "board.json"), "utf8")) as { items?: Array<{ file?: string }> };
    return (board.items ?? []).map((item) => String(item.file ?? ""));
  } catch {
    return [];
  }
}

export interface BoardInput {
  /** The lab's folder, holding v<n>.html and img/. */
  labDir: string;
  /** The board's name, as George sees it. */
  name: string;
  versions: Array<{ n: number; name: string }>;
  /** The Creative Director's words, posted on the board beside the frames. */
  note?: string;
}

/**
 * Puts a lab on a board: a copy of each version's page (and the pictures it uses) in the lab's
 * board/ folder, one frame per version labelled "V2 · Name", opened without taking over his screen.
 * Safe to run again: a version already on the board is not added twice.
 */
export async function putLabOnBoard(input: BoardInput, cli: LieselCli = runLieselCli, ready: () => Promise<void> = ensureLiesel): Promise<LabBoard> {
  const dir = join(input.labDir, "board");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const images = join(input.labDir, "img");
  if (existsSync(images)) cpSync(images, join(dir, "img"), { recursive: true });
  await ready();
  const onBoard = boardFiles(dir);
  for (const version of input.versions) {
    const file = `v${version.n}.html`;
    copyFileSync(join(input.labDir, file), join(dir, file));
    if (!onBoard.includes(file)) await cli(["board", "add", dir, join(dir, file), "--label", `V${version.n} · ${version.name}`]);
  }
  const opened = await cli(["board", "open", dir, "--name", input.name.slice(0, 80), "--no-open"]);
  const key = BOARD_URL.exec(opened)?.[1];
  if (!key) throw new Error("Liesel opened the board but did not say where it is");
  if (input.note?.trim()) await cli(["reply", dir, "--agent-reply", input.note.trim().slice(0, 1500)]).catch(() => undefined);
  return { url: `${LIESEL_LOCAL_ORIGIN}/board/${key}`, key, dir };
}

/** One message from the board, as Liesel's poll hands it over. */
export interface BoardPrompt {
  prompt: string;
  prompt_id?: string;
  item?: { id: string; label?: string };
  pin?: { number: number; excerpt?: string };
  thread?: string;
}

/** What George did on a board: marked a version final, and/or pinned notes. Pure. */
export interface BoardFeedback {
  /** The version he marked final, by number. */
  final?: number;
  /** His notes, each with the version and spot it is on. */
  notes: string[];
  /** Ids of the board messages this covers, for a stable follow-up id. */
  ids: string[];
}

const FINAL = /chosen as final/i;

export function readBoardFeedback(prompts: BoardPrompt[]): BoardFeedback {
  let final: number | undefined;
  const notes: string[] = [];
  for (const prompt of prompts) {
    const text = String(prompt.prompt ?? "").trim();
    const item = prompt.item?.id ?? /\(item ([^,)]+)/.exec(text)?.[1] ?? "";
    const version = Number(/^v(\d+)/i.exec(item)?.[1]);
    if (FINAL.test(text)) {
      if (Number.isFinite(version)) final = version;
      continue;
    }
    if (!text) continue;
    const where = [prompt.item?.label || (Number.isFinite(version) ? `V${version}` : ""), prompt.pin?.excerpt ? `on "${prompt.pin.excerpt}"` : ""].filter(Boolean).join(" ");
    notes.push(where ? `${where}: ${text}` : text);
  }
  return { ...(final !== undefined ? { final } : {}), notes, ids: prompts.map((prompt) => prompt.prompt_id ?? "").filter(Boolean) };
}

/** Called with what George sent from a board; resolves with the line posted back on the board. */
export type BoardHandler = (feedback: BoardFeedback) => Promise<string>;

export interface BoardWatch {
  runId: string;
  board: LabBoard;
  /** The lab's folder, where what arrives is kept before it is acted on. */
  labDir: string;
  onFeedback: BoardHandler;
  onEnded?: () => void;
}

export interface PollAnswer { status?: string; code?: string; prompts?: BoardPrompt[]; session_ended?: boolean }

/** One long poll of a board on loopback Liesel. A dropped poll leaves the feedback queued in Liesel. */
export async function pollBoard(dir: string, signal: AbortSignal): Promise<PollAnswer> {
  const file = realpathSync(join(dir, "board.json"));
  const response = await fetch(`${LIESEL_LOCAL_ORIGIN}/api/poll?${new URLSearchParams({ file, owner: "Flyd" })}`, { signal });
  return await response.json() as PollAnswer;
}

/**
 * Keeps one poll open per board Flyd is listening to. What arrives is written to the lab's
 * board-feedback.jsonl before anything acts on it, then handed to the lab's handler, and the
 * handler's line is posted back on the board.
 */
export class BoardWatcher {
  private readonly open = new Map<string, AbortController>();

  constructor(private readonly options: { poll?: typeof pollBoard; cli?: LieselCli; retryMs?: number } = {}) {}

  watching(): string[] {
    return [...this.open.keys()];
  }

  /** Watches every board in `watches` not already watched, and stops watching any no longer listed. */
  sync(watches: BoardWatch[]): void {
    const wanted = new Set(watches.map((watch) => watch.runId));
    for (const [runId, controller] of this.open) if (!wanted.has(runId)) { controller.abort(); this.open.delete(runId); }
    for (const watch of watches) if (!this.open.has(watch.runId)) this.listen(watch);
  }

  stop(): void {
    for (const controller of this.open.values()) controller.abort();
    this.open.clear();
  }

  private listen(watch: BoardWatch): void {
    const controller = new AbortController();
    this.open.set(watch.runId, controller);
    const poll = this.options.poll ?? pollBoard;
    const cli = this.options.cli ?? runLieselCli;
    const retryMs = this.options.retryMs ?? 60_000;
    const pause = (ms: number) => new Promise<void>((resolve) => { const timer = setTimeout(resolve, ms); timer.unref?.(); });
    void (async () => {
      while (!controller.signal.aborted) {
        let answer: PollAnswer;
        try {
          answer = await poll(watch.board.dir, controller.signal);
        } catch {
          // Liesel is down or busy: George cannot send anything until it is up again, so ask again later.
          if (!controller.signal.aborted) await pause(retryMs);
          continue;
        }
        if (answer.code) { await pause(retryMs); continue; }
        if (answer.status === "feedback" && answer.prompts?.length) {
          try { appendFileSync(join(watch.labDir, "board-feedback.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), prompts: answer.prompts })}\n`, { mode: 0o600 }); } catch { /* Kept only as a record. */ }
          const feedback = readBoardFeedback(answer.prompts);
          const line = await watch.onFeedback(feedback).catch((error: unknown) => `I couldn't act on that: ${error instanceof Error ? error.message : String(error)}`);
          await cli(["reply", watch.board.dir, "--agent-reply", line]).catch(() => undefined);
        }
        if (answer.session_ended || answer.status === "ended") {
          watch.onEnded?.();
          break;
        }
        if (answer.status !== "feedback") await pause(1_000);
      }
      if (this.open.get(watch.runId) === controller) this.open.delete(watch.runId);
    })();
  }
}
