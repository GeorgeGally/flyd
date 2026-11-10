import { describe, expect, it } from "vitest";
import { asksWhy } from "../view.js";

describe("asksWhy", () => {
  it.each([
    "why is dragging pages in Logan so slow",
    "How come the build failed?",
    "what went wrong with the deploy",
    "The filter is off. What happened?",
    "so the router fell back, why?",
  ])("treats %j as a why-question", (question) => {
    expect(asksWhy(question)).toBe(true);
  });

  it.each([
    "no idea what happened but dragging pages in Logan is slow",
    "dragging pages in Logan is slow and unreliable",
    "not sure what went wrong, the build is red. fix it",
  ])("treats %j as a report", (question) => {
    expect(asksWhy(question)).toBe(false);
  });
});
