import { describe, expect, it } from "vitest";
import { buildWeek, firstClause, parseLog, plainSubject, registryProjects, WeekReader, type WeekChange } from "../week.js";

const at = (day: string, hour: number, minute = 0) => new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`).getTime();
const NOW = at("2026-11-11", 8, 41);

describe("week", () => {
  it("reads firstmate's registry as projects with their live copies, in the names he uses", () => {
    const registry = [
      "# Fleet project registry",
      "- flyd [no-mistakes-prod-only +yolo] - Flyd: personal intelligence; live copy ~/Documents/flyd (added 2026-09-14)",
      "- dead-internet-radio [no-mistakes +yolo] - Dead Internet Radio; remote GeorgeGally/dead-internet-radio; live copy ~/Documents/dead-internet-radio, plus sibling clones",
      "- capfive [local-only +yolo] - CapFive (rebrand of AICA): WordPress site; live copy ~/Documents/cap5 (added 2026-09-25)",
      "- easel [local-only +yolo] - Liesel: visual review boards (remote `liesel`)",
    ].join("\n");
    expect(registryProjects(registry, "/home/g")).toEqual([
      { name: "Flyd", dir: "/home/g/Documents/flyd" },
      { name: "DIR", dir: "/home/g/Documents/dead-internet-radio" },
      { name: "CapFive", dir: "/home/g/Documents/cap5" },
    ]);
  });

  it("says a change in plain words and short", () => {
    expect(plainSubject("fix(mac-adapter): one session owns the mic (#272)")).toBe("One session owns the mic");
    expect(plainSubject("feat!: big change.")).toBe("Big change");
    expect(firstClause("A drag on a big page does less per frame: a layer's outermost group is kept")).toBe("A drag on a big page does less per frame");
    expect(firstClause("x".repeat(20) + " " + "word ".repeat(30)).endsWith("…")).toBe(true);
  });

  it("counts each change once in its local hour, over the eight days ending today, and tells each day", () => {
    const changes: WeekChange[] = [
      { project: "Flyd", hash: "a", at: at("2026-11-10", 9, 5), subject: "chore: tidy" },
      { project: "Flyd", hash: "b", at: at("2026-11-10", 9, 40), subject: "feat(view): add the Week tab (#300)" },
      { project: "Flyd", hash: "b2", at: at("2026-11-10", 9, 40), subject: "feat(view): add the Week tab (#300)" },
      { project: "Logan", hash: "c", at: at("2026-11-10", 21, 0), subject: "fix: keep the canvas still" },
      { project: "DIR", hash: "d", at: at("2026-11-04", 0, 30), subject: "Add aliens-only artwork" },
      { project: "DIR", hash: "e", at: at("2026-11-03", 23, 0), subject: "too old" },
      { project: "Bloom", hash: "f", at: at("2026-11-11", 8, 0), subject: "feat: tracker" },
      { project: "Bloom", hash: "g", at: at("2026-11-11", 9, 0), subject: "from the future" },
    ];
    const week = buildWeek(changes, NOW);
    expect(week.days.map((day) => day.day)).toEqual(["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"]);
    const tuesday = week.days[6]!;
    expect(tuesday.changes).toBe(3);
    expect(tuesday.hours.Flyd![9]).toBe(2);
    expect(tuesday.hours.Logan![21]).toBe(1);
    expect(tuesday.head).toBe("Add the Week tab");
    expect(tuesday.lines).toEqual(["Logan: Keep the canvas still."]);
    expect(week.days[0]!.hours.DIR![0]).toBe(1);
    expect(week.days[7]!.changes).toBe(1);
    expect(week.days[1]).toMatchObject({ changes: 0, head: "", lines: [] });
    expect(week.lead).toEqual(["Flyd", "Bloom", "DIR"]);
  });

  it("puts Flyd first among the week's three busiest", () => {
    const changes = ["Logan", "Logan", "Logan", "DIR", "DIR", "Flyd"].map((project, i) => ({ project, hash: String(i), at: at("2026-11-09", 10, i), subject: `change ${i}` }));
    expect(buildWeek(changes, NOW).lead).toEqual(["Flyd", "Logan", "DIR"]);
  });

  it("reads each live copy's git log once and keeps the week for ten minutes", async () => {
    const asked: string[] = [];
    let now = NOW;
    const reader = new WeekReader({
      registry: async () => "- flyd [x] - Flyd: a; live copy /r/flyd (added)",
      run: async (dir) => { asked.push(dir); return `abc\x1f${at("2026-11-10", 9) / 1000}\x1ffeat: one\nbad line\n`; },
      now: () => now,
    });
    expect((await reader.current())!.days[6]!.changes).toBe(1);
    now += 60_000;
    await reader.current();
    expect(asked).toEqual(["/r/flyd"]);
    expect(parseLog("Flyd", "x\x1fnope\x1fs")).toEqual([]);
  });

  it("has no week without a registry", async () => {
    expect(await new WeekReader({ registry: async () => "", run: async () => "" }).current()).toBeNull();
  });
});
