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
    expect(toYou("Does George want index.html updated?")).toBe("Do you want index.html updated?");
    expect(toYou("Is George OK with v2.1?")).toBe("Are you OK with v2.1?");
    expect(toYou("Does the captain want v5.2 or v6?")).toBe("Do you want v5.2 or v6?");
    expect(toYou("When does George want the deck?")).toBe("When do you want the deck?");
    expect(toYou("What does the captain think of v2?")).toBe("What do you think of v2?");
    expect(toYou("Why is George blocked?")).toBe("Why are you blocked?");
    expect(toYou("Which version has George picked?")).toBe("Which version have you picked?");
    expect(toYou("The owner is George.")).toBe("The owner is you.");
    expect(toYou("Ship it, or does George want another round?")).toBe("Ship it, or do you want another round?");
    expect(toYou("Tests are green; is George happy to merge?")).toBe("Tests are green; are you happy to merge?");
    expect(toYou("If v2 works, does the captain want v3 too?")).toBe("If v2 works, do you want v3 too?");
    expect(toYou("Send it for George to review.")).toBe("Send it for you to review.");
  });

  it("leaves other people and plain words alone", () => {
    expect(toYou("Mark sent his notes on the deck.")).toBe("Mark sent his notes on the deck.");
    expect(toYou("Pierre sent his feedback and he wants a call with him on Friday.")).toBe("Pierre sent his feedback and he wants a call with him on Friday.");
    expect(toYou("George asked Pierre to send his feedback, and he wants a call with him.")).toBe("You asked Pierre to send his feedback, and he wants a call with him.");
    expect(toYou("Pierre is waiting for George to get back to him.")).toBe("Pierre is waiting for you to get back to him.");
    expect(toYou("Mark wants George to give him feedback.")).toBe("Mark wants you to give him feedback.");
    expect(toYou("George asked about Pierre. He wants a call with him.")).toBe("You asked about Pierre. He wants a call with him.");
    expect(toYou("The work for the team is done.")).toBe("The work for the team is done.");
    expect(toYou("")).toBe("");
  });

  it("finds third-person lines so none reaches him", () => {
    for (const line of ["George needs to pick.", "Still open: his picks.", "The captain has a call.", "Waiting on his go-ahead."]) {
      expect(aboutHim(line)).toBe(true);
      expect(aboutHim(toYou(line))).toBe(false);
    }
    expect(aboutHim("You need to pick.")).toBe(false);
  });
});

describe("toYou grammar seen in real cards", () => {
  it("never says 'is you' or 'you acts'", () => {
    expect(toYou("Question: is George done looking, so it can be stopped?")).toBe("Question: are you done looking, so it can be stopped?");
    expect(toYou("It cannot launch until George acts on it.")).toBe("It cannot launch until you act on it.");
    expect(toYou("Mark has George on the guest list.")).toBe("Mark has you on the guest list.");
    expect(toYou("The invite was George and Pierre.")).toBe("The invite was you and Pierre.");
    expect(toYou("Is George happy with v2?")).toBe("Are you happy with v2?");
    expect(toYou("Does George want index.html updated?")).toBe("Do you want index.html updated?");
    expect(toYou("Is George OK with v2.1?")).toBe("Are you OK with v2.1?");
    expect(toYou("Does the captain want v5.2 or v6?")).toBe("Do you want v5.2 or v6?");
    expect(toYou("When does George want the deck?")).toBe("When do you want the deck?");
    expect(toYou("What does the captain think of v2?")).toBe("What do you think of v2?");
    expect(toYou("Why is George blocked?")).toBe("Why are you blocked?");
    expect(toYou("Which version has George picked?")).toBe("Which version have you picked?");
    expect(toYou("The owner is George.")).toBe("The owner is you.");
    expect(toYou("Ship it, or does George want another round?")).toBe("Ship it, or do you want another round?");
    expect(toYou("Tests are green; is George happy to merge?")).toBe("Tests are green; are you happy to merge?");
    expect(toYou("If v2 works, does the captain want v3 too?")).toBe("If v2 works, do you want v3 too?");
  });
});

describe("toYou for every way he is named", () => {
  it("turns he, him and his to you and your once he is named, when no one else is", () => {
    expect(toYou("George said he wants the blue one before his trip.")).toBe("You said you want the blue one before your trip.");
    expect(toYou("George told me he's flying out, so book him a car.")).toBe("You told me you're flying out, so book you a car.");
    expect(toYou("George needs the deck before he leaves, and he'll sign it himself.")).toBe("You need the deck before you leave, and you'll sign it yourself.");
    // Someone else named in the sentence may be who "he" is.
    expect(toYou("George asked Pierre to send his feedback, and he wants a call with him.")).toBe("You asked Pierre to send his feedback, and he wants a call with him.");
    expect(toYou("Anna told George he could call.")).toBe("Anna told you he could call.");
    // Someone of his named by a relation or role may be who "he" is.
    expect(toYou("George's brother called and he wants a lift.")).toBe("Your brother called and he wants a lift.");
    expect(toYou("George's client said he will pay on Friday.")).toBe("Your client said he will pay on Friday.");
    // A "he" before he is named is someone else's.
    expect(toYou("He said George wants the blue one.")).toBe("He said you want the blue one.");
  });

  it("never rewrites someone else's message to him or his full name", () => {
    expect(toYou("Anna: Hi George, can you call?")).toBe("Anna: Hi George, can you call?");
    expect(toYou("Invoice to George Gally for the March work.")).toBe("Invoice to George Gally for the March work.");
    expect(toYou("Mark wrote \"George needs to sign\" and George has not yet.")).toBe("Mark wrote \"George needs to sign\" and you have not yet.");
    expect(aboutHim("Anna: Hi George, can you call?")).toBe(false);
  });
});
