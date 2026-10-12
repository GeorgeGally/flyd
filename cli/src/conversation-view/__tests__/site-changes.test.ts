import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { boxesOf } from "../boxes.js";
import { ClaudeCodeTranscriptSource } from "../claude-code-source.js";
import { FirstmateInbox } from "../firstmate-inbox.js";
import { ReplyShots } from "../reply-shots.js";
import { ElementShots, type ElementRequest } from "../element-shots.js";
import { inlineOutcomes } from "../follow-ups.js";
import { showOf, siteChangeLines, siteProjectOf } from "../show.js";
import {
  chooseElement,
  cropBox,
  hintsFromTool,
  isSiteChange,
  locatorsFor,
  mergeHints,
  pagesOpenedIn,
  pictured,
  quotedPhrases,
  renderPages,
  selectorsInCss,
  selectorsInScript,
  siteChangeOf,
  currentPage,
  short,
  sitePageOf,
  siteUrlsIn,
} from "../site-changes.js";
import { TranscriptConversation } from "../transcript-filter.js";
import type { ConversationMessage, Exchange } from "../types.js";
import { assistantText, injection, toolUse } from "./transcript-fixture.js";
import { MOBILE_DEPLOY } from "./fixtures/replies.js";

const SITE = "https://christmas.goodneighboursmarket.com";
/** Firstmate's own check of the Block42 headline, as its turn ran it. */
const CHECK = `G=/Users/me/good_neighbours; echo '.gnm-christmas .screen .photo-feature__caption h2.display-2.block42-head { font-size: clamp(2.6rem, 6vw, 6rem); line-height: .95; }' >> $G/css/christmas-2026.css
export CHROME_DEVTOOLS_AXI_SESSION=fm-main; for sz in 1440x900 390x844; do chrome-devtools-axi open "http://127.0.0.1:8088/index.html" >/dev/null 2>&1; chrome-devtools-axi eval "(async()=>{const t=document.querySelector('.screen-track'),s=document.querySelector('.block42-head').closest('.screen');t.scrollLeft=s.offsetLeft})()"; chrome-devtools-axi screenshot $S/b42-$sz.png; done`;

describe("the page a site change is on", () => {
  it("finds the site a reply names, linked or bare, and never a code host or a file", () => {
    expect(siteUrlsIn(`It's live on ${SITE} and pushed. https://github.com/GeorgeGally/flyd/pull/118`)).toEqual([SITE]);
    expect(siteUrlsIn("Both fixes are live on christmas.goodneighboursmarket.com and pushed; christmas-2026.css and index.html changed.")).toEqual([SITE]);
    expect(siteUrlsIn("See it at https://christmas.goodneighboursmarket.com/vendor.html.")).toEqual([`${SITE}/vendor.html`]);
    expect(siteUrlsIn("Preview at http://127.0.0.1:8088/index.html")).toEqual(["http://127.0.0.1:8088/index.html"]);
  });

  it("is a change only when the reply says the site changed", () => {
    expect(isSiteChange(`Captain, the Join us headline now reads "See you". It's live on ${SITE} and pushed.`)).toBe(true);
    expect(isSiteChange(`Which page of ${SITE} do you mean?`)).toBe(false);
    expect(isSiteChange("Merged https://github.com/GeorgeGally/flyd/pull/118 and pushed.")).toBe(false);
  });

  it("labels a page with just its path", () => {
    expect(short(new URL(`${SITE}/vendor-apply/index.php`))).toBe("/vendor-apply");
    expect(short(new URL(`${SITE}/vendor-apply/`))).toBe("/vendor-apply");
    expect(short(new URL(`${SITE}/visit/index.html`))).toBe("/visit");
    expect(short(new URL(`${SITE}/index.php`))).toBe("/");
    expect(short(new URL(SITE))).toBe("/");
    expect(sitePageOf(`Live on ${SITE}/vendor-apply/index.php and pushed.`)).toEqual({ label: "/vendor-apply", url: `${SITE}/vendor-apply/index.php` });
  });

  it("opens the most particular page the reply names, as a short label", () => {
    expect(sitePageOf(`Live on ${SITE} and pushed (see it at ${SITE}/vendor).`)).toEqual({ label: "/vendor", url: `${SITE}/vendor` });
    expect(sitePageOf(`Live on ${SITE}.`)).toEqual({ label: "/", url: SITE });
    expect(sitePageOf("Pushed; the preview is http://127.0.0.1:8088/visit.html")).toEqual({ label: "/visit.html", url: "http://127.0.0.1:8088/visit.html" });
    expect(sitePageOf("No site here, just pushed.")).toBeUndefined();
  });

  it("opens the deeper page the turn checked on its preview when the reply names only the front door", () => {
    const opened = ["http://127.0.0.1:8088/index.html", "http://127.0.0.1:8088/vendor.html"];
    expect(sitePageOf(`Live on ${SITE} and pushed.`, opened)).toEqual({ label: "/vendor.html", url: `${SITE}/vendor.html` });
    expect(sitePageOf(`Live on ${SITE} and pushed.`, ["http://127.0.0.1:8088/index.html"])).toEqual({ label: "/", url: SITE });
  });

  it("renders from the preview the turn checked first, then the pages the reply names", () => {
    expect(renderPages(`Live on ${SITE}.`, ["http://127.0.0.1:8088/index.html"])).toEqual(["http://127.0.0.1:8088/index.html", SITE]);
    expect(renderPages(`Live on ${SITE}.`)).toEqual([SITE]);
  });
});

