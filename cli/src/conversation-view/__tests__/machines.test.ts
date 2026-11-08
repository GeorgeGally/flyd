import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_MACHINES, MachinesBoard, READ_SCRIPT, offlineReason, parseReading, sshArgs, validAlias } from "../machines.js";
import type { MachineRow } from "../machines.js";
import { ConversationViewServer } from "../server.js";
import type { ConversationSource } from "../types.js";

const LINUX = `Last login banner the shell printed
@@cores
12
@@uptime
 07:15:37 up 2 days,  8:51,  3 users,  load average: 0.93, 0.86, 0.85
@@memory
MemTotal:       32000000 kB
MemFree:         4000000 kB
MemAvailable:   24000000 kB
SwapTotal:       8000000 kB
SwapFree:        6000000 kB
@@disk
Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/nvme0n1p2  1000000000 400000000 550000000      43% /
@@running
 92.5  3.1 node
 12.0  1.5 node
  8.0  9.0 postgres
  4.0  0.0 ps
  1.0  0.1 kworker/0:1-events
  0.5  0.1 sshd
  0.2  0.1 systemd
@@end
`;

const MAC = `@@cores
10
@@uptime
 7:15  up 3 days, 2:14, 2 users, load averages: 2.41 1.98 1.75
@@memory
34359738368
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               90000.
Pages active:                            800000.
Pages inactive:                          700000.
Pages speculative:                        20000.
Pages throttled:                              0.
Pages wired down:                        200000.
Pages purgeable:                           5000.
Pages occupied by compressor:            100000.
total = 2048.00M  used = 512.50M  free = 1535.50M  (encrypted)
@@disk
Filesystem    1024-blocks      Used Available Capacity  Mounted on
/dev/disk3s5    494384795 300000000 150000000    67%   /System/Volumes/Data
@@running
 40.0  2.0 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
 10.0  1.0 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  9.0  4.0 /usr/local/bin/node
@@end
`;

