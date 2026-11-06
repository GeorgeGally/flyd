import { describe, expect, it } from "vitest";
import { aboutOnly, askLine, nameReader, offThread, tagTurns, threadCatalogue, turnsOf } from "../project-tags.js";
import type { ConversationMessage } from "../types.js";

const REGISTRY = `# Fleet project registry

- flyd [no-mistakes-prod-only +yolo] - Flyd: personal-intelligence and agent platform; remote GeorgeGally/flyd
- capfive [local-only +yolo] - CapFive (rebrand of AICA): custom WordPress site for an M&A advisory network; static source
- dead-internet-radio [no-mistakes +yolo] - Dead Internet Radio; remote GeorgeGally/dead-internet-radio
- guides [local-only +yolo] - Guido: Chrome extension with rulers; remote GeorgeGally/guido
- bloom [no-mistakes-prod-only +yolo] - Bloom Rails app: creator-content tracking; live copy ~/Documents/bloom
- newthing [local-only] - Newthing: a project added today; no remote yet
`;

const projects = threadCatalogue(REGISTRY, [
  { id: "dir-dead-internet-radio", name: "DIR (Dead Internet Radio)", status: "active", repos: ["/x/dead-internet-radio"] },
  { id: "capfive-client-work", name: "Capfive client work", status: "active", repos: ["/x/cap5"] },
  { id: "koko", name: "Koko", status: "paused", repos: ["/x/koko"] },
  { id: "which-new-version", name: "Which /new version(s) from lab round 2 to build", status: "done" },
]);
const read = nameReader(projects);

const user = (id: string, text: string, timestamp = "2026-11-06T10:00:00Z"): ConversationMessage => ({ id, role: "user", text, timestamp });
const reply = (id: string, text: string, extra: Partial<ConversationMessage> = {}): ConversationMessage => ({ id, role: "assistant", text, timestamp: "2026-11-06T10:01:00Z", ...extra });

describe("threadCatalogue", () => {
  it("uses the names firstmate uses, folding repos, old names and Flyd's own list into them", () => {
    const names = projects.map((project) => project.name);
    expect(names).toEqual(expect.arrayContaining(["Flyd", "DIR", "CapFive", "Logan", "HFTW", "Atomise", "Liesel", "Guido", "Bloom", "Newthing", "Koko"]));
    expect(names.filter((name) => /dead internet|capfive client|rails app/i.test(name))).toEqual([]);
    expect(names.some((name) => name.startsWith("Which"))).toBe(false);
  });
});

describe("nameReader", () => {
  it("reads what he types and what firstmate writes", () => {
    expect(read("i need gradient fills in logan")).toEqual(["Logan"]);
    expect(read("ok send all those captfive test emails")).toEqual(["CapFive"]);
    expect(read("the click to start on DIR is ugly")).toEqual(["DIR"]);
    expect(read("add 5 variations on a Liesel board")).toEqual(["Liesel"]);
    expect(read("open https://github.com/GeorgeGally/dead-internet-radio/pull/12")).toEqual(["DIR"]);
  });

  it("reads a task id, a project's old name and a new project's name", () => {
    expect(read("spawned dir-video-cache")).toEqual(["DIR"]);
    expect(read("spawned logan-gradients")).toEqual(["Logan"]);
    expect(read("the aica redirects")).toEqual(["CapFive"]);
    expect(read("Newthing needs a logo")).toEqual(["Newthing"]);
  });

  it("does not take ordinary words for a project", () => {
    expect(read("add some bloom to the glow")).toEqual([]);
    expect(read("roger that")).toEqual([]);
    expect(read("cd into the build dir/ and list it, use mkdir")).toEqual([]);
  });
});

describe("turnsOf", () => {
  it("keeps stacked questions with their reply and leaves a wake on its own", () => {
    const turns = turnsOf([user("q1", "one"), user("q2", "two"), reply("w", "Captain, the work landed.", { wake: true }), reply("r", "Captain, both done.")]);
    expect(turns.map((turn) => [turn.key, turn.asked.map((m) => m.id), turn.reply?.id])).toEqual([["w", [], "w"], ["q1", ["q1", "q2"], "r"]]);
  });

  it("drops a routine line that answers nothing, and keeps one that answers him", () => {
    expect(turnsOf([reply("a", "Captain, shipshape.")])).toEqual([]);
    expect(turnsOf([user("q", "all good?"), reply("a", "Captain, shipshape.")]).map((turn) => turn.reply?.id)).toEqual(["a"]);
  });

  it("leaves out the harness's words and a wake with nothing to say", () => {
    expect(offThread(user("a", "Run bin/fm-session-start.sh exactly once in this harness"))).toBe(true);
    expect(offThread(user("b", "/compact"))).toBe(true);
    expect(offThread(reply("c", "Captain, shipshape.", { wake: true }))).toBe(true);
    expect(offThread(reply("d", "Captain, shipshape."))).toBe(false);
    expect(offThread(user("e", "/join should show the headline on top"))).toBe(false);
  });
});

