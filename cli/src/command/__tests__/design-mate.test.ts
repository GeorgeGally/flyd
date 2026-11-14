import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, uptime } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CREATIVE_DIRECTOR, DESIGN_MATE, MAX_ROUNDS, MAX_SENDBACKS, answerFromBoard, buildPrompt, flydReviewPrompt, dispatchDesignMate, driveDesignRun, labDir, pageOf, readBuild, readLab, startDesignRun, writeLab, toldInChat, type DesignMateDeps } from "../design-mate.js";
import { DesignModelError } from "../design-claude.js";
import { DESIGN_LAB_DONE_WHEN, designStartLine, isDesignLabRun, labAwaitingReview } from "../design.js";
import { dispatchDomainFollowup } from "../followup.js";
import { dueReport } from "../report.js";
import { notifyRun } from "../scheduler.js";
import { listDomainRuns, readDomainRun, saveDomainRun } from "../store.js";
import type { DomainRun } from "../types.js";

let home: string;
let labs: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "flyd-design-mate-"));
  labs = join(home, "labs");
  process.env.FLYD_COMMAND_DIR = join(home, "command");
  process.env.FLYD_SKILLS_DIR = join(home, "skills");
});

afterEach(() => {
  delete process.env.FLYD_COMMAND_DIR;
  delete process.env.FLYD_SKILLS_DIR;
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
    board: async (input) => {
      calls.push(`board:${input.versions.map((version) => `V${version.n}`).join(",")}`);
      return { url: "http://127.0.0.1:4747/board/labboard01", key: "labboard01", dir: join(input.labDir, "board") };
    },
  };
}

