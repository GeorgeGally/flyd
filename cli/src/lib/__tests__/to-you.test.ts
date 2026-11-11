import { describe, expect, it } from "vitest";
import { aboutHim, toYou } from "../to-you.js";

describe("toYou", () => {
  it("turns the CapFive card from about him to to him", () => {
    expect(toYou("Still open: his picks for the other five sections.")).toBe("Still open: your picks for the other five sections.");
    expect(toYou("George needs to answer the three questions.")).toBe("You need to answer the three questions.");
    expect(toYou("The CapFive lab round 5 captain has posted three open questions about the Reports heading."))
      .toBe("I have three open questions about the Reports heading.");
  });

  it("keeps the grammar when he is the subject, the owner or the object", () => {
    expect(toYou("Is George's call needed?")).toBe("Is your call needed?");
    expect(toYou("Is George happy with v2?")).toBe("Are you happy with v2?");
    expect(toYou("Waiting on the captain. He has two picks to make.")).toBe("Waiting on you. You have two picks to make.");
    expect(toYou("Send it for George to review.")).toBe("Send it for you to review.");
    expect(toYou("Ready for him to review.")).toBe("Ready for you to review.");
  });

  it("leaves other people and plain words alone", () => {
    expect(toYou("Mark sent his notes on the deck.")).toBe("Mark sent his notes on the deck.");
    expect(toYou("The work for the team is done.")).toBe("The work for the team is done.");
    expect(toYou("")).toBe("");
  });

  it("finds third-person lines so none reaches him", () => {
    for (const line of ["George needs to pick.", "Still open: his picks.", "The captain has a call.", "He needs to reply."]) {
      expect(aboutHim(line)).toBe(true);
      expect(aboutHim(toYou(line))).toBe(false);
    }
    expect(aboutHim("You need to pick.")).toBe(false);
  });
});