describe("tagTurns", () => {
  const tagged = (messages: ConversationMessage[], judged?: Parameters<typeof tagTurns>[2]) => tagTurns(turnsOf(messages), read, judged).tags;

  it("puts a reply that names nothing under its question", () => {
    const tags = tagged([user("q", "videos are not caching on DIR"), reply("r", "Captain, the worker found the bug.")]);
    expect(tags.get("q")).toEqual(["DIR"]);
    expect(tags.get("r")).toEqual(["DIR"]);
  });

  it("gives a quiet question the project its answer names", () => {
    const tags = tagged([user("q", "cc me also"), reply("r", "Captain, you're on copy for the CapFive email.")]);
    expect(tags.get("q")).toEqual(["CapFive"]);
  });

  it("puts a message about several projects in each", () => {
    const tags = tagged([user("q", "does the DIR fix touch Logan?"), reply("r", "No.")]);
    expect(tags.get("q")).toEqual(["DIR", "Logan"]);
    expect(tags.get("r")).toEqual(["DIR", "Logan"]);
  });

  it("does not put a report on other work under his question", () => {
    const tags = tagged([user("q", "the song length on DIR"), reply("r", "Captain, the CapFive emails went out.")]);
    expect(tags.get("r")).toEqual(["CapFive"]);
  });

  it("takes a quiet reply as answering the last thing he said, not the stack above it", () => {
    const tags = tagged([user("a", "the DIR songs"), user("b", "send the capfive emails"), user("c", "still no video on DIR"), reply("r", "Found the bug.")]);
    expect(tags.get("r")).toEqual(["DIR"]);
  });

  it("leaves a fleet round-up to All", () => {
    const tags = tagged([reply("r", "Captain: Flyd, DIR, Logan, CapFive and HFTW all moved today.", { wake: true })]);
    expect(tags.get("r")).toEqual([]);
  });

  it("lets a quiet stacked message follow the one before it", () => {
    const tags = tagged([user("a", "fix the DIR ident"), user("b", "and make it bigger"), reply("r", "Done.")]);
    expect(tags.get("b")).toEqual(["DIR"]);
  });

  it("takes firstmate's word for a turn that names nothing, its none included", () => {
    const messages = [user("q", "rotate is broken"), reply("r", "On it.")];
    expect(tagged(messages, () => "Logan").get("q")).toEqual(["Logan"]);
    expect(tagged(messages, () => "Logan").get("r")).toEqual(["Logan"]);
    expect(tagged(messages, () => null).get("q")).toEqual([]);
  });

  it("carries a quiet turn on from the talk before it", () => {
    const messages = [user("a", "on DIR the ident"), reply("b", "Done on DIR."), user("c", "smaller squares", "2026-11-06T10:05:00Z"), reply("d", "Done.")];
    expect(tagged(messages).get("c")).toEqual(["DIR"]);
  });

  it("does not carry on across a change of subject or a long gap", () => {
    const jumped = [user("a", "DIR ident"), reply("b", "Done."), user("c", "logan gradients"), reply("d", "Done."), user("e", "smaller", "2026-11-06T10:05:00Z"), reply("f", "Done.")];
    expect(tagged(jumped).get("e")).toEqual([]);
    const late = [user("a", "DIR ident"), reply("b", "Done."), user("c", "smaller", "2026-11-06T14:00:00Z")];
    expect(tagged(late).get("c")).toEqual([]);
  });

  it("carries a quiet turn back from the next named one when nothing comes before it", () => {
    const messages = [user("a", "smaller squares"), reply("b", "Done."), user("c", "and on DIR the ident", "2026-11-06T10:05:00Z"), reply("d", "Done.")];
    expect(tagged(messages).get("a")).toEqual(["DIR"]);
  });

  it("leaves to firstmate only the turns nothing here could place", () => {
    const placed = turnsOf([user("a", "DIR ident"), reply("b", "Done."), user("c", "smaller", "2026-11-06T10:02:00Z")]);
    expect(tagTurns(placed, read).unplaced).toEqual([]);
    const jumped = turnsOf([user("a", "DIR ident"), reply("b", "Done."), user("c", "logan gradients"), reply("d", "Done."), user("e", "smaller", "2026-11-06T10:02:00Z")]);
    expect(tagTurns(jumped, read).unplaced).toEqual([2]);
    expect(tagTurns(jumped, read, () => null).unplaced).toEqual([]);
  });
});

describe("aboutOnly", () => {
  const roundUp = "Here's where things stand:\n\n- **Flyd:** two workers are on it.\n- **DIR changes:** every DIR change is pushed.\n- **Bouncy:** a worker is fixing it.\n- **Logan:** filters have started.";

  it("leaves other projects' points to their threads, and keeps a point that names none", () => {
    const said = aboutOnly(roundUp, "DIR", read);
    expect(said).toContain("DIR changes");
    expect(said).toContain("Bouncy");
    expect(said).toContain("Here's where things stand");
    expect(said).not.toContain("Flyd");
    expect(said).not.toContain("Logan");
  });

  it("leaves another project's paragraph to its thread", () => {
    expect(aboutOnly("Amna has the CapFive emails.\n\nThe longer DIR songs are ready.", "DIR", read)).toBe("The longer DIR songs are ready.");
  });

  it("keeps a reply whole when it has no points, or nothing of this project's", () => {
    expect(aboutOnly("Logan and DIR both landed.", "DIR", read)).toBe("Logan and DIR both landed.");
    expect(aboutOnly("Status:\n- Logan: done.\n- Flyd: done.", "DIR", read)).toBe("Status:\n- Logan: done.\n- Flyd: done.");
  });

  it("does not read inside a code block", () => {
    const text = "Run this:\n\n```\n- Logan: not a point\n```\n\n- DIR: done.";
    expect(aboutOnly(text, "DIR", read)).toBe(text);
  });
});

describe("askLine", () => {
  it("gives firstmate the turn, cut short, and the projects around it", () => {
    const turns = turnsOf([user("a", "DIR ident"), reply("b", "Done."), user("c", "x".repeat(500)), reply("d", "y".repeat(500))]);
    const { named } = tagTurns(turns, read);
    const line = askLine(turns, 1, named);
    expect(line).toMatch(/^he said: x+… \| reply: y+… \| around: DIR$/);
    expect(line.length).toBeLessThan(280);
  });
});