describe("a reading", () => {
  it("reads Linux output, ignoring what the shell printed first", () => {
    const reading = parseReading(LINUX)!;
    expect(reading.cores).toBe(12);
    expect(reading.load).toEqual([0.93, 0.86, 0.85]);
    expect(reading.memory).toEqual({ used: 8000000 * 1024, total: 32000000 * 1024 });
    expect(reading.swap).toEqual({ used: 2000000 * 1024, total: 8000000 * 1024 });
    expect(reading.disk).toEqual({ used: 400000000 * 1024, total: 1000000000 * 1024 });
  });

  it("reads macOS output", () => {
    const reading = parseReading(MAC)!;
    expect(reading.cores).toBe(10);
    expect(reading.load).toEqual([2.41, 1.98, 1.75]);
    expect(reading.memory).toEqual({ used: 1100000 * 16384, total: 34359738368 });
    expect(reading.swap).toEqual({ used: 512.5 * 1024 ** 2, total: 2048 * 1024 ** 2 });
    expect(reading.disk).toEqual({ used: 300000000 * 1024, total: 494384795 * 1024 });
  });

  it("adds up what is running by name, busiest first, without the read's own commands", () => {
    expect(parseReading(LINUX)!.running.map((process) => process.name)).toEqual(["node", "postgres", "kworker/0:1-events", "sshd", "systemd"]);
    expect(parseReading(LINUX)!.running[0]).toEqual({ name: "node", cpu: 104.5, memory: 4.6 });
    expect(parseReading(MAC)!.running).toEqual([{ name: "Google Chrome", cpu: 50, memory: 3 }, { name: "node", cpu: 9, memory: 4 }]);
  });

  it("reads a machine with no swap as none", () => {
    expect(parseReading(LINUX.replace(/SwapTotal.*\nSwapFree.*/, "SwapTotal: 0 kB\nSwapFree: 0 kB"))!.swap).toEqual({ used: 0, total: 0 });
  });

  it("is nothing when the output stops short or holds nothing usable", () => {
    expect(parseReading(LINUX.slice(0, LINUX.indexOf("@@end")))).toBeNull();
    expect(parseReading("Welcome\n@@end\n")).toBeNull();
    expect(parseReading("")).toBeNull();
  });

  it("runs only commands that read, on both of its paths, and leaves its directory alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "flyd-machines-"));
    try {
      const meminfo = join(dir, "meminfo");
      const absent = join(dir, "absent");
      writeFileSync(meminfo, "MemTotal: 1 kB\n");
      const before = readdirSync(dir);
      // sh's own trace names every command the script runs. The two checks are aimed so each path runs on any computer.
      const commandsOn = (memory: string, dataVolume: string): string[] => {
        const script = READ_SCRIPT.replaceAll("/proc/meminfo", memory).replaceAll("/System/Volumes/Data", dataVolume);
        const { stderr } = spawnSync("sh", ["-x", "-s"], { input: script, cwd: dir, encoding: "utf8", env: { HOME: dir, PATH: process.env.PATH, PS4: "+ " } });
        return stderr.split("\n").flatMap((line) => /^\++ '?([^\s']+)/.exec(line)?.[1] ?? []);
      };
      const ran = new Set([...commandsOn(meminfo, absent), ...commandsOn(absent, dir)]);
      expect([...ran].sort()).toEqual(["[", "cat", "df", "echo", "export", "getconf", "head", "ps", "sort", "sysctl", "uptime", "vm_stat"]);
      expect(readdirSync(dir)).toEqual(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads this computer for real", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flyd-machines-"));
    try {
      const board = new MachinesBoard({ path: join(dir, "machines.json"), first: [], localName: "Here" });
      board.view();
      await vi.waitFor(() => expect(board.view().machines[0]!.state).toBe("online"), { timeout: 8000, interval: 50 });
      const [row] = board.view().machines;
      expect(row).toMatchObject({ name: "Here", local: true });
      expect(row!.alias).toBeUndefined();
      expect(row!.reading!.load).toHaveLength(3);
      expect(row!.reading!.memory!.total).toBeGreaterThan(0);
      expect(row!.reading!.disk!.total).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("an alias", () => {
  it("takes host names, addresses and user@host", () => {
    for (const alias of ["radarboy3k", "85.155.185.63", "my_box-2.local", "george@studio"]) expect(validAlias(alias), alias).toBe(true);
  });

  it("can never read as an option or reach a shell", () => {
    for (const alias of ["-oProxyCommand=touch /tmp/x", "-v", "a b", "a;rm", "$(id)", "`id`", "a\nb", "host|x", "@host", "-x@host", "a@-b", "", "a".repeat(121), "%h", "ssh://host"]) {
      expect(validAlias(alias), alias).toBe(false);
      expect(() => sshArgs(alias)).toThrow();
    }
  });

  it("goes after the end of ssh's options, in batch mode with a short timeout", () => {
    const args = sshArgs("radarboy3k");
    expect(args.slice(-3)).toEqual(["--", "radarboy3k", "sh -s"]);
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("ConnectTimeout=5");
  });
});

describe("the offline reason", () => {
  it("says why in plain words, never the raw error", () => {
    expect(offlineReason("george@h: Permission denied (publickey).", false)).toMatch(/could not log in/);
    expect(offlineReason("ssh: Could not resolve hostname nope: Name or service not known", false)).toMatch(/does not know this name/);
    expect(offlineReason("Host key verification failed.", false)).toMatch(/does not trust/);
    expect(offlineReason("Connection refused", false)).toBe("It did not answer.");
    expect(offlineReason("", true)).toBe("It did not answer.");
    expect(offlineReason("", false, true)).toBe("SSH is not installed here.");
  });
});

describe("the board, with a fake ssh", () => {
  let dir: string;
  let path: string;
  let ssh: string;

  // Stands in for ssh: records its arguments and stdin, then acts by alias.
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-machines-"));
    path = join(dir, "machines.json");
    ssh = join(dir, "ssh");
    writeFileSync(join(dir, "linux.txt"), LINUX);
    writeFileSync(join(dir, "mac.txt"), MAC);
    writeFileSync(ssh, `#!/bin/sh
for arg; do last2=$last; last=$arg; done
alias=$last2
printf '%s\\n' "$@" > "${dir}/$alias.args"
cat > "${dir}/$alias.stdin"
case "$alias" in
  linux) cat "${dir}/linux.txt" ;;
  mac|local) cat "${dir}/mac.txt" ;;
  dead) exec sleep 30 ;;
  locked) echo "george@locked: Permission denied (publickey)." >&2; exit 255 ;;
  gibberish) echo "this is not a reading" ;;
  flaky) if [ -e "${dir}/down" ]; then echo "Connection refused" >&2; exit 255; fi; cat "${dir}/linux.txt" ;;
esac
`);
    chmodSync(ssh, 0o755);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const board = (machines: Array<{ name: string; alias: string }>, freshMs = 60_000) =>
    new MachinesBoard({ path, ssh, first: machines, freshMs, timeoutMs: 700, localName: "Here" });
  const row = (rows: MachineRow[], id: string) => rows.find((machine) => machine.id === id)!;

  it("reads each machine with the fixed script and shows the Mac and Linux rows", async () => {
    const machines = board([{ name: "Box", alias: "linux" }, { name: "iMac", alias: "mac" }]);
    machines.view();
    await vi.waitFor(() => {
      const rows = machines.view().machines;
      expect(row(rows, "linux").state).toBe("online");
      expect(row(rows, "mac").state).toBe("online");
    }, { timeout: 4000, interval: 20 });
    const rows = machines.view().machines;
    expect(row(rows, "linux").reading!.cores).toBe(12);
    expect(row(rows, "mac").reading!.running[0]!.name).toBe("Google Chrome");
    expect(readFileSync(join(dir, "linux.stdin"), "utf8")).toBe(READ_SCRIPT);
    expect(readFileSync(join(dir, "linux.args"), "utf8")).toContain("BatchMode=yes");
  });

  it("marks a dead machine offline without holding up the others or the answer", async () => {
    const machines = board([{ name: "Dead", alias: "dead" }, { name: "Box", alias: "linux" }]);
    const started = Date.now();
    const first = machines.view().machines;
    expect(Date.now() - started).toBeLessThan(200);
    expect(row(first, "dead").state).toBe("checking");
    await vi.waitFor(() => expect(row(machines.view().machines, "linux").state).toBe("online"), { timeout: 600, interval: 20 });
    expect(row(machines.view().machines, "dead").state).toBe("checking");
    await vi.waitFor(() => expect(row(machines.view().machines, "dead").state).toBe("offline"), { timeout: 3000, interval: 20 });
    const dead = row(machines.view().machines, "dead");
    expect(dead.reason).toBe("It did not answer.");
    expect(dead.reading).toBeUndefined();
  });

  it("says why a machine turned Flyd away, and treats output it cannot read as offline", async () => {
    const machines = board([{ name: "Locked", alias: "locked" }, { name: "Odd", alias: "gibberish" }]);
    machines.view();
    await vi.waitFor(() => {
      const rows = machines.view().machines;
      expect(row(rows, "locked").state).toBe("offline");
      expect(row(rows, "gibberish").state).toBe("offline");
    }, { timeout: 4000, interval: 20 });
    expect(row(machines.view().machines, "locked").reason).toMatch(/could not log in/);
    expect(JSON.stringify(machines.view())).not.toContain("george@locked");
  });

  it("goes offline, remembers when it was last seen, and comes back", async () => {
    const machines = board([{ name: "Flaky", alias: "flaky" }], 0);
    await vi.waitFor(() => expect(row(machines.view().machines, "flaky").state).toBe("online"), { timeout: 4000, interval: 20 });
    writeFileSync(join(dir, "down"), "");
    await vi.waitFor(() => expect(row(machines.view().machines, "flaky").state).toBe("offline"), { timeout: 4000, interval: 20 });
    const offline = row(machines.view().machines, "flaky");
    expect(offline.seenAt).toBeTruthy();
    expect(offline.reading).toBeUndefined();
    rmSync(join(dir, "down"));
    await vi.waitFor(() => expect(row(machines.view().machines, "flaky").state).toBe("online"), { timeout: 4000, interval: 20 });
  });

  it("says so when this computer has no ssh", async () => {
    const machines = new MachinesBoard({ path, ssh: join(dir, "no-ssh-here"), first: [{ name: "Box", alias: "linux" }], timeoutMs: 700, localName: "Here" });
    machines.view();
    await vi.waitFor(() => expect(row(machines.view().machines, "linux").reason).toBe("SSH is not installed here."), { timeout: 4000, interval: 20 });
  });

  it("does not read a machine again while its reading is fresh", async () => {
    const machines = board([{ name: "Box", alias: "linux" }]);
    await vi.waitFor(() => expect(row(machines.view().machines, "linux").state).toBe("online"), { timeout: 4000, interval: 20 });
    rmSync(join(dir, "linux.stdin"));
    machines.view();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(() => statSync(join(dir, "linux.stdin"))).toThrow();
  });

  it("starts from the PC and the server when nothing is saved, leaving out the computer it runs on", () => {
    expect(FIRST_MACHINES).toEqual([{ name: "PC", alias: "radarboy3k" }, { name: "Server", alias: "85.155.185.63" }]);
    const self = hostname().split(".")[0]!;
    const rows = new MachinesBoard({ path, ssh, first: [{ name: "Self", alias: self }, { name: "Box", alias: "linux" }] }).saved();
    expect(rows).toEqual([{ name: "Box", alias: "linux" }]);
  });

  it("saves any number of machines as a name and alias only", () => {
    const machines = board([{ name: "Box", alias: "linux" }]);
    for (let index = 0; index < 12; index += 1) expect(machines.add(`Rack ${index}`, `rack-${index}`)).toEqual({});
    expect(machines.saved()).toHaveLength(13);
    const stored = JSON.parse(readFileSync(path, "utf8")) as { machines: object[] };
    expect(stored.machines.every((machine) => Object.keys(machine).sort().join() === "alias,name")).toBe(true);
    expect(statSync(path).mode & 0o077).toBe(0);
  });

  it("turns down a bad name, a bad alias and a repeat", () => {
    const machines = board([{ name: "Box", alias: "linux" }]);
    expect(machines.add("  ", "host").error).toMatch(/name/);
    expect(machines.add("Evil", "-oProxyCommand=x").error).toMatch(/SSH host alias/);
    expect(machines.add("Evil", "host; rm -rf /").error).toMatch(/SSH host alias/);
    expect(machines.add("Again", "LINUX").error).toMatch(/already/);
    expect(machines.saved()).toHaveLength(1);
  });

  it("never passes a hand-edited bad alias on", () => {
    writeFileSync(path, JSON.stringify({ machines: [{ name: "Bad", alias: "-oProxyCommand=x" }, { name: "Good", alias: "linux", password: "no" }] }));
    expect(board([]).saved()).toEqual([{ name: "Good", alias: "linux" }]);
  });

  it("reads a saved machine called local over ssh, apart from this computer", async () => {
    const machines = board([{ name: "Box", alias: "local" }]);
    machines.view();
    await vi.waitFor(() => expect(machines.view().machines.every((machine) => machine.state === "online")).toBe(true), { timeout: 8000, interval: 20 });
    const [here, box] = machines.view().machines;
    expect(here).toMatchObject({ name: "Here", local: true });
    expect(box).toMatchObject({ name: "Box", alias: "local", local: false });
    expect(box!.id).not.toBe(here!.id);
    expect(box!.reading!.cores).toBe(10);
    expect(readFileSync(join(dir, "local.stdin"), "utf8")).toBe(READ_SCRIPT);
  });

  it("will not save over a list it could not read, and says so", () => {
    for (const contents of ['{ "machines": [{ "name": "Keep", "alias": "keep" },', '{ "machines": "keep" }', "null", '{ "machines": [{ "name": "Keep", "alias": "keep" }, { "name": "Typo", "alias": "ty po" }] }']) {
      writeFileSync(path, contents);
      expect(board([{ name: "Box", alias: "linux" }]).add("New", "new").error, contents).toMatch(/left the file alone/);
      expect(readFileSync(path, "utf8"), contents).toBe(contents);
    }
    expect(board([{ name: "Box", alias: "linux" }]).saved().map((machine) => machine.alias)).toEqual(["keep"]);
  });

  it("will not save over a list it cannot open, and shows no first machines for it", () => {
    rmSync(path, { force: true });
    mkdirSync(path);
    const machines = board([{ name: "Box", alias: "linux" }]);
    expect(machines.saved()).toEqual([]);
    expect(machines.add("New", "new").error).toMatch(/left the file alone/);
  });

  it("serves the list, and only changes it with the token", async () => {
    const source = { assistantLabel: "Flyd", canSend: true, listSessions: async () => [] } as unknown as ConversationSource;
    const feed = { start() {}, stop() {}, current: () => ({ memories: [], news: [], taste: [] }), onRefresh: () => () => {} };
    const server = new ConversationViewServer(source, undefined, undefined, undefined, feed as never,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, board([{ name: "Box", alias: "linux" }]));
    try {
      const base = `http://127.0.0.1:${await server.listen(0)}`;
      const token = ((await (await fetch(`${base}/api/token`)).json()) as { token: string }).token;
      const post = (body: unknown, headers: Record<string, string> = { "x-flyd-view-token": token }) =>
        fetch(`${base}/api/machines`, { method: "POST", headers, body: JSON.stringify(body) });
      for (const endpoint of ["machines", "weather"]) {
        expect((await fetch(`${base}/api/${endpoint}`)).status).toBe(403);
        expect((await fetch(`${base}/api/${endpoint}?token=wrong`)).status).toBe(403);
        expect((await fetch(`${base}/api/${endpoint}?token=${token}`)).status).toBe(200);
      }
      const listed = (await (await fetch(`${base}/api/machines?token=${token}`)).json()) as { machines: MachineRow[] };
      expect(listed.machines.map((machine) => machine.name)).toEqual(["Here", "Box"]);
      expect((await post({ name: "New", alias: "new" }, {})).status).toBe(403);
      expect((await post({ name: "New", alias: "new" }, { "x-flyd-view-token": token, origin: "https://evil.example" })).status).toBe(403);
      const refused = await post({ name: "Evil", alias: "-oProxyCommand=x" });
      expect(refused.status).toBe(400);
      expect(((await refused.json()) as { error: string }).error).toMatch(/SSH host alias/);
      expect((await post({ name: "No alias" })).status).toBe(400);
      const added = (await (await post({ name: "New", alias: "new" })).json()) as { machines: MachineRow[] };
      expect(added.machines.map((machine) => machine.name)).toEqual(["Here", "Box", "New"]);
    } finally {
      await server.close();
    }
  });

  it("serves an empty list when there is no board, and never runs ssh", async () => {
    const source = { assistantLabel: "Flyd", canSend: true, listSessions: async () => [] } as unknown as ConversationSource;
    const feed = { start() {}, stop() {}, current: () => ({ memories: [], news: [], taste: [] }), onRefresh: () => () => {} };
    const server = new ConversationViewServer(source, undefined, undefined, undefined, feed as never);
    try {
      const base = `http://127.0.0.1:${await server.listen(0)}`;
      const token = ((await (await fetch(`${base}/api/token`)).json()) as { token: string }).token;
      expect(await (await fetch(`${base}/api/machines?token=${token}`)).json()).toEqual({ machines: [] });
    } finally {
      await server.close();
    }
  });
});