const LIMIT = new DesignModelError("limit", "your Claude plan has hit its usage limit; it resets 9pm");

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

  it("replays a request id it already has: the run on record, no second lab", () => {
    const input = { originalMessage: "do a lab for the right column", intendedOutcome: "Right column lab", doneWhen: ["five versions"], requestId: "lab-replay-1" };
    const first = dispatchDesignMate(input, labs);
    const again = dispatchDesignMate({ ...input, intendedOutcome: "Something else" }, labs);
    expect(again).toEqual(first);
    expect(readdirSync(labs)).toEqual(["lab-replay-1"]);
    expect(() => dispatchDesignMate({ ...input, requestId: "../escape" }, labs)).toThrow(/request id/);
  });

  it("refuses to start without done_when", () => {
    expect(() => dispatchDesignMate({ originalMessage: "a lab", intendedOutcome: "a lab", doneWhen: [] }, labs)).toThrow(/done_when/);
  });

  it("briefs, builds, shoots and has a critic who sees only the screenshots, then hands over a lab whose files exist", async () => {
    const calls: string[] = [];
    const done = await driveDesignRun(start(), staff([9, 10, 9], calls));
    expect(done.status).toBe("completed");
    expect(calls).toEqual(["brief", "build", "build", "build", "critique:2", "critique:2", "critique:2", "present:3", "flyd", "board:V1,V2,V3"]);
    const artifacts = done.result!.artifacts;
    expect(artifacts[0]).toBe("http://127.0.0.1:4747/board/labboard01");
    expect(artifacts[1]).toMatch(/index\.html$/);
    expect(artifacts.filter((path) => path.endsWith(".png"))).toHaveLength(6);
    for (const path of artifacts.slice(1)) expect(existsSync(path)).toBe(true);
    expect(readFileSync(join(labDir(done.id, labs), "v1.html"), "utf8")).toBe(PAGE);
    expect(done.result!.brief).toContain("Creative Director's pick: V2 · Wall label at 10/10");
    expect(readFileSync(artifacts[1]!, "utf8")).toContain("Wall label is the one");
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
    expect(readLab(done.id, labs)!.log.join("\n")).toMatch(/still had notes after 2 send-backs/);
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

  it("carries ux-psychology into every designer and Creative Director prompt", async () => {
    const prompts: Record<string, string[]> = { brief: [], build: [], critique: [], presentation: [], make: [], review: [] };
    const deps = staff([9]);
    await driveDesignRun(start(), {
      ...deps,
      complete: async (prompt, options) => {
        const role = prompt.includes("has brought you his brief") ? "brief" : prompt.includes("You are a designer") ? "build" : prompt.includes("judging one of the versions") ? "critique" : prompt.includes("The lab is finished") ? "presentation" : "";
        if (role) prompts[role]!.push(prompt);
        return deps.complete(prompt, options);
      },
    });
    let made = false;
    const build = dispatchDesignMate({ originalMessage: "build V2", intendedOutcome: "Build Wall label", doneWhen: ["header matches V2"], project: { root: join(home, "project") }, build: { reference: { page: "/lab/v2.html", name: "Wall label" } } }, labs);
    await driveDesignRun(build, {
      ...deps,
      complete: async (prompt) => {
        if (prompt.startsWith("You are Flyd")) return JSON.stringify({ verdict: "accept", notes: [] });
        prompts.review!.push(prompt);
        return JSON.stringify({ score: 9, critique: "Clean.", presentation: "Done." });
      },
      make: async (_cwd, prompt) => { prompts.make!.push(prompt); made = true; return "Changed the header."; },
      git: async (_cwd, args) => args[0] === "status" ? (made ? " M src/header.tsx\n" : "") : args[0] === "rev-parse" ? "abc1234\n" : "",
    });
    for (const [role, sent] of Object.entries(prompts)) {
      expect(sent.length, role).toBeGreaterThan(0);
      for (const prompt of sent) {
        expect(prompt, role).toContain("SKILL: ux-psychology");
        expect(prompt, role).toContain("Smart defaults");
        expect(prompt, role).toContain("Any guardrail broken?");
      }
    }
    expect(prompts.critique![0]).toContain("Judge the work against every one of them, their checklists and guardrails included");
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

  it("lands the finished lab on a board George reviews from, with the Creative Director's words beside the frames", async () => {
    const boards: Array<{ name: string; versions: number[]; note?: string }> = [];
    const done = await driveDesignRun(start(), { ...staff([9]), board: async (input) => {
      boards.push({ name: input.name, versions: input.versions.map((version) => version.n), ...(input.note ? { note: input.note } : {}) });
      return { url: "http://127.0.0.1:4747/board/labboard02", key: "labboard02", dir: join(input.labDir, "board") };
    } });
    expect(done.status).toBe("completed");
    expect(boards).toEqual([{ name: "Right column lab", versions: [1, 2, 3], note: "I'd take V2 · Wall label forward.\n- V1 · Title card: Big type.\n- V2 · Wall label: A framed piece.\n- V3 · Departure board: A dark board.\nPin notes for another round, or mark one as final to settle on it." }]);
    expect(readLab(done.id, labs)!.board).toMatchObject({ key: "labboard02" });
    expect(done.result!.brief).toContain("On the board: http://127.0.0.1:4747/board/labboard02");
    expect(done.result!.evidence).toEqual(["board http://127.0.0.1:4747/board/labboard02"]);
  });

  it("still hands the lab over when the board cannot be opened, and says so", async () => {
    const done = await driveDesignRun(start(), { ...staff([9]), board: async () => { throw new Error("Liesel did not start"); } });
    expect(done.status).toBe("completed");
    expect(done.result!.risks.join(" ")).toContain("It could not be put on a board: Liesel did not start.");
    expect(done.result!.artifacts[0]).toMatch(/index\.html$/);
  });

  it("stops at once on a plan limit, without retrying, and says why in plain words", async () => {
    const calls: string[] = [];
    const done = await driveDesignRun(start(), { ...staff([9]), complete: async () => { calls.push("call"); throw LIMIT; } });
    expect(calls).toEqual(["call"]);
    expect(done.status).toBe("failed");
    expect(done.failure).toBe("The design lab stopped before it was ready: your Claude plan has hit its usage limit; it resets 9pm.");
  });

  it("stops the whole lab on a plan limit mid-build instead of dropping every direction", async () => {
    const deps = staff([9]);
    const done = await driveDesignRun(start(), { ...deps, complete: async (prompt, options) => {
      if (prompt.startsWith("You are a designer")) throw LIMIT;
      return deps.complete(prompt, options);
    } });
    expect(done.status).toBe("failed");
    expect(done.failure).toMatch(/usage limit; it resets 9pm\.$/);
    expect(readLab(done.id, labs)!.dropped).toBeUndefined();
  });

  it("says a lab started only once its model answered, and that it failed when it stopped at once", async () => {
    const started = await startDesignRun(start(), { deps: staff([9]), waitMs: 5_000, pollMs: 5 });
    expect(started.state).toBe("started");
    expect(readDomainRun(started.run.id)!.startedAt).toBeTruthy();
    expect(designStartLine(started)).toMatch(/^Design lab started \(run lab-/);

    const failed = await startDesignRun(start(), { deps: { ...staff([9]), complete: async () => { throw LIMIT; } }, waitMs: 5_000, pollMs: 5 });
    expect(failed.state).toBe("failed");
    expect(readDomainRun(failed.run.id)!.startedAt).toBeUndefined();
    const line = designStartLine(failed);
    expect(line).toMatch(/^Error: the design lab did not start\./);
    expect(line).toContain("usage limit");

    // Told in the chat that started it, so no notification says it again.
    expect(readDomainRun(failed.run.id)!.report?.state).toBe("due");
    toldInChat(failed.run.id);
    expect(readDomainRun(failed.run.id)!.report?.state).toBe("quiet");

    const waiting = await startDesignRun(start(), { deps: { ...staff([9]), complete: () => new Promise<string>(() => undefined) }, waitMs: 20, pollMs: 5 });
    expect(waiting.state).toBe("waiting");
    expect(designStartLine(waiting)).toMatch(/^Design lab queued .*not that it has started/);
  });

  it("tells George a stopped lab right away, in its own plain words, never sending it back to the team", async () => {
    const run = start();
    const failure = "The design lab stopped before it was ready: your Claude plan has hit its usage limit; it resets 9pm.";
    saveDomainRun({ ...readDomainRun(run.id)!, status: "failed", phase: "done", failure, report: dueReport("failed", new Date().toISOString()) });
    const said: string[] = [];
    let reviewed = false;
    await notifyRun(readDomainRun(run.id)!, async (_title, message) => { said.push(message); }, undefined, async () => { reviewed = true; throw new Error("not reviewed"); }, () => false, async () => { throw new Error("no focus"); });
    expect(reviewed).toBe(false);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("usage limit");
    expect(readDomainRun(run.id)!.report).toMatchObject({ state: "shown" });

    // A stop from days ago is old news: recorded, never rung.
    const old = start();
    saveDomainRun({ ...readDomainRun(old.id)!, status: "failed", phase: "done", failure, report: dueReport("failed", "2026-11-01T00:00:00.000Z") });
    await notifyRun(readDomainRun(old.id)!, async (_title, message) => { said.push(message); }, undefined, undefined, () => false, async () => { throw new Error("no focus"); });
    expect(said).toHaveLength(1);
    expect(readDomainRun(old.id)!.report?.state).toBe("quiet");
  });

  it("keeps a second runner off a lab another live process is stepping", async () => {
    const run = start();
    const boot = Math.round((Date.now() - uptime() * 1000) / 60_000);
    const lock = join(labDir(run.id, labs), "runner.lock");
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, boot, at: new Date().toISOString() }));
    const calls: string[] = [];
    const after = await driveDesignRun(run, staff([9], calls));
    expect(calls).toEqual([]);
    expect(after.phase).toBe("briefing");

    // The same pid from before this Mac restarted is someone else now: the lock is taken over.
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, boot: boot - 600, at: new Date().toISOString() }));
    expect((await driveDesignRun(run, staff([9]))).status).toBe("completed");
  });

  it("fails the run, rather than losing the request, when its folder cannot be made", () => {
    writeFileSync(labs, "not a folder");
    const run = dispatchDesignMate({ originalMessage: "a lab", intendedOutcome: "A lab", doneWhen: ["three versions"] }, labs);
    expect(readDomainRun(run.id)).toMatchObject({ status: "failed", report: { state: "due" } });
    expect(run.failure).toMatch(/^The design lab stopped before it was ready: its folder could not be made/);
  });

  it("builds the version George marks final on the board, and takes notes alone into another round", async () => {
    const project = join(home, "project");
    const previous = process.env.FLYD_LABS_DIR;
    process.env.FLYD_LABS_DIR = labs;
    try {
      const lab = await driveDesignRun(dispatchDesignMate({ originalMessage: "do a lab", intendedOutcome: "Right column lab", doneWhen: ["three versions"], project: { root: project } }, labs), staff([9]));
      const built = await answerFromBoard(lab, { final: 2, notes: ["V2 · Wall label: tighter headline"], ids: ["p1"] });
      expect(built).toBe("Building V2 · Wall label into the project now. You'll hear when it's in.");
      const build = listDomainRuns().find((run) => run.request.parentRequestId === lab.id && readBuild(run.id, labs))!;
      expect(build.request.originalMessage).toContain("Build V2 · Wall label.");
      expect(build.request.originalMessage).toContain("tighter headline");
      // The same board message again is the same run, not a second build.
      await answerFromBoard(lab, { final: 2, notes: ["V2 · Wall label: tighter headline"], ids: ["p1"] });
      expect(listDomainRuns().filter((run) => run.request.parentRequestId === lab.id)).toHaveLength(1);

      // Notes that name a version are still notes: another round, never a build.
      const round = await answerFromBoard(lab, { notes: ["V2 · Wall label: build the header bigger"], ids: ["p2"] });
      expect(round).toMatch(/another round/);
      const next = listDomainRuns().find((run) => run.request.parentRequestId === lab.id && run.request.originalMessage.includes("bigger"))!;
      expect(readBuild(next.id, labs)).toBeNull();
      expect(next.phase).toBe("briefing");

      // A lab with no project to build into keeps his pick and says so, starting nothing.
      const loose = await driveDesignRun(start(), staff([9]));
      const before = listDomainRuns().length;
      expect(await answerFromBoard(loose, { final: 3, notes: [], ids: ["p3"] })).toMatch(/^Marked V3 · Departure board as the one\. This lab has no project/);
      expect(listDomainRuns()).toHaveLength(before);
      expect(readLab(loose.id, labs)!.picked).toBe(3);

      // Notes alone are another round, even from a project with a pick waiting.
      const noted = await dispatchDomainFollowup({ parentRunId: loose.id, question: "try a warmer palette", project: { root: project } }) as DomainRun;
      expect(readBuild(noted.id, labs)).toBeNull();
      expect(noted.phase).toBe("briefing");
      expect(noted.request.project).toBeUndefined();
      expect(readLab(loose.id, labs)!.picked).toBe(3);
      const darker = await dispatchDomainFollowup({ parentRunId: loose.id, question: "use a darker background", project: { root: project } }) as DomainRun;
      expect(readBuild(darker.id, labs)).toBeNull();
      expect(darker.phase).toBe("briefing");
      expect(darker.request.project).toBeUndefined();
      expect(readLab(loose.id, labs)!.picked).toBe(3);
      for (const note of ["use that blue on the buttons", "use this font for headings", "go with that colour", "use 2 columns on mobile", "take 3 more stabs at the hero", "build 3 more versions", "go with 2 columns on mobile", "pick 2 colours from the photo"]) {
        const round = await dispatchDomainFollowup({ parentRunId: loose.id, question: note, project: { root: project } }) as DomainRun;
        expect(readBuild(round.id, labs)).toBeNull();
        expect(round.phase).toBe("briefing");
        expect(round.request.project).toBeUndefined();
        expect(readLab(loose.id, labs)!.picked).toBe(3);
      }

      // Saying where later builds that pick, even when his words name no version; with nowhere to build, it is another round.
      const nowhere = await dispatchDomainFollowup({ parentRunId: loose.id, question: "build it into the site" }) as DomainRun;
      expect(readBuild(nowhere.id, labs)).toBeNull();
      expect(nowhere.phase).toBe("briefing");
      const placed = await dispatchDomainFollowup({ parentRunId: loose.id, question: "build it into the site", project: { root: project } }) as DomainRun;
      expect(placed.request.project?.root).toBe(project);
      expect(readBuild(placed.id, labs)?.reference?.name).toBe("Departure board");
      // The pick builds once: later notes are another round, not the old pick again.
      expect(readLab(loose.id, labs)!.picked).toBeUndefined();
      writeLab(loose.id, { ...readLab(loose.id, labs)!, picked: 3 }, labs);
      const theOne = await dispatchDomainFollowup({ parentRunId: loose.id, question: "go with the one.", project: { root: project } }) as DomainRun;
      expect(readBuild(theOne.id, labs)?.reference?.name).toBe("Departure board");
      expect(readLab(loose.id, labs)!.picked).toBeUndefined();
      const later = await dispatchDomainFollowup({ parentRunId: loose.id, question: "make the type bigger", project: { root: project } }) as DomainRun;
      expect(readBuild(later.id, labs)).toBeNull();
      expect(later.phase).toBe("briefing");

      // A project but no pick is still another round.
      const unpicked = await driveDesignRun(start(), staff([9]));
      const another = await dispatchDomainFollowup({ parentRunId: unpicked.id, question: "build it into the site", project: { root: project } }) as DomainRun;
      expect(readBuild(another.id, labs)).toBeNull();
      expect(another.phase).toBe("briefing");

      // A count after the verb is a note, even on a lab with its own project; a bare version number is a build.
      for (const note of ["build 3 more", "build 3 more versions", "go with 2 columns on mobile", "pick 2 colours from the photo"]) {
        const round = await dispatchDomainFollowup({ parentRunId: lab.id, question: note }) as DomainRun;
        expect(readBuild(round.id, labs)).toBeNull();
        expect(round.phase).toBe("briefing");
      }
      const three = await dispatchDomainFollowup({ parentRunId: unpicked.id, question: "go with 3.", project: { root: project } }) as DomainRun;
      expect(readBuild(three.id, labs)?.reference?.name).toBe("Departure board");
      const two = await dispatchDomainFollowup({ parentRunId: unpicked.id, question: "build 2 into ~/site", project: { root: project } }) as DomainRun;
      expect(readBuild(two.id, labs)?.reference?.name).toBe("Wall label");
    } finally {
      if (previous === undefined) delete process.env.FLYD_LABS_DIR;
      else process.env.FLYD_LABS_DIR = previous;
    }
  });

  it("leaves the presenting to the board: designers build only the page, and Flyd's review never asks them for board controls or file lists", () => {
    const run = dispatchDesignMate({ originalMessage: "a lab", intendedOutcome: "A lab", doneWhen: ["three versions", ...DESIGN_LAB_DONE_WHEN] }, labs);
    const page = buildPrompt(run, { brief: "b", versions: [], round: 1, images: [], log: [] }, { n: 1, name: "Title card", idea: "Big type.", seed: "ab" }, "(none)");
    expect(page).toContain("never add a version label, a lab caption, a 'Mark as final' control");
    const review = flydReviewPrompt(run, "V1 is the one.", "(none)", "A lab of 3 versions");
    expect(review).toContain("Done when: three versions\n");
    expect(review).not.toContain("listed in artifacts");
    expect(review).toContain("Never ask the designers for those board features");
  });
});
