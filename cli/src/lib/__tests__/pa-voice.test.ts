import { describe, expect, it } from "vitest";
import { bannedFor, forHim, PA_VOICE, statusSaid, withoutInformAsk } from "../pa-voice.js";

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
  ["George needs to give firstmate a time for Logan's restart, which will reload his tab.", "You need to give firstmate a time for Logan's restart, which will reload your tab."],
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
  });
});

describe("the banned phrases", () => {
  it("catch what George called out", () => {
    for (const line of ["George needs to answer.", "his picks for v01", "The CapFive lab round 5 captain has posted", "Changed The card stays.", "Checks green: PR ready for review", "Do you want me to pass along the confirmation?"]) {
      expect(bannedFor(line)).not.toBeNull();
    }
  });

  it("the voice spec every speaking prompt carries says I, you and no labels", () => {
    expect(PA_VOICE).toMatch(/"I"/);
    expect(PA_VOICE).toMatch(/"you"/);
    expect(PA_VOICE).toMatch(/Changed, Means, Needed/);
  });
});
