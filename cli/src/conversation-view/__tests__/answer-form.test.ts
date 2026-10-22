import { describe, expect, it } from "vitest";
import { answerBody, answerHtml, diagnosisFromText, plainAnswer } from "../answer-form.js";
import { renderMarkdown } from "../markdown.js";

describe("answerBody", () => {
  it("keeps a string as prose, rendered exactly as the markdown it is", () => {
    const body = answerBody("**Merged.** PR #201 is green.");
    expect(body).toEqual({ lead: "**Merged.** PR #201 is green.", form: "prose" });
    expect(answerHtml(body)).toBe(renderMarkdown("**Merged.** PR #201 is green."));
  });

  it("falls back to prose for anything that is not a body", () => {
    expect(answerBody(undefined)).toEqual({ lead: "", form: "prose" });
    expect(answerBody({ lead: "Just a lead.", form: "diagnosis" })).toEqual({ lead: "Just a lead.", form: "prose" });
  });

  it("keeps a diagnosis only with parts, dropping empty ones", () => {
    const body = answerBody({
      lead: "The island filter is off.",
      form: "diagnosis",
      parts: [{ label: "Cause", text: "Filter paused on 14 Oct." }, { label: "", text: "x" }, { label: "Cost", text: "£0" }],
      evidence: [{ text: "island-filter.ts", url: "https://github.com/x/1" }, { text: "" }],
      next: "Turn it back on?",
    });
    expect(body.form).toBe("diagnosis");
    if (body.form !== "diagnosis") throw new Error("expected a diagnosis");
    expect(body.parts.map((part) => part.label)).toEqual(["Cause", "Cost"]);
    expect(body.evidence).toEqual([{ text: "island-filter.ts", url: "https://github.com/x/1" }]);
  });

  it("keeps a comparison only when every option covers every criterion", () => {
    const shape = {
      lead: "Pink, or blue.",
      form: "comparison",
      criteria: ["Warmth", "Legibility"],
      alternatives: [{ name: "Pink", values: ["high", "soft"] }, { name: "Blue", values: ["low", "sharp"] }],
      next: "Pick one.",
    };
    const body = answerBody(shape);
    expect(body).toEqual({ ...shape, criteria: shape.criteria });
    expect(plainAnswer(body)).toBe("Pink, or blue.\n\nWarmth\nPink: high\nBlue: low\n\nLegibility\nPink: soft\nBlue: sharp\n\nPick one.");
    expect(answerBody({ ...shape, alternatives: [...shape.alternatives, { name: "Grey", values: ["mid"] }] }))
      .toEqual({ lead: "Pink, or blue.", form: "prose" });
  });
});

describe("answerHtml", () => {
  it("draws a diagnosis as one labelled section, labels escaped and shown once each", () => {
    const html = answerHtml(answerBody({
      lead: "Two things.",
      form: "diagnosis",
      parts: [{ label: "Cause & fix", text: "Paused." }, { label: "Next", text: "Resume." }],
    }));
    expect(html).toContain('<section class="answer-form" data-form="diagnosis">');
    expect(html.match(/Cause &amp; fix/g)).toHaveLength(1);
    expect(html.match(/Resume\./g)).toHaveLength(1);
    expect(html).not.toContain("Cause & fix");
  });

  it("draws a comparison as one table, options across and criteria down", () => {
    const html = answerHtml(answerBody({
      lead: "Pink for reading, blue for counting.",
      form: "comparison",
      criteria: ["Warmth", "Legibility"],
      alternatives: [{ name: "Pink", values: ["high", "soft"] }, { name: "Blue", values: ["low", "sharp"] }],
    }));
    expect(html).toContain('<section class="answer-form" data-form="comparison">');
    expect(html.match(/<th scope="col">Pink<\/th>/)).toHaveLength(1);
    expect(html).toContain('<th scope="row">Legibility</th>');
    expect(html.match(/<td>sharp<\/td>/)).toHaveLength(1);
  });
});

describe("plainAnswer", () => {
  it("reads a diagnosis as lead, each part, evidence and next", () => {
    expect(plainAnswer(answerBody({
      lead: "Two things.",
      form: "diagnosis",
      parts: [{ label: "Cause", text: "Paused." }],
      evidence: [{ text: "island-filter.ts", url: "https://github.com/x/1" }],
      next: "Resume?",
    }))).toBe("Two things.\n\nCause\nPaused.\n\nisland-filter.ts (https://github.com/x/1)\n\nResume?");
  });
});

describe("diagnosisFromText", () => {
  it("reads the form the model declared, labels in order", () => {
    const body = diagnosisFromText([
      "**Diagnosis: PR #200 fixed the screen, not the draw path.**",
      "",
      "**Expected:** The panel would draw from the new surface.",
      "**Observed:** It mounted with nothing drawn.",
      "**Cause:** The renderer was never called.",
      "**Evidence:** `page.ts:1215` and the #200 diff.",
      "**Next:** Wire the call and add one test.",
    ].join("\n"));
    expect(body).toMatchObject({ form: "diagnosis", lead: "PR #200 fixed the screen, not the draw path." });
    if (body?.form !== "diagnosis") throw new Error("expected a diagnosis");
    expect(body.parts.map((part) => part.label)).toEqual(["Expected", "Observed", "Cause", "Evidence", "Next"]);
    expect(body.parts.at(-1)!.text).toBe("Wire the call and add one test.");
  });

  it("reads the five labels even when the model skips the Diagnosis opener", () => {
    const body = diagnosisFromText([
      "**Why the router fell back: Jev returned not ok.**",
      "",
      "**Expected:** every route went through Jev.",
      "**Observed:** the flash classifier answered.",
      "**Cause:** a non-ok result returns null.",
      "**Evidence:** `router.ts:121`.",
      "**Next:** log the reason.",
    ].join("\n"));
    expect(body).toMatchObject({ form: "diagnosis", lead: "Why the router fell back: Jev returned not ok." });
  });

  it("leaves prose alone, and a diagnosis missing a label falls back to it", () => {
    expect(diagnosisFromText("**Merged.** PR #201 is green.")).toBeNull();
    expect(diagnosisFromText("**Diagnosis: it broke.**\n\n**Cause:** a guess.")).toBeNull();
    expect(diagnosisFromText([
      "**Diagnosis: it broke.**",
      "**Expected:** a.",
      "**Observed:** b.",
      "**Cause:** c.",
      "**Evidence:** d.",
      "**Evidence:** again.",
    ].join("\n"))).toBeNull();
  });
});
