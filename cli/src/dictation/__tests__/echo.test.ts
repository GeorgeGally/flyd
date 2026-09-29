import { describe, expect, it } from "vitest";
import { isPromptEcho, removePromptEcho } from "../echo.js";
import { transcriptionPrompt } from "../vocabulary.js";

const prompt = transcriptionPrompt(["Flyd", "Posttraction", "Tastemaker", "Koko", "Little Organic Baby", "Gareth Chisholm", "CleanX", "Bloom"]);
const echo = "Flyd (pronounced Floyd) is George's AI assistant. Names and terms he uses: Flyd, Posttraction, Tastemaker, Koko, Little Organic Baby, Gareth Chisholm, CleanX, Bloom.";

describe("prompt echo", () => {
  it("drops a transcript that is the prompt read back", () => {
    expect(removePromptEcho(echo, prompt)).toBe("");
  });

  it("keeps what George said and drops the echoed sentences after it", () => {
    expect(removePromptEcho(`Ship the CleanX landing page today. ${echo}`, prompt)).toBe("Ship the CleanX landing page today.");
  });

  it("keeps speech that uses the same names", () => {
    const said = "Tell Koko and Gareth Chisholm that CleanX and Bloom are both launching this week.";
    expect(isPromptEcho(said, prompt)).toBe(false);
    expect(removePromptEcho(said, prompt)).toBe(said);
  });

  it("keeps short utterances", () => {
    expect(removePromptEcho("Flyd, CleanX.", prompt)).toBe("Flyd, CleanX.");
  });
});
