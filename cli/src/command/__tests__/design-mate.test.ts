import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CREATIVE_DIRECTOR, DESIGN_MATE, MAX_ROUNDS, MAX_SENDBACKS, designChain, dispatchDesignMate, driveDesignRun, labDir, pageOf, readBuild, readLab, type DesignMateDeps } from "../design-mate.js";
import { claudeChatModel } from "../../lib/config.js";
import { isDesignLabRun, labAwaitingReview } from "../design.js";
import { readDomainRun } from "../store.js";

let home: string;
let labs: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-design-mate-"));
  labs = join(home, "labs");
  process.env.FLYD_COMMAND_DIR = join(home, "command");
});

afterEach(() => {
  delete process.env.FLYD_COMMAND_DIR;
  rmSync(home, { recursive: true, force: true });
});

const PAGE = "<!doctype html><html><body><h1>V</h1></body></html>";

/** Staff that answer by role: the brief, a page, a critique with the given scores in turn, the presentation, then Flyd's verdicts in turn. */
function staff(scores: number[], calls: string[] = [], verdicts: Array<{ verdict: string; notes?: string[]; versions?: number[] }> = []): DesignMateDeps {
  let critique = 0;
  let verdict = 0;
  return {
    root: labs,
    complete: async (prompt, options) => {
      if (prompt.startsWith("You are Flyd")) {
        calls.push("flyd");
        return JSON.stringify(verdicts[verdict++] ?? { verdict: "accept", notes: [] });
      }
      if (prompt.includes("The lab is finished")) {
        calls.push(`present:${options?.images?.length ?? 0}`);
        return JSON.stringify({ pick: 2, presentation: "Wall label is the one: it says what Flyd is." });
      }
      if (prompt.includes("has brought you his brief")) {
        calls.push("brief");
        return JSON.stringify({ brief: "A right column for a CEO.", versions: [{ name: "Title card", idea: "Big type." }, { name: "Wall label", idea: "A framed piece." }, { name: "Departure board", idea: "A dark board." }] });
      }
      if (prompt.includes("You are a designer")) {
        calls.push(prompt.includes("The Creative Director scored your last build") ? "rebuild" : "build");
        return "Here it is:\n```html\n" + PAGE + "\n```";
      }
      calls.push(`critique:${options?.images?.length ?? 0}`);
      return JSON.stringify({ score: scores[critique++ % scores.length], critique: "Delete the second label." });
    },
    shoot: async (_page, png) => { writeFileSync(png, "png"); },
  };
}

function start() {
  return dispatchDesignMate({ originalMessage: "do a lab for the right column", intendedOutcome: "Right column lab", doneWhen: ["five versions"] }, labs);
}

