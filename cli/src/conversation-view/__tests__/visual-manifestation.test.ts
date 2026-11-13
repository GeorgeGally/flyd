import { describe, expect, it } from "vitest";
import { answerBody, answerHtml, plainAnswer } from "../answer-form.js";
import { reshapeAnswer } from "../answer-shape.js";
import { meaningOf } from "../screen/meaning.js";
import type { SemanticObject } from "../semantic.js";

const obj: SemanticObject = {
  id: "answer-1", kind: "conversation", lifecycle: "resolved",
  subject: "Design references", summary: "A useful starting point",
  evidence: [], actions: [], source: { showItemId: "answer-1" },
};

describe("Flyd's context-appropriate presentation", () => {
  it("renders actual image references as a responsive visual gallery", () => {
    const body = answerBody({
      form: "gallery",
      lead: "These two references fit the design direction.",
      items: [
        { title: "Reference A", imageUrl: "https://example.com/a.jpg", description: "Editorial negative space", sourceUrl: "https://example.com/source-a" },
        { title: "Reference B", imageUrl: "https://example.com/b.jpg", description: "Subtle typography" },
      ],
    });
    expect(body.form).toBe("gallery");
    expect(answerHtml(body)).toContain('data-form="gallery"');
    expect(answerHtml(body)).toContain("<img");
    expect(answerHtml(body)).toContain('loading="lazy"');
    expect(plainAnswer(body)).toContain("Editorial negative space");
    expect(meaningOf(obj, body)).toBe("artefact");
  });

  it("rejects fabricated/unsafe image URLs and leaves prose as the fallback", () => {
    for (const imageUrl of ["javascript:alert(1)", "file:///etc/passwd", 'https://example.com/" onerror="alert(1)']) {
      const body = answerBody({
        form: "gallery", lead: "References",
        items: [
          { title: "A", imageUrl, description: "Image" },
          { title: "B", imageUrl: "https://example.com/b.jpg", description: "Image" },
        ],
      });
      expect(body.form).toBe("prose");
    }
  });

  it("renders grounded personal context without inventing unknown relationships", () => {
    const body = answerBody({
      form: "briefing", lead: "Before the call",
      facts: [
        { label: "Last conversation", value: "Discussed the proposal", source: "Verified notes", asOf: "2026-11-02" },
        { label: "Your follow-up", value: "Send the revised outline" },
      ],
    });
    expect(body.form).toBe("briefing");
    expect(answerHtml(body)).toContain("Verified notes");
    expect(plainAnswer(body)).toContain("Send the revised outline");
    expect(meaningOf(obj, body)).toBe("briefing");
  });

  it("refuses unsourced image links during model reshaping", async () => {
    const answer = "Useful example: https://example.com/real.jpg";
    const shaped = await reshapeAnswer("Show me examples", answer, "gallery", async () =>
      JSON.stringify({ lead: "References", items: [
        { title: "Real", imageUrl: "https://example.com/real.jpg", description: "real" },
        { title: "Invented", imageUrl: "https://example.com/not-in-source.jpg", description: "fictional" },
      ] }));
    expect(shaped).toBeNull();
  });

  it("refuses personal facts invented during reshaping", async () => {
    const answer = "You discussed the proposal last week.";
    const shaped = await reshapeAnswer("Prepare my call", answer, "briefing", async () =>
      JSON.stringify({ lead: "Before the call", facts: [
        { label: "Last topic", value: "You discussed the proposal last week." },
        { label: "Children", value: "Chris has three children." },
      ] }));
    expect(shaped).toBeNull();
  });

  it("escapes external text before it reaches the view", () => {
    const body = answerBody({
      form: "briefing", lead: '<script>alert("bad")</script>',
      facts: [{ label: "<b>test</b>", value: '" onmouseover="bad' }],
    });
    const html = answerHtml(body);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>test</b>");
    expect(html).not.toContain('value="" onmouseover');
  });
});