describe("what a turn says it changed", () => {
  it("reads the CSS rules a command appended, never the shell around them", () => {
    const hints = hintsFromTool("Bash", { command: CHECK });
    expect(hints.edited).toEqual([".gnm-christmas .screen .photo-feature__caption h2.display-2.block42-head"]);
    expect(hints.looked).toEqual([".screen-track", ".block42-head", ".screen"]);
    expect(hints.pages).toEqual(["http://127.0.0.1:8088/index.html"]);
  });

  it("reads the rules an edit to a stylesheet wrote, without hover states, bare tags or keyframes", () => {
    const css = `.venue .buttons a:hover, .venue .buttons { gap: 2rem; }\n@media (max-width: 600px) { .venue .buttons { gap: 1rem; } }\n@keyframes glow { from { opacity: 0; } to { opacity: 1; } }\nh2 { color: red; }`;
    expect(selectorsInCss(css)).toEqual([".venue .buttons a", ".venue .buttons"]);
    expect(hintsFromTool("Edit", { file_path: "/s/css/site.css", old_string: "x", new_string: css }).edited).toEqual([".venue .buttons a", ".venue .buttons"]);
    expect(hintsFromTool("Edit", { file_path: "/s/index.html", new_string: css }).edited).toEqual([]);
  });

  it("skips pages built from a shell variable and selectors it cannot use", () => {
    expect(pagesOpenedIn('for p in a b; do chrome-devtools-axi open "http://127.0.0.1:8088/$p.html"; done')).toEqual([]);
    expect(selectorsInScript("document.querySelector('body'); el.closest(`.card`)")).toEqual([".card"]);
  });

  it("keeps the newest edits first and the pages in the order opened", () => {
    const first = mergeHints(undefined, { pages: ["http://127.0.0.1:8088/a"], edited: [".a"], looked: [] });
    const both = mergeHints(first, { pages: ["http://127.0.0.1:8088/b"], edited: [".b"], looked: [".c"] });
    expect(both).toEqual({ pages: ["http://127.0.0.1:8088/a", "http://127.0.0.1:8088/b"], edited: [".b", ".a"], looked: [".c"] });
    expect(mergeHints(first, { pages: [], edited: [], looked: [] })).toBe(first);
  });

  it("collects them on the reply of the turn that did the work", () => {
    const conversation = new TranscriptConversation();
    for (const line of [injection("firstmate watcher wake"), toolUse("Bash", { command: CHECK }), assistantText(`Captain, "Santa's coming to Block42 at Nuanu" is now much bigger. It's live on ${SITE} and pushed.`)]) {
      conversation.pushLine(line);
    }
    const reply = conversation.snapshot().messages.find((message) => message.role === "assistant")!;
    expect(reply.site?.edited).toEqual([".gnm-christmas .screen .photo-feature__caption h2.display-2.block42-head"]);
    expect(reply.site?.pages).toEqual(["http://127.0.0.1:8088/index.html"]);
  });
});

