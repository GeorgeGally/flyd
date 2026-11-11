import type { MachineAction, MachineReading, MachineRow, MachineTools } from "./machines.js";

// The Machines tab in words: one plain sentence per machine about what matters
// most right now, and at most one thing to do about it; and one sentence for the
// tool versions across every machine. Pure: built from a reading, never a read.
// A button only ever asks Flyd, in the conversation, in the words written here;
// one that would change something asks George first (`confirm`).

const GB = 1024 ** 3;
const SWAP_FULL = 0.8;
const MEMORY_FULL = 0.9;
const DISK_FULL = 0.9;
/** Test browsers worth closing: this much memory, or this many processes. */
const TEST_BROWSER_BYTES = GB;
const TEST_BROWSER_COUNT = 20;

/** A size as people say it: "15 GB", "1.5 GB", "800 MB". */
export function sayBytes(bytes: number): string {
  if (bytes >= 10 * GB) return `${Math.round(bytes / GB)} GB`;
  if (bytes >= GB) return `${Math.round((bytes / GB) * 10) / 10} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

/** "the Mac", "the PC"; a name that is not a plain noun stays as it is. */
function the(name: string): string {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) ? `the ${name}` : name;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

function share(usage: { used: number; total: number } | undefined): number | undefined {
  return usage && usage.total > 0 ? usage.used / usage.total : undefined;
}

function offlineWords(row: MachineRow): { say: string; action?: MachineAction } {
  const name = the(row.name);
  const where = row.alias ? `${name} (${row.alias})` : name;
  const reason = row.reason ?? "It did not answer.";
  if (/could not log in/i.test(reason)) {
    return { say: `SSH could not log in to ${name}, so Flyd cannot see it.`,
      action: { label: "Show me the login steps", ask: `SSH cannot log in to ${where}. Show me the steps to fix the login.` } };
  }
  if (/does not trust/i.test(reason)) {
    return { say: `SSH does not trust ${name} yet, so Flyd cannot see it.`,
      action: { label: "Show me how to trust it", ask: `SSH does not trust ${where} yet. Show me how to check its host key and trust it.` } };
  }
  if (/not installed/i.test(reason)) return { say: reason };
  if (/does not know this name/i.test(reason)) {
    return { say: `SSH does not know the name ${row.alias ?? row.name}, so Flyd cannot see ${name}.`,
      action: { label: "Show me how to connect it", ask: `SSH does not know the host ${where}. Show me how to add it to my SSH config so Flyd can read it.` } };
  }
  return { say: `${capital(name)} is not answering.`,
    action: { label: "Find out why", ask: `${capital(where)} is not answering over SSH. Find out why, and tell me what you find.` } };
}

function onlineWords(row: MachineRow, reading: MachineReading): { say: string; action?: MachineAction } {
  const name = the(row.name);
  const total = reading.memory?.total ?? 0;
  const bytesOf = (percent: number): number => (percent / 100) * total;
  const swap = share(reading.swap);
  const memory = share(reading.memory);
  const disk = share(reading.disk);
  const tight = swap !== undefined && swap >= SWAP_FULL ? "swap is nearly full" : memory !== undefined && memory >= MEMORY_FULL ? "memory is nearly full" : "";
  const holding = reading.holding ?? [];

  const tests = holding.find((app) => app.test);
  if (tests && total && (bytesOf(tests.memory) >= TEST_BROWSER_BYTES || tests.count >= TEST_BROWSER_COUNT)) {
    const size = sayBytes(bytesOf(tests.memory));
    return {
      say: `Leftover test browsers are holding ${size} across ${plural(tests.count, "process", "processes")}${tight ? `, and ${tight}` : ""}.`,
      action: {
        label: "Close the leftover test browsers",
        confirm: `Close the ${plural(tests.count, "test browser process", "test browser processes")} on ${name}? Your own browser stays open.`,
        ask: `On ${name}, close the leftover test browsers (${tests.name}): ${plural(tests.count, "process", "processes")} holding ${size}. Leave my own browser and everything else open.`,
      },
    };
  }

  if (tight) {
    const top = holding[0];
    const say = top && total
      ? `${top.name} is holding ${sayBytes(bytesOf(top.memory))}${top.count > 1 ? ` across ${top.count} processes` : ""}, and ${tight}.`
      : `${capital(tight)}.`;
    return { say, action: { label: "Free up memory", ask: `${capital(name)} is short of memory. ${say} Find what can safely close, and check with me before closing anything I have open.` } };
  }

  if (disk !== undefined && disk >= DISK_FULL && reading.disk) {
    const say = `The disk is ${Math.round(disk * 100)}% full, with ${sayBytes(reading.disk.total - reading.disk.used)} left.`;
    return { say, action: { label: "Find space to free", ask: `${capital(name)} is running out of disk. ${say} Find what can be cleared, and check with me before deleting anything.` } };
  }

  const busy = reading.load && reading.cores ? reading.load[1] / reading.cores : 0;
  const busiest = reading.running[0];
  if (busy >= 1.5 && busiest) return { say: `It is working hard, mostly on ${busiest.name}.` };

  const parts = [
    reading.upDays !== undefined ? (reading.upDays ? `up ${plural(reading.upDays, "day")}` : "up since today") : "",
    memory !== undefined ? `${Math.round(memory * 100)}% of memory in use` : "",
    reading.disk ? `${sayBytes(reading.disk.total - reading.disk.used)} free on disk` : "",
  ].filter(Boolean);
  return { say: parts.length ? `All well: ${parts.join(", ")}.` : "All well." };
}

/** What matters on one machine, and the one thing to do about it. */
export function machineWords(row: MachineRow): { say: string; action?: MachineAction } {
  if (row.state === "offline") return offlineWords(row);
  if (row.state === "online" && row.reading) return onlineWords(row, row.reading);
  return { say: "Checking it now." };
}

export const TOOL_NAMES: Record<keyof MachineTools, string> = { claude: "Claude Code", codex: "Codex" };

function parts(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function older(version: string, than: string): boolean {
  const [a, b] = [parts(version), parts(than)];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

/** "0.162.0" reads "0.162"; "2.1.318" stays. */
function short(version: string): string {
  return version.replace(/\.0$/, "");
}

function list(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Which machines run an older Claude Code or Codex than the newest release, in one sentence, and the update as one action. */
export function toolsWords(machines: MachineRow[], latest: MachineTools): { say: string; action?: MachineAction } | undefined {
  const sentences: string[] = [];
  const updates: string[] = [];
  const asks: string[] = [];
  const seenTools: string[] = [];
  let current = 0;
  for (const tool of Object.keys(TOOL_NAMES) as Array<keyof MachineTools>) {
    const newest = latest[tool];
    if (!newest) continue;
    const name = TOOL_NAMES[tool];
    const running = machines.flatMap((row) => {
      const version = row.reading?.tools?.[tool];
      return version ? [{ machine: the(row.name), version }] : [];
    });
    if (!running.length) continue;
    seenTools.push(name);
    const behind = running.filter((one) => older(one.version, newest));
    current += running.length - behind.length;
    if (!behind.length) continue;
    const [one] = behind;
    if (behind.length === 1 && one) {
      const [a, b] = [parts(one.version), parts(newest)];
      const oneStep = a[0] === b[0] && a[1] === b[1] && (b[2] ?? 0) - (a[2] ?? 0) === 1;
      sentences.push(oneStep ? `${name} is one behind on ${one.machine}.` : `${name} is behind on ${one.machine}, ${short(one.version)} against ${short(newest)}.`);
    } else {
      sentences.push(`${name} is behind on ${list(behind.map((each) => each.machine))}, against ${short(newest)}.`);
    }
    for (const each of behind) {
      updates.push(`${name} on ${each.machine}`);
      asks.push(`${name} on ${each.machine} from ${each.version} to ${newest}`);
    }
  }
  if (!seenTools.length) return undefined;
  if (!updates.length) return { say: `${list(seenTools)} ${seenTools.length > 1 ? "are" : "is"} up to date on every machine.` };
  if (current) sentences.push("The rest match.");
  const label = updates.length === 1 ? `Update ${updates[0]!.replace(/ on .*$/, "")}` : updates.length === 2 ? "Update both" : "Update them all";
  return {
    say: sentences.join(" "),
    action: { label, confirm: `Update ${list(updates)}?`, ask: `Update ${list(asks)}. Use each tool's own updater, and tell me if anything needs me.` },
  };
}
