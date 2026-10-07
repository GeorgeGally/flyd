import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "../projects.js";
import {
  applyObservations,
  isAgentSessionDir,
  learningPrompt,
  learnTaste,
  parseLearned,
  parseTaste,
  readSessionTurns,
  readTaste,
  renderTaste,
  resolveTasteProject,
  restoreRule,
  rewordRule,
  ruleId,
  tastePromptText,
  vetoRule,
  writeTaste,
  type CandidateTurn,
  type TasteProfile,
} from "../taste.js";

const project = (id: string, name: string, repos: string[] = []): Project =>
  ({ id, name, repos, what: "", kind: "client", status: "active", now: "" }) as unknown as Project;
const CAPFIVE = project("capfive-client-work", "Capfive client work", ["/Users/george/Documents/cap5"]);
const FLYD = project("flyd", "Flyd", ["/Users/george/Documents/flyd"]);
const PROJECTS = [CAPFIVE, FLYD];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "flyd-taste-"));
  process.env.FLYD_TASTE_FILE = join(dir, "TASTE.md");
  process.env.FLYD_TASTE_STATE = join(dir, "taste-state.json");
  process.env.FLYD_CLAUDE_PROJECTS = join(dir, "projects");
  process.env.FLYD_PROJECTS_PATH = join(dir, "projects.json");
  writeFileSync(process.env.FLYD_PROJECTS_PATH, JSON.stringify({ projects: PROJECTS }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const empty = (): TasteProfile => ({ rules: [], vetoed: [], names: {} });
const observe = (rule: string, scope: "personal" | "project", projectId?: string, date = "2026-10-06", quote = rule) =>
  ({ rule: { rule, scope, quote, ...(projectId ? { project: projectId } : {}) }, source: "Claude Code", date });

describe("TASTE.md", () => {
  it("round-trips rules, their homework, project sections and vetoes, and accepts rules George types himself", () => {
    const profile = empty();
    applyObservations(profile, [
      observe("No shadows on icon boxes.", "personal", undefined, "2026-10-05", "no shadows on the icon boxes"),
      observe("Phone gutter is 36px.", "project", "capfive-client-work"),
    ]);
    profile.names["capfive-client-work"] = "Capfive client work";
    profile.vetoed.push({ id: "deadbeef", text: "Loves gradients.", scope: "personal", count: 1, projects: [], evidence: [] });
    const markdown = renderTaste(profile);
    expect(markdown).toContain("## Everywhere");
    expect(markdown).toContain("## Capfive client work <!--project:capfive-client-work-->");
    expect(markdown).toContain('  - "no shadows on the icon boxes" — Claude Code, 2026-10-05');
    expect(parseTaste(markdown)).toEqual(profile);

    const edited = `${markdown.replace("## Capfive client work", "- Headlines on one line where they fit.\n\n## Capfive client work")}`;
    const parsed = parseTaste(edited);
    expect(parsed.rules.find((rule) => rule.text === "Headlines on one line where they fit.")).toMatchObject({ scope: "personal", count: 0, id: ruleId("Headlines on one line where they fit.") });
  });
});

describe("applyObservations", () => {
  it("strengthens a repeat instead of adding a duplicate, keeping the newest evidence", () => {
    const profile = empty();
    applyObservations(profile, [observe("One eyebrow style everywhere.", "personal", undefined, "2026-10-05", "same eyebrow everywhere")]);
    const result = applyObservations(profile, [
      observe("one eyebrow style everywhere", "personal", undefined, "2026-10-06", "why are the eyebrows different"),
      { ...observe("Eyebrows all match.", "personal", undefined, "2026-10-07", "eyebrows again"), rule: { rule: "Eyebrows all match.", scope: "personal" as const, quote: "eyebrows again", sameAs: profile.rules[0]!.id } },
    ]);
    expect(result).toMatchObject({ added: 0, strengthened: 2 });
    expect(profile.rules).toHaveLength(1);
    expect(profile.rules[0]).toMatchObject({ count: 3, first: "2026-10-05", last: "2026-10-07" });
    expect(profile.rules[0]!.evidence.map((item) => item.quote)).toEqual(["eyebrows again", "why are the eyebrows different", "same eyebrow everywhere"]);
  });

  it("promotes a project rule to Everywhere once it shows up in a second project", () => {
    const profile = empty();
    applyObservations(profile, [observe("Bold words turn blue.", "project", "capfive-client-work")]);
    expect(profile.rules[0]!.scope).toBe("capfive-client-work");
    const result = applyObservations(profile, [observe("Bold words turn blue.", "project", "flyd")]);
    expect(result.promoted).toBe(1);
    expect(profile.rules[0]).toMatchObject({ scope: "personal", projects: ["capfive-client-work", "flyd"], count: 2 });
  });

  it("never learns again what George vetoed", () => {
    const profile = empty();
    profile.vetoed.push({ id: ruleId("Loves gradients."), text: "Loves gradients.", scope: "personal", count: 1, projects: [], evidence: [] });
    expect(applyObservations(profile, [observe("loves gradients", "personal")])).toMatchObject({ added: 0, ignored: 1 });
    expect(profile.rules).toEqual([]);
  });

  it("does not re-learn a vetoed rule reworded from the same words", () => {
    const profile = empty();
    const text = "Never center body copy; use left-aligned paragraphs.";
    profile.vetoed.push({ id: ruleId(text), text, scope: "personal", count: 1, projects: [], evidence: [{ quote: "never centre body copy", source: "Claude Code", date: "2026-10-05" }] });
    const result = applyObservations(profile, [observe("Never center body copy; keep paragraphs left-aligned.", "personal", undefined, "2026-10-07", "never centre body copy, i hate centred paragraphs")]);
    expect(result).toMatchObject({ added: 0, ignored: 1 });
    expect(profile.rules).toEqual([]);
  });

  it("shows the model the vetoed rules so it can point same_as at them", () => {
    const profile = empty();
    const text = "Never center body copy; use left-aligned paragraphs.";
    profile.vetoed.push({ id: ruleId(text), text, scope: "personal", count: 1, projects: [], evidence: [] });
    const turn: CandidateTurn = { id: "u1", text: "never centre body copy", context: "", date: "2026-10-07" };
    expect(learningPrompt([turn], profile, PROJECTS)).toContain(`[${ruleId(text)}] ${text}`);
    const learned = parseLearned(JSON.stringify({ rules: [{ turn: 1, rule: "Keep paragraphs left-aligned.", scope: "personal", quote: "never centre body copy", same_as: ruleId(text) }] }), [turn], profile, PROJECTS);
    expect(applyObservations(profile, learned.map((rule) => ({ rule, source: "Claude Code", date: "2026-10-07" })))).toMatchObject({ added: 0, ignored: 1 });
  });
});

describe("parseLearned", () => {
  const turn: CandidateTurn = {
    id: "u1",
    text: "no, i hate the azure. lifted navy is better\n\n```\n.card { box-shadow: 0 0 4px }\n```",
    context: "I made the cards azure and added a soft shadow, which I prefer.",
    date: "2026-10-06",
    project: "capfive-client-work",
  };

  it("keeps only rules whose quote is George's own prose, placed in a known project", () => {
    const output = JSON.stringify({ rules: [
      { turn: 1, rule: "Prefer lifted navy cards to azure.", scope: "project", project: "capfive-client-work", quote: "i hate the azure. lifted navy is better" },
      { turn: 1, rule: "Soft shadows on cards.", scope: "personal", quote: "which I prefer" },
      { turn: 1, rule: "Cards get a box shadow.", scope: "personal", quote: ".card { box-shadow: 0 0 4px }" },
      { turn: 1, rule: "Navy everywhere.", scope: "project", project: "unknown-project", quote: "lifted navy is better" },
      { turn: 2, rule: "Ghost turn.", scope: "personal", quote: "no" },
    ] });
    const learned = parseLearned(output, [turn], empty(), PROJECTS);
    expect(learned.map((item) => item.rule)).toEqual(["Prefer lifted navy cards to azure.", "Navy everywhere."]);
    // An unknown project id falls back to the session's own project.
    expect(learned[1]!.project).toBe("capfive-client-work");
    expect(parseLearned("not json", [turn], empty(), PROJECTS)).toEqual([]);
  });

  it("drops a project rule it cannot place", () => {
    const loose = { ...turn, project: undefined };
    const output = JSON.stringify({ rules: [{ turn: 1, rule: "Navy cards.", scope: "project", project: null, quote: "lifted navy is better" }] });
    expect(parseLearned(output, [loose], empty(), PROJECTS)).toEqual([]);
  });
});

describe("using it", () => {
  it("gives agents personal taste plus the rules of the project in play, strongest first", () => {
    const profile = empty();
    applyObservations(profile, [
      observe("Inconsistency is the biggest red flag.", "personal"),
      observe("Inconsistency is the biggest red flag.", "personal"),
      observe("Minimal screens.", "personal"),
      observe("Phone gutter is 36px.", "project", "capfive-client-work"),
      observe("Use the Flyd voice.", "project", "flyd"),
    ]);
    profile.names["capfive-client-work"] = "Capfive client work";
    const text = tastePromptText({ profile, projects: ["capfive-client-work"] })!;
    expect(text).toContain("Everywhere:\n- Inconsistency is the biggest red flag.\n- Minimal screens.");
    expect(text).toContain("Capfive client work:\n- Phone gutter is 36px.");
    expect(text).not.toContain("Flyd voice");
    expect(tastePromptText({ profile: empty() })).toBeNull();
  });

  it("finds the project from a repo path, an id or a name", () => {
    expect(resolveTasteProject("/Users/george/Documents/cap5/wp-content/themes", PROJECTS)).toBe("capfive-client-work");
    expect(resolveTasteProject("project:capfive", PROJECTS)).toBe("capfive-client-work");
    expect(resolveTasteProject("flyd", PROJECTS)).toBe("flyd");
    expect(resolveTasteProject("/tmp/elsewhere", PROJECTS)).toBeUndefined();
  });

  it("rewords, vetoes and restores a rule in the file George can edit", () => {
    const profile = empty();
    applyObservations(profile, [observe("Phone gutter is 36px.", "project", "capfive-client-work")]);
    writeTaste(profile);
    const id = profile.rules[0]!.id;
    expect(rewordRule(id, "Phone gutter is exactly 36px.")).toBe(true);
    expect(vetoRule(id)).toBe(true);
    expect(readFileSync(process.env.FLYD_TASTE_FILE!, "utf8")).toMatch(/## Not me\n\n- Phone gutter is exactly 36px\./);
    expect(restoreRule(id)).toBe(true);
    expect(readTaste().rules[0]).toMatchObject({ id, scope: "capfive-client-work", text: "Phone gutter is exactly 36px." });
    expect(vetoRule("nope")).toBe(false);
  });
});

describe("learning from Claude Code sessions", () => {
  let at = Date.parse("2026-10-06T09:00:00Z");
  const entry = (type: string, body: Record<string, unknown>, cwd = "/Users/george/Documents/cap5") =>
    JSON.stringify({ type, uuid: `id-${(at += 1000)}`, timestamp: new Date(at).toISOString(), isSidechain: false, cwd, ...body });
  const said = (text: string, cwd?: string) => entry("user", { message: { role: "user", content: text }, origin: { kind: "human" } }, cwd);
  const reply = (text: string, cwd?: string) => entry("assistant", { message: { role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }], stop_reason: "end_turn" } }, cwd);
  const toolOutput = (text: string) => entry("user", { message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: text }] } });

  function session(folder: string, name: string, lines: string[]): string {
    mkdirSync(join(dir, "projects", folder), { recursive: true });
    const path = join(dir, "projects", folder, name);
    writeFileSync(path, `${lines.join("\n")}\n`);
    return path;
  }

  it("learns from George's own turns only, once, and skips agent sessions", async () => {
    const file = session("-Users-george-Documents-cap5", "s1.jsonl", [
      said("make the cards azure"),
      reply("Done: the cards are azure with a soft shadow, which I prefer."),
      toolOutput("I always prefer shadows everywhere"),
      said("no, no shadows on the icon boxes. it looks inconsistent"),
      reply("Removed."),
      said("commit it"),
    ]);
    session("-Users-george--treehouse-flyd-1-flyd", "crew.jsonl", [said("no shadows ever, it looks wrong")]);
    session("-Users-george-Documents-firstmate", "fm.jsonl", [said("FIRSTMATE_OP: v1 launch-brief: You are a crewmate. Don't use shadows.")]);

    const prompts: string[] = [];
    const complete = async (prompt: string) => {
      prompts.push(prompt);
      return JSON.stringify({ rules: [
        { turn: 1, rule: "No shadows on icon boxes.", scope: "personal", project: null, quote: "no shadows on the icon boxes", same_as: null },
        { turn: 1, rule: "Inconsistency is the biggest red flag.", scope: "personal", project: null, quote: "it looks inconsistent", same_as: null },
      ] });
    };
    const now = () => new Date("2026-10-07T00:00:00Z");
    const first = await learnTaste({ complete, now, projects: PROJECTS });
    expect(first).toMatchObject({ calls: 1, turns: 1, added: 2 });
    // Only the gated captain turn reached the model, with the reply before it as context.
    expect(prompts[0]).toContain("no shadows on the icon boxes");
    expect(prompts[0]).toContain('"project":"capfive-client-work"');
    expect(prompts[0]).not.toContain("I always prefer shadows everywhere");
    expect(prompts[0]).not.toContain("FIRSTMATE_OP");
    expect(prompts[0]).not.toContain("no shadows ever");
    expect(isAgentSessionDir("-Users-george--treehouse-flyd-1-flyd")).toBe(true);

    const profile = readTaste();
    expect(profile.rules.map((rule) => rule.text)).toEqual(["No shadows on icon boxes.", "Inconsistency is the biggest red flag."]);
    expect(profile.rules[0]!.evidence[0]).toMatchObject({ quote: "no shadows on the icon boxes", source: "Claude Code", project: "capfive-client-work", date: "2026-10-06" });

    // Nothing new: no model call, nothing counted twice.
    expect(await learnTaste({ complete, now, projects: PROJECTS })).toMatchObject({ calls: 0, turns: 0 });
    expect(readTaste().rules[0]!.count).toBe(1);

    // He says it again later: the rule strengthens.
    writeFileSync(file, `${readFileSync(file, "utf8")}${reply("Committed.")}\n${said("again, no shadows on the icon boxes please")}\n`);
    const again = async (prompt: string) => {
      const id = readTaste().rules[0]!.id;
      expect(prompt).toContain(`[${id}] No shadows on icon boxes.`);
      return JSON.stringify({ rules: [{ turn: 1, rule: "No shadows on icon boxes.", scope: "personal", quote: "no shadows on the icon boxes", same_as: id }] });
    };
    expect(await learnTaste({ complete: again, now, projects: PROJECTS })).toMatchObject({ calls: 1, strengthened: 1 });
    expect(readTaste().rules[0]!.count).toBe(2);
  });

  it("keeps a veto George makes on /taste while the model is still reading", async () => {
    const id = ruleId("No shadows on icon boxes.");
    writeTaste({ rules: [{ id, text: "No shadows on icon boxes.", scope: "personal", count: 1, projects: [], evidence: [] }], vetoed: [], names: {} });
    session("-Users-george-Documents-cap5", "s.jsonl", [reply("Added soft shadows."), said("no shadows on the icon boxes, and tighter type please")]);
    const complete = async () => {
      expect(vetoRule(id)).toBe(true);
      return JSON.stringify({ rules: [
        { turn: 1, rule: "No shadows on icon boxes.", scope: "personal", quote: "no shadows on the icon boxes", same_as: id },
        { turn: 1, rule: "Tight type.", scope: "personal", quote: "tighter type", same_as: null },
      ] });
    };
    await learnTaste({ complete, now: () => new Date("2026-10-07T00:00:00Z"), projects: PROJECTS });
    const profile = readTaste();
    expect(profile.vetoed.map((rule) => rule.id)).toEqual([id]);
    expect(profile.rules.map((rule) => rule.text)).toEqual(["Tight type."]);
  });

  it("reads a turn caught mid-write once it is whole", async () => {
    const whole = `${reply("Cards are azure.")}\n`;
    const turn = said("no, prefer lifted navy cards to azure");
    const file = session("-Users-george-Documents-cap5", "s.jsonl", []);
    writeFileSync(file, `${whole}${turn.slice(0, 40)}`);
    const first = await readSessionTurns(file, 0, "2026-01-01", PROJECTS);
    expect(first.turns).toEqual([]);
    expect(first.end).toBe(Buffer.byteLength(whole));
    writeFileSync(file, `${whole}${turn}\n`);
    const second = await readSessionTurns(file, first.end, "2026-01-01", PROJECTS);
    expect(second.turns.map((item) => item.text)).toEqual(["no, prefer lifted navy cards to azure"]);
    expect(second.end).toBe(Buffer.byteLength(`${whole}${turn}\n`));
  });

  it("reaches further back on an explicit --days backfill after the first run", async () => {
    const old = JSON.stringify({ ...JSON.parse(said("never centre body copy, it looks wrong")), timestamp: "2026-09-20T09:00:00.000Z" });
    session("-Users-george-Documents-cap5", "s.jsonl", [old]);
    const now = () => new Date("2026-10-07T00:00:00Z");
    const prompts: string[] = [];
    const complete = async (prompt: string) => (prompts.push(prompt), JSON.stringify({ rules: [] }));
    expect(await learnTaste({ complete, now, projects: PROJECTS })).toMatchObject({ turns: 0 });
    expect(await learnTaste({ complete, now, projects: PROJECTS, backfillDays: 30 })).toMatchObject({ turns: 1, calls: 1 });
    expect(prompts[0]).toContain("never centre body copy");
    expect(await learnTaste({ complete, now, projects: PROJECTS, backfillDays: 30 })).toMatchObject({ turns: 0, calls: 0 });
  });

  it("is off with FLYD_TASTE_LEARNING=0", async () => {
    process.env.FLYD_TASTE_LEARNING = "0";
    try {
      expect(await learnTaste({ complete: async () => "{}" })).toMatchObject({ skipped: "disabled" });
    } finally {
      delete process.env.FLYD_TASTE_LEARNING;
    }
  });
});