describe("finding the changed element", () => {
  it("looks for the rules written first, then the words the reply quotes, then what its checks looked at", () => {
    const reply = `Captain, the headline now reads “See you for Christmas”. The "Remind me" button opens a popup. Live on ${SITE}.`;
    expect(quotedPhrases(reply)).toEqual(["See you for Christmas", "Remind me"]);
    expect(locatorsFor(reply, { pages: [], edited: [".join h2"], looked: [".screen"] })).toEqual([
      { kind: "css", value: ".join h2" },
      { kind: "text", value: "See you for Christmas" },
      { kind: "text", value: "Remind me" },
      { kind: "css", value: ".screen" },
    ]);
    expect(quotedPhrases('Paths like "/Users/me/x.png" and "42" are not words on the page.')).toEqual([]);
  });

  it("chooses the first drawn element smaller than the page", () => {
    const view = { width: 1440, height: 900 };
    const screen = { x: 0, y: 0, width: 1440, height: 900 };
    const headline = { x: 100, y: 300, width: 900, height: 160 };
    expect(chooseElement([null, screen, headline], view)).toBe(2);
    expect(chooseElement([{ x: 0, y: 0, width: 0, height: 0 }, headline], view)).toBe(1);
    // Every match is the page: the first drawn still beats nothing.
    expect(chooseElement([null, screen], view)).toBe(1);
    expect(chooseElement([null, null], view)).toBe(-1);
  });

  it("crops the element with room around it, readable, and inside the screen", () => {
    const view = { width: 1440, height: 900 };
    // A big headline: the element plus its padding.
    expect(cropBox({ x: 100, y: 300, width: 900, height: 160 }, view)).toEqual({ x: 60, y: 200, width: 980, height: 360 });
    // A small button: never smaller than a readable piece of the page, centred on it.
    expect(cropBox({ x: 700, y: 440, width: 120, height: 40 }, view)).toEqual({ x: 440, y: 280, width: 640, height: 360 });
    // At the screen's edge: kept on screen.
    expect(cropBox({ x: 1380, y: 870, width: 50, height: 20 }, view)).toEqual({ x: 800, y: 540, width: 640, height: 360 });
    // Bigger than the screen: the screen.
    expect(cropBox({ x: -50, y: -40, width: 2000, height: 1400 }, view)).toEqual({ x: 0, y: 0, width: 1440, height: 900 });
  });
});

describe("a reply pictured as the element it changed", () => {
  const reply: ConversationMessage = { id: "reply:1", role: "assistant", text: `The "Remind me" button is bigger. Live on ${SITE} and pushed.`, shots: ["/flyd/view/reply-shots/full.png"] };
  const page = { label: "/", url: SITE };

  it("shows the crop in place of the whole page once it is made", () => {
    expect(pictured(reply, page, { state: "ready", path: "/flyd/view/element-shots/element-a.png" })).toMatchObject({ page, shots: ["/flyd/view/element-shots/element-a.png"] });
  });

  it("holds the whole page back while the crop is made, and falls back to it when there is none", () => {
    expect(pictured(reply, page, { state: "pending" }).shots).toBeUndefined();
    expect(pictured(reply, page, { state: "none" }).shots).toEqual(["/flyd/view/reply-shots/full.png"]);
    expect(pictured(reply, page).page).toEqual(page);
  });

  it("says what to find and where", () => {
    const change = siteChangeOf({ ...reply, site: { pages: ["http://127.0.0.1:8088/index.html"], edited: [".remind"], looked: [] } });
    expect(change).toEqual({
      page,
      pages: ["http://127.0.0.1:8088/index.html", SITE],
      locators: [{ kind: "css", value: ".remind" }, { kind: "text", value: "Remind me" }],
    });
    expect(siteChangeOf({ role: "user", text: reply.text })).toBeUndefined();
  });

  it("carries its page to the outcome under his note", () => {
    const exchange: Exchange = {
      question: { id: "note:1791723045-AQrWsG", role: "user", text: "make the remind me button bigger" },
      answer: { ...reply, answers: "note:1791723045-AQrWsG", page },
      waiting: "",
    };
    const [inline] = inlineOutcomes([exchange]);
    expect(inline!.question.page).toEqual(page);
    expect(inline!.question.shots).toEqual(reply.shots);
  });
});

