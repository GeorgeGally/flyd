import { describe, expect, it } from "vitest";
import { plainTitle, saysNothing } from "../plain-words.js";

describe("plain titles for the right column", () => {
  it("turns the old hand-off shape into what is being carried out, on its project", () => {
    // The shape Core used to send to firstmate as a task's outcome.
    expect(plainTitle("Act on George's answer to: Which one(s) to build for real, or another round?", "flyd")).toBe("Carrying out your choice on flyd");
    expect(plainTitle("Act on George's answer to: which size?", "flyd")).toBe("Carrying out your choice on flyd");
    expect(plainTitle("Act on George's answer to: which size?")).toBe("Carrying out the choice you made");
    // A row already written plainly is left as it is.
    expect(plainTitle("Carry out your pick: V5 framed hero", "hftw")).toBe("Carry out your pick: V5 framed hero");
  });

  it("never names George or the captain", () => {
    expect(plainTitle("George's landing page is ready")).toBe("Your landing page is ready");
    expect(plainTitle("Restyle the shop for the captain")).toBe("Restyle the shop for you");
    expect(plainTitle("Self-improvement for Flyd: stop repeating lines")).toBe("Stop repeating lines");
    expect(plainTitle("Act on Flyd's note about task hftw-hero: swap the hero")).toBe("Swap the hero");
    expect(plainTitle("Act on: swap the hero")).toBe("Swap the hero");
    // Only the framing goes: a title that merely starts with the same letters keeps every word.
    expect(plainTitle("Act once the review lands")).toBe("Act once the review lands");
    expect(plainTitle("Act only on green CI")).toBe("Act only on green CI");
    // A decision's own question keeps its question mark: it is the ask, not a report.
    expect(plainTitle("Which hero should the shop use?")).toBe("Which hero should the shop use?");
  });

  it("drops a line that only names the thing it sits under", () => {
    expect(saysNothing("The thread itself.")).toBe(true);
    expect(saysNothing("Worth a look")).toBe(false);
    expect(saysNothing("")).toBe(true);
    expect(saysNothing("Charlie Brown Halloween GIF")).toBe(false);
    expect(saysNothing("2 stories from your sources.")).toBe(false);
    expect(saysNothing("Turning scattered contacts into deals")).toBe(false);
  });
});
