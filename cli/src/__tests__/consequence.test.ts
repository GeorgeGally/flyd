import { describe, expect, it } from "vitest";
import { assessConsequence } from "../consequence.js";

describe("assessConsequence", () => {
  it.each([
    "delete the last sentence",
    "remove the second paragraph",
    "fix the spelling in this line",
    "rewrite this text to be friendlier",
    "delete that word",
    "can you tidy up the phrasing",
    "what is the capital of france",
    "reply saying yes that works for me",
  ])("benign: %s", (intent) => {
    expect(assessConsequence(intent).class, intent).toBe("benign");
  });

  it.each([
    "send the email",
    "delete the branch",
    "publish the post",
    "buy the ticket",
    "deploy to the production server",
    "cancel my subscription",
    "pay the invoice",
    "merge the pr",
    "delete the file",
  ])("consequential: %s", (intent) => {
    expect(assessConsequence(intent).class, intent).toBe("consequential");
  });

  it("treats irreversible verb + pronoun as consequential", () => {
    const result = assessConsequence("send it");
    expect(result.class).toBe("consequential");
    expect(result.target).toBe("unknown");
  });

  it("keeps 'send it' with a textual object benign", () => {
    expect(assessConsequence("send it as a shorter sentence").class).toBe("benign");
  });

  it("classifies file-system targets", () => {
    expect(assessConsequence("delete the folder").target).toBe("file_system");
  });

  it("classifies external-system targets with verbs", () => {
    const result = assessConsequence("send the email to bob");
    expect(result.target).toBe("external_system");
    expect(result.verbs).toContain("send");
  });

  it("does not mark delegation intents as automatically consequential", () => {
    expect(assessConsequence("delegate the deploy").class).toBe("benign");
  });

  it("always reports heuristic source", () => {
    expect(assessConsequence("send the email").source).toBe("heuristic");
    expect(assessConsequence("hello there").source).toBe("heuristic");
  });
});