describe("site changes on Flyd's artefact", () => {
  const now = Date.parse("2026-10-11T15:00:00Z");
  const page = { label: "/vendor", url: `${SITE}/vendor` };
  const answer: ConversationMessage = {
    id: "reply:x#4",
    role: "assistant",
    text: `Captain, the summary column is now black. Live on ${SITE} and pushed.`,
    timestamp: "2026-10-11T14:17:58Z",
    answers: "note:1791723045-AQrWsG",
    shots: ["/Users/me/.flyd/view/element-shots/element-abc.png"],
    page,
  };

  it("are stories of their own, the element as the picture and the page as a button", () => {
    const screen = showOf({ messages: [], working: false, followUps: { [answer.answers!]: answer } }, { now });
    const item = screen.items.find((entry) => entry.id === `site:${answer.id}`)!;
    expect(item).toMatchObject({ kind: "landed", why: "changed on the site", status: "live", open: page, ref: answer.answers });
    expect(item.headline).toBe("The summary column is now black.");
    expect(item.shots).toEqual([{ src: "/api/rail-image?path=%2FUsers%2Fme%2F.flyd%2Fview%2Felement-shots%2Felement-abc.png", label: "element-abc.png" }]);
    const story = boxesOf(screen).flatMap((box) => [box, ...(box.children ?? [])]).find((box) => box.id === item.id)!;
    expect(story.open).toEqual(page);
  });

  it("are told by what changed, not by where it went or a status count", () => {
    const report = `Captain, all three changes are live on ${SITE} and pushed:\n\n- **Menu:** "Vendors" is gone.\n- **Lights:** only yellow and green now.\n\nWant the Visit screen gone too?`;
    expect(siteChangeLines(report)).toEqual({ headline: 'Menu: "Vendors" is gone.', detail: "Lights: only yellow and green now." });
    expect(siteChangeLines(`It's live on ${SITE} and pushed.`).headline).toBe(`It's live on ${SITE} and pushed.`);
  });

  it("lead with what was done, never a caveat or aside", () => {
    expect(siteChangeLines(MOBILE_DEPLOY)).toEqual({
      headline: "Pulled the mobile changes, tested them, and deployed.",
      detail: "Testing: all five pages open at true phone size with no sideways scroll, and nothing errors in the browser.",
    });
    expect(siteChangeLines("The deploy only opens applications if asked. The menu now closes when you tap outside.").headline).toBe("The menu now closes when you tap outside.");
  });

  it("belong to the project whose site it is, not one the words mention", () => {
    const projects = [{ name: "Flyd", repos: ["/Users/me/Documents/flyd"] }, { name: "GNM (Good Neighbours Market)", repos: ["/Users/me/Documents/good_neighbours"] }];
    expect(siteProjectOf(SITE, projects)).toBe("GNM (Good Neighbours Market)");
    expect(siteProjectOf("https://example.com", projects)).toBeUndefined();
    const screen = showOf({ messages: [], working: false, followUps: { [answer.answers!]: { ...answer, text: `${answer.text} The Flyd fix is merged.` } } }, { now, projects });
    expect(screen.items[0]!.project).toBe("GNM (Good Neighbours Market)");
  });

  it("show the newest few from the last day, once each", () => {
    const old = { ...answer, id: "reply:old", timestamp: "2026-10-09T10:00:00Z" };
    const relayed = { ...answer, answers: undefined, aside: true };
    const screen = showOf({ messages: [relayed, old], working: false, followUps: { [answer.answers!]: answer } }, { now });
    expect(screen.items.filter((entry) => entry.open).map((entry) => entry.id)).toEqual([`site:${answer.id}`]);
  });
});

