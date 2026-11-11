import { describe, expect, it } from "vitest";
import { interpretPrompt } from "../../conversation-view/interpret.js";
import { bannedFor, forHim, PA_VOICE, shortHeadline, staffStatusLine, statusSaid, withoutInformAsk } from "../pa-voice.js";

// Real lines Flyd showed George (data/flyd-voice-you/corpus.md), and what they read as now.
const REAL: Array<[string, string]> = [
  ["George needs to answer the three questions: Opinion section back-fill or drop, Reports heading wording.", "You need to answer the three questions: Opinion section back-fill or drop, Reports heading wording."],
  ["Still open: his picks for the other five sections - v01 hero buttons, v03 deals on phones.", "Still open: your picks for the other five sections - v01 hero buttons, v03 deals on phones."],
  ["The CapFive lab round 5 captain has posted three open questions about the Review and Opinion section.", "I have three open questions about the Review and Opinion section."],
  ["Question: is George done looking, so it can be stopped?", "Question: are you done looking, so it can be stopped?"],
  ["PC has Firstmate and all tools; it cannot launch until George acts.", "PC has Firstmate and all tools; it cannot launch until you act."],
  ["Merge was blocked by a permission check, so it needs George to say merge.", "Merge was blocked by a permission check, so it needs you to say merge."],
  ["The page isn't broken. Do you want me to pass along the confirmation once the screenshot is in?", "The page isn't broken. I'll let you know once the screenshot is in."],
  ["**Changed** The deck dropped the third tier.\n**Needed** Send it.", "The deck dropped the third tier.\nSend it."],
  ["Means: Design decisions are pending.", "Design decisions are pending."],
  ["The page isn't broken.\n\nDo you want me to pass along the confirmation once the screenshot is in?", "The page isn't broken.\n\nI'll let you know once the screenshot is in."],
  ["George needs to give firstmate a time for Logan's restart, which will reload his tab.", "You need to give firstmate a time for Logan's restart, which will reload his tab."],
];

describe("forHim", () => {
  it.each(REAL)("says %j to him", (before, after) => {
    expect(forHim(before)).toBe(after);
    expect(bannedFor(forHim(before))).toBeNull();
  });

  it("leaves plain prose and words that only look like labels alone", () => {
    expect(forHim("Evidence suggests the deck is fine. Next week works.")).toBe("Evidence suggests the deck is fine. Next week works.");
    expect(forHim("Should I send the link to Mark?")).toBe("Should I send the link to Mark?");
  });

  it("leaves code exactly as written", () => {
    const answer = "Next: The fix is below.\n\n```ts\nthrow new Error(\"x\", {\n  cause: err,\n});\n```\n\nGeorge can run `next: build   now`.";
    expect(forHim(answer)).toBe("The fix is below.\n\n```ts\nthrow new Error(\"x\", {\n  cause: err,\n});\n```\n\nYou can run `next: build   now`.");
  });

  it("drops the staff's PR bookkeeping", () => {
    expect(forHim("The Week page is ready (still monitoring for merge/close).")).toBe("The Week page is ready.");
  });
});

describe("statusSaid", () => {
  it("turns a staff status line into what it means for him", () => {
    expect(statusSaid("Checks green: PR ready for review (still monitoring for merge/close):…", "The Week page")).toBe("The Week page is finished and ready for you to land.");
    expect(statusSaid("I added hover details to the Week page.", "Week")).toBeNull();
  });
});

describe("withoutInformAsk", () => {
  it("never asks leave to tell him", () => {
    expect(withoutInformAsk("Want me to let you know when it lands?")).toBe("I'll let you know when it lands.");
    expect(withoutInformAsk("Should I send the link?")).toBe("Should I send the link?");
    expect(withoutInformAsk("Do you want me to tell you more about the Reports heading options?")).toBe("Do you want me to tell you more about the Reports heading options?");
  });
});

describe("the banned phrases", () => {
  it("catch what George called out", () => {
    for (const line of ["George needs to answer.", "his picks for v01", "The CapFive lab round 5 captain has posted", "Changed The card stays.", "Checks green: PR ready for review", "Do you want me to pass along the confirmation?"]) {
      expect(bannedFor(line)).not.toBeNull();
    }
  });

  it("the prompt that interprets firstmate's answers carries the voice spec", () => {
    const prompt = interpretPrompt({ question: "Is the deck done?", answer: "Changed: tier three is gone.", recent: [] }, null);
    for (const line of PA_VOICE.split("\n")) expect(prompt).toContain(line);
  });
});

describe("shortHeadline", () => {
  it("is a short complete phrase, never a cut copy", () => {
    expect(shortHeadline("Pierre: hardware-style redesign lab on a Liesel board (Codex): Choose the Pierre hardware … Choose the Pierre…")).toBe("Pierre: hardware-style redesign lab");
    expect(shortHeadline("Earlier report: DIR: 5 Rams / Teenage Engineering options for like/dislike/request con…")).toBe("DIR: 5 Rams / Teenage Engineering options for like/dislike/request");
    expect(shortHeadline("Week view")).toBe("Week view");
    for (const head of [shortHeadline("A very long label that goes on and on about many many things past ten words easily"), shortHeadline("Thing: cut here…")]) expect(head).not.toMatch(/…|\.\.\./);
  });
});

describe("staffStatusLine", () => {
  it("knows a worker's status line from a plain sentence", () => {
    expect(staffStatusLine("Captain's Live now note applied in place (Request key -> Eject #8d9aa6, white mark), verified headless 1440/834/390 and frame serves r=9")).toBe(true);
    expect(staffStatusLine("I changed the Request key to match Eject.")).toBe(false);
  });
});