describe("Design Mate", () => {
  it("owns the lab itself: its own run, owner and folder, never the coding boss", () => {
    const run = start();
    expect(run.owner).toBe(DESIGN_MATE);
    expect(run.request.domain).toBe("creative");
    expect(run.transport.kind).toBe("native");
    expect(existsSync(labDir(run.id, labs))).toBe(true);
    expect(isDesignLabRun(run)).toBe(true);
  });

  it("refuses to start without done_when", () => {
    expect(() => dispatchDesignMate({ originalMessage: "a lab", intendedOutcome: "a lab", doneWhen: [] }, labs)).toThrow(/done_when/);
  });

  it("briefs, builds, shoots and has a critic who sees only the screenshots, then hands over a lab whose files exist", async () => {
    const calls: string[] = [];
    const done = await driveDesignRun(start(), staff([9, 10, 9], calls));
    expect(done.status).toBe("completed");
    expect(calls).toEqual(["brief", "build", "build", "build", "critique:2", "critique:2", "critique:2", "present:3", "flyd"]);
    const artifacts = done.result!.artifacts;
    expect(artifacts[0]).toMatch(/index\.html$/);
    expect(artifacts.filter((path) => path.endsWith(".png"))).toHaveLength(6);
    for (const path of artifacts) expect(existsSync(path)).toBe(true);
    expect(readFileSync(join(labDir(done.id, labs), "v1.html"), "utf8")).toBe(PAGE);
    expect(done.result!.brief).toContain("Creative Director's pick: V2 · Wall label at 10/10");
    expect(readFileSync(artifacts[0]!, "utf8")).toContain("Wall label is the one");
    expect(labAwaitingReview(done, [done])).toBe(true);
  });

  it("rebuilds only versions under 9, and stops after three rounds with what fell short", async () => {
    const calls: string[] = [];
    const done = await driveDesignRun(start(), staff([6, 9, 9, 7, 8], calls));
    expect(done.status).toBe("completed");
    expect(readLab(done.id, labs)!.round).toBe(MAX_ROUNDS);
    expect(calls.filter((call) => call === "rebuild")).toHaveLength(2);
    expect(done.result!.risks[0]).toMatch(/Still under 9\/10: V1 \(8\)/);
  });

  it("is not done when a screenshot is missing", async () => {
    const deps = staff([9]);
    const done = await driveDesignRun(start(), { ...deps, shoot: async (_page, png) => { if (!png.includes("v2-")) writeFileSync(png, "png"); } });
    expect(done.status).toBe("failed");
    expect(done.failure).toMatch(/No screenshots of V2/);
  });

  it("fails plainly when the brief has too few directions", async () => {
    const run = start();
    const done = await driveDesignRun(run, { ...staff([9]), complete: async () => JSON.stringify({ brief: "x", versions: [{ name: "One", idea: "Only one." }] }) });
    expect(done.status).toBe("failed");
    expect(readDomainRun(run.id)!.failure).toMatch(/enough directions/);
  });

  it("takes only the HTML document out of a designer's reply", () => {
    expect(pageOf("Sure!\n```html\n<!doctype html><html></html>\n```\nDone.")).toBe("<!doctype html><html></html>");
    expect(pageOf("no page here")).toBeNull();
  });

  it("goes to George only once Flyd accepts: changes rebuild the version Flyd names", async () => {
    const calls: string[] = [];
    const done = await driveDesignRun(start(), staff([9], calls, [{ verdict: "changes", notes: ["Make the headline say what Flyd is."], versions: [3] }]));
    expect(done.status).toBe("completed");
    expect(calls.filter((call) => call === "flyd")).toHaveLength(2);
    expect(calls.slice(calls.indexOf("flyd") + 1, calls.indexOf("flyd") + 2)).toEqual(["rebuild"]);
    expect(readLab(done.id, labs)!.flydNotes).toEqual(["Make the headline say what Flyd is."]);
  });

  it("starts the directions again when Flyd rejects them", async () => {
    const calls: string[] = [];
    const done = await driveDesignRun(start(), staff([9], calls, [{ verdict: "reject", notes: ["Too safe; go warmer and bolder."] }]));
    expect(done.status).toBe("completed");
    expect(calls.filter((call) => call === "brief")).toHaveLength(2);
  });

  it("stops sending back after the limit and names Flyd's open notes", async () => {
    const no = { verdict: "changes", notes: ["Still off."] };
    const done = await driveDesignRun(start(), staff([9], [], Array(MAX_SENDBACKS + 1).fill(no)));
    expect(done.status).toBe("completed");
    expect(readLab(done.id, labs)!.sendbacks).toBe(MAX_SENDBACKS);
    expect(readLab(done.id, labs)!.log.at(-1)).toMatch(/still had notes/);
  });

  it("builds for real: the designer edits the project, the Creative Director reviews, Flyd accepts, Design Mate commits only what it made", async () => {
    const project = join(home, "project");
    const gitCalls: string[][] = [];
    let made = false;
    const deps: DesignMateDeps = {
      ...staff([9]),
      complete: async (prompt) => prompt.startsWith("You are Flyd")
        ? JSON.stringify({ verdict: "accept", notes: [] })
        : JSON.stringify({ score: 9, critique: "Clean.", presentation: "The header now matches V2." }),
      make: async (cwd, prompt) => { expect(cwd).toBe(project); expect(prompt).toContain("Wall label"); made = true; return "Changed the header."; },
      git: async (_cwd, args) => {
        gitCalls.push(args);
        if (args[0] === "status") return made ? " M notes.md\n M src/header.tsx\n" : " M notes.md\n";
        if (args[0] === "rev-parse") return "abc1234\n";
        return "";
      },
    };
    const run = dispatchDesignMate({ originalMessage: "build V2", intendedOutcome: "Build Wall label", doneWhen: ["header matches V2"], project: { root: project }, build: { reference: { page: "/lab/v2.html", name: "Wall label" } } }, labs);
    expect(run.phase).toBe("making");
    const done = await driveDesignRun(run, deps);
    expect(done.status).toBe("completed");
    expect(readBuild(done.id, labs)!.dirtyBefore).toEqual(["notes.md"]);
    expect(gitCalls.find((args) => args[0] === "commit")).toContain("src/header.tsx");
    expect(gitCalls.find((args) => args[0] === "commit")).not.toContain("notes.md");
    expect(done.result!.brief).toBe("The header now matches V2.");
    expect(done.result!.specialistOutputs[0]!.specialist).toBe(CREATIVE_DIRECTOR);
  });

  it("refuses a build without the project it changes", () => {
    expect(() => dispatchDesignMate({ originalMessage: "build", intendedOutcome: "build", doneWhen: ["x"], build: {} }, labs)).toThrow(/project folder/);
  });

  it("shows the team what exists today: the current screenshots go to the brief and the real content to every designer", async () => {
    const shot = join(home, "now.png");
    writeFileSync(shot, "png");
    const seen: Array<{ prompt: string; images: number }> = [];
    const deps = staff([9]);
    const run = dispatchDesignMate({ originalMessage: "redo the dashboard", intendedOutcome: "Dashboard lab", doneWhen: ["five versions"], context: { shots: [shot], content: "Deals: 12 open" } }, labs);
    await driveDesignRun(run, { ...deps, complete: async (prompt, options) => { seen.push({ prompt, images: options?.images?.length ?? 0 }); return deps.complete(prompt, options); } });
    const brief = seen.find((call) => call.prompt.includes("has brought you his brief"))!;
    expect(brief.images).toBe(1);
    expect(brief.prompt).toContain("Deals: 12 open");
    expect(seen.filter((call) => call.prompt.startsWith("You are a designer")).every((call) => call.prompt.includes("Deals: 12 open"))).toBe(true);
  });

  it("clears the rejected lab's pages before building the new directions", async () => {
    const pages: string[][] = [];
    const deps = staff([9], [], [{ verdict: "reject", notes: ["Wrong direction."] }]);
    const run = start();
    await driveDesignRun(run, { ...deps, complete: async (prompt, options) => {
      if (prompt.includes("has brought you his brief")) pages.push(readdirSync(labDir(run.id, labs)).filter((name) => /^v\d+\.html$/.test(name)));
      return deps.complete(prompt, options);
    } });
    expect(pages).toEqual([[], []]);
  });

  it("retries a dropped connection instead of sinking the lab", async () => {
    const deps = staff([9]);
    let failed = 0;
    const done = await driveDesignRun(start(), { ...deps, complete: async (prompt, options) => {
      if (prompt.startsWith("You are a designer") && failed++ < 2) throw new TypeError("fetch failed");
      return deps.complete(prompt, options);
    } });
    expect(done.status).toBe("completed");
  });

  it("asks again for a shorter page when a version comes back cut off", async () => {
    const deps = staff([9]);
    const prompts: string[] = [];
    const done = await driveDesignRun(start(), { ...deps, complete: async (prompt, options) => {
      if (prompt.startsWith("You are a designer") && prompt.includes("Departure board")) {
        prompts.push(prompt);
        if (prompts.length === 1) return "```html\n<!doctype html><html><body><table>";
      }
      return deps.complete(prompt, options);
    } });
    expect(done.status).toBe("completed");
    expect(prompts[1]).toContain("cut off before </html>");
  });

  it("carries on without a direction that will not build while three remain", async () => {
    const deps = staff([9]);
    const run = start();
    const done = await driveDesignRun(run, { ...deps, complete: async (prompt, options) => {
      if (prompt.includes("has brought you his brief")) {
        return JSON.stringify({ brief: "A right column.", versions: ["Title card", "Wall label", "Departure board", "Terminal"].map((name) => ({ name, idea: "An idea." })) });
      }
      if (prompt.startsWith("You are a designer") && prompt.includes("Terminal")) throw new Error("socket hang up");
      return deps.complete(prompt, options);
    } });
    expect(done.status).toBe("completed");
    expect(readLab(run.id, labs)!.versions.map((version) => version.name)).toEqual(["Title card", "Wall label", "Departure board"]);
    expect(done.result!.risks.join(" ")).toMatch(/Left out: V4 · Terminal/);
  });

  it("stops plainly when too few directions would build", async () => {
    const deps = staff([9]);
    const done = await driveDesignRun(start(), { ...deps, complete: async (prompt, options) => {
      if (prompt.startsWith("You are a designer") && prompt.includes("Departure board")) throw new Error("socket hang up");
      return deps.complete(prompt, options);
    } });
    expect(done.status).toBe("failed");
    expect(done.failure).toMatch(/V3 · Departure board could not be built: socket hang up/);
  });

  it("judges on Claude, and builds on Claude only while under half the month's Claude cap", () => {
    if (!claudeChatModel()) return;
    expect(designChain("design-review", 0.9)?.[0]).toBe(claudeChatModel());
    expect(designChain("design", 0.2)?.[0]).toBe(claudeChatModel());
    expect(designChain("design", 0.5)).toBeUndefined();
  });
});