describe("element crops", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("are made once in the background, announced, and remembered across restarts", async () => {
    root = mkdtempSync(join(tmpdir(), "flyd-elements-"));
    let renders = 0;
    const shots = new ElementShots({ root, render: async () => (renders++, Buffer.from("png")) });
    const request = { key: "reply:1", pages: [SITE], locators: [{ kind: "css" as const, value: ".remind" }] };
    const done = new Promise<void>((resolve) => shots.onChange(resolve));
    expect(shots.shot(request)).toEqual({ state: "pending" });
    expect(shots.shot(request)).toEqual({ state: "pending" });
    await done;
    const ready = shots.shot(request);
    expect(ready.state).toBe("ready");
    expect(readFileSync((ready as { path: string }).path, "utf8")).toBe("png");
    expect(new ElementShots({ root, render: async () => null }).shot(request)).toEqual(ready);
    expect(renders).toBe(1);
  });

  it("give up to the full picture when the element is not found, or there is nothing to look for", async () => {
    root = mkdtempSync(join(tmpdir(), "flyd-elements-"));
    const shots = new ElementShots({ root, render: async () => null });
    const request = { key: "reply:2", pages: [SITE], locators: [{ kind: "text" as const, value: "Remind me" }] };
    const done = new Promise<void>((resolve) => shots.onChange(resolve));
    shots.shot(request);
    await done;
    expect(shots.shot(request)).toEqual({ state: "none" });
    expect(shots.shot({ ...request, key: "reply:3", locators: [] })).toEqual({ state: "none" });
  });
});

describe("a note that changed the site, read from firstmate's session", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const NOTE = "1791723045-AQrWsG";
  /** The note, the turn that changed the headline, the screenshot it read, and its reply. */
  function session(): { home: string; project: string } {
    dir = mkdtempSync(join(tmpdir(), "flyd-site-note-"));
    const home = join(dir, "fm");
    const project = join(dir, "project");
    for (const sub of ["state/inbox/handled", "bin"]) mkdirSync(join(home, sub), { recursive: true });
    mkdirSync(project);
    writeFileSync(join(home, "bin", "fm-inbox.sh"), "#!/bin/sh\n");
    writeFileSync(join(home, "state", "inbox", "handled", `${NOTE}.note`), `id=${NOTE}\nat=${new Date(Date.now() - 60_000).toISOString()}\nsource=text\n--\nSanta's coming to Block42 -> make headline bigger\n`);
    // The session started before the note came in.
    const at = new Date(Date.now() - 120_000).toISOString();
    const image = Buffer.alloc(64, 0);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(image);
    image.write("IHDR", 12, "latin1");
    image.writeUInt32BE(1440, 16);
    image.writeUInt32BE(900, 20);
    const read = (role: string, content: unknown[]) => JSON.stringify({ type: role, uuid: `${role}-${content.length}-${Math.random()}`, timestamp: at, message: { role, model: "claude-opus-5-5", content, stop_reason: "tool_use" } });
    const lines = [
      injection("firstmate watcher wake"),
      toolUse("Bash", { command: `sed -n '/^--$/,$p' /fm/state/inbox/${NOTE}.note` }),
      toolUse("Bash", { command: CHECK }),
      read("assistant", [{ type: "tool_use", id: "toolu_shot", name: "Read", input: { file_path: "/private/tmp/scratchpad/b42.png" } }]),
      read("user", [{ tool_use_id: "toolu_shot", type: "tool_result", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: image.toString("base64") } }] }]),
      assistantText(`Captain, "Santa's coming to Block42 at Nuanu" is now much bigger. It's live on ${SITE} and pushed.`),
    ].map((line) => line.replace(/"timestamp":"[^"]*"/, `"timestamp":"${at}"`));
    writeFileSync(join(project, "s1.jsonl"), `${lines.join("\n")}\n`);
    return { home, project };
  }

  it("shows the element it changed and a button to its page, under his note", async () => {
    const { home, project } = session();
    const asked: ElementRequest[] = [];
    const elements = new ElementShots({ root: join(dir, "elements"), render: async (request) => (asked.push(request), Buffer.from("crop")) });
    const source = new ClaudeCodeTranscriptSource({ projectDir: project, inbox: new FirstmateInbox({ home }), shots: new ReplyShots({ root: join(dir, "shots") }), elements });
    const made = new Promise<void>((resolve) => elements.onChange(resolve));
    const first = await source.read("s1");
    const page = { label: "/", url: SITE };
    // While the crop is made, the whole page waits.
    expect(first.followUps?.[`note:${NOTE}`]).toMatchObject({ page });
    expect(first.followUps?.[`note:${NOTE}`]?.shots).toBeUndefined();
    await made;
    expect(asked[0]).toMatchObject({
      pages: ["http://127.0.0.1:8088/index.html", SITE],
      locators: [{ kind: "css", value: ".gnm-christmas .screen .photo-feature__caption h2.display-2.block42-head" }, { kind: "text", value: "Santa's coming to Block42 at Nuanu" }, { kind: "css", value: ".screen-track" }, { kind: "css", value: ".block42-head" }, { kind: "css", value: ".screen" }],
    });
    const after = await source.read("s1");
    const crop = [expect.stringMatching(/element-[0-9a-f]+\.png$/)];
    expect(after.followUps?.[`note:${NOTE}`]).toMatchObject({ page, shots: crop });
    expect(after.messages.find((message) => message.id === `note:${NOTE}`)).toMatchObject({ page, shots: crop });
  });

  it("falls back to the screenshot the turn read when the element is not on the page", async () => {
    const { home, project } = session();
    const elements = new ElementShots({ root: join(dir, "elements"), render: async () => null });
    const source = new ClaudeCodeTranscriptSource({ projectDir: project, inbox: new FirstmateInbox({ home }), shots: new ReplyShots({ root: join(dir, "shots") }), elements });
    const made = new Promise<void>((resolve) => elements.onChange(resolve));
    await source.read("s1");
    await made;
    const after = await source.read("s1");
    expect(after.followUps?.[`note:${NOTE}`]?.shots).toEqual([expect.stringMatching(/s1-t\d+\.0\.png$/)]);
  });
});

describe("the page the work is on now", () => {
  it("is the newest message that names a site, its section kept, local or live", () => {
    const messages = [
      { text: `Live on ${SITE}/vendor-apply and pushed.` },
      { text: "Fixed the hat." },
      { text: "am i even seeing the live version. http://127.0.0.1:8088/index.html#location ??" },
      { text: "Yes, sir." },
    ];
    expect(currentPage(messages)).toEqual({ label: "/#location", url: "http://127.0.0.1:8088/index.html#location", host: "127.0.0.1:8088", local: true });
    expect(currentPage(messages.slice(0, 2))).toEqual({ label: "/vendor-apply", url: `${SITE}/vendor-apply`, host: "christmas.goodneighboursmarket.com", local: false });
  });

  it("takes a reply's own page first, and is nothing without a site", () => {
    expect(currentPage([{ text: "Done; see https://github.com/GeorgeGally/flyd/pull/121", page: { label: "/visit", url: `${SITE}/visit` } }])).toMatchObject({ label: "/visit", local: false });
    expect(currentPage([{ text: "Merged https://github.com/GeorgeGally/flyd/pull/121." }, { text: "Thanks." }])).toBeUndefined();
  });
});
