import { describe, it, expect } from "vitest";
import { serialize, parse } from "../frontmatter.js";

describe("serialize", () => {
  it("produces valid frontmatter with metadata and body", () => {
    const result = serialize({ type: "career", status: "working" }, "# Title\n\nBody text.");
    expect(result).toMatch(/^---\n/);
    expect(result).toContain("type: career");
    expect(result).toContain("status: working");
    expect(result).toContain("# Title");
    expect(result).toContain("Body text.");
    expect(result).toMatch(/\n---\n\n/);
  });

  it("serializes list values as indented items", () => {
    const result = serialize({ source: ["raw/a.md", "raw/b.md"] }, "body");
    expect(result).toContain("source:\n  - raw/a.md\n  - raw/b.md");
  });

  it("handles empty metadata", () => {
    const result = serialize({}, "just body");
    expect(result).toBe("---\n---\n\njust body");
  });

  it("handles empty body", () => {
    const result = serialize({ key: "val" }, "");
    expect(result).toBe("---\nkey: val\n---\n\n");
  });

  it("serializes boolean values", () => {
    const result = serialize({ active: true, verified: false }, "body");
    expect(result).toContain("active: true");
    expect(result).toContain("verified: false");
  });

  it("serializes numeric values", () => {
    const result = serialize({ confidence: 0.85, count: 42 }, "body");
    expect(result).toContain("confidence: 0.85");
    expect(result).toContain("count: 42");
  });
});

describe("parse", () => {
  it("parses full frontmatter with body", () => {
    const content = `---
type: career
status: working
confidence: 0.9
---

# Title

Body text.`;
    const result = parse(content);
    expect(result.metadata).toEqual({
      type: "career",
      status: "working",
      confidence: 0.9,
    });
    expect(result.body).toBe("# Title\n\nBody text.");
  });

  it("parses list values", () => {
    const content = `---
source:
  - raw/a.md
  - raw/b.md
---

body`;
    const result = parse(content);
    expect(result.metadata.source).toEqual(["raw/a.md", "raw/b.md"]);
  });

  it("parses booleans", () => {
    const content = "---\nactive: true\nverified: false\n---\n\nbody";
    const result = parse(content);
    expect(result.metadata.active).toBe(true);
    expect(result.metadata.verified).toBe(false);
  });

  it("parses numbers", () => {
    const content = "---\nconfidence: 0.75\ncount: 42\n---\n\nbody";
    const result = parse(content);
    expect(result.metadata.confidence).toBe(0.75);
    expect(result.metadata.count).toBe(42);
  });

  it("returns empty metadata for content without frontmatter", () => {
    const result = parse("just plain text\nno frontmatter");
    expect(result.metadata).toEqual({});
    expect(result.body).toBe("just plain text\nno frontmatter");
  });

  it("returns empty metadata for malformed frontmatter", () => {
    const result = parse("---\nno closing delimiter");
    expect(result.metadata).toEqual({});
    expect(result.body).toBe("---\nno closing delimiter");
  });

  it("returns empty metadata for empty string", () => {
    const result = parse("");
    expect(result.metadata).toEqual({});
    expect(result.body).toBe("");
  });

  it("handles colons in string values", () => {
    const content = "---\nnote: http://example.com\n---\n\nbody";
    const result = parse(content);
    expect(result.metadata.note).toBe("http://example.com");
  });

  it("handles single key-value metadata", () => {
    const content = "---\nstatus: canon\n---\n\nbody";
    const result = parse(content);
    expect(result.metadata).toEqual({ status: "canon" });
  });
});

describe("serialize + parse round-trip", () => {
  it("round-trips metadata and body", () => {
    const original = {
      type: "project",
      status: "working",
      confidence: 0.88,
      source: ["raw/input.md"],
      proposed_by: "Host",
    };
    const body = "# My Project\n\n- Built a thing.\n- Learned a lot.";
    const serialized = serialize(original, body);
    const parsed = parse(serialized);
    expect(parsed.metadata).toEqual(original);
    expect(parsed.body).toBe(body);
  });

  it("round-trips with empty body", () => {
    const meta = { key: "value" };
    const serialized = serialize(meta, "");
    const parsed = parse(serialized);
    expect(parsed.metadata).toEqual(meta);
    expect(parsed.body).toBe("");
  });

  it("round-trips with list values", () => {
    const meta = { source: ["raw/a.md", "raw/b.md", "raw/c.md"] };
    const serialized = serialize(meta, "body");
    const parsed = parse(serialized);
    expect(parsed.metadata.source).toEqual(["raw/a.md", "raw/b.md", "raw/c.md"]);
  });

  it("round-trips with boolean and numeric values", () => {
    const meta = { active: true, confidence: 0.95, count: 10 };
    const serialized = serialize(meta, "body text");
    const parsed = parse(serialized);
    expect(parsed.metadata.active).toBe(true);
    expect(parsed.metadata.confidence).toBe(0.95);
    expect(parsed.metadata.count).toBe(10);
  });

  it("round-trips object list arrays with multiple keys per object", () => {
    const meta = {
      links: [
        { target: "some-thing", type: "related", confidence: 1, extraction: "explicit_wikilink", proposed_by: "host", source: "raw/file.md" },
        { target: "another-thing", type: "reference", confidence: 0.8, source: "raw/other.md" },
      ],
    };
    const serialized = serialize(meta, "body");
    const parsed = parse(serialized);
    expect(parsed.metadata).toEqual(meta);
  });

  it("round-trips single object in object list array", () => {
    const meta = { obj: [{ a: 1, b: 2 }] };
    const serialized = serialize(meta, "body");
    const parsed = parse(serialized);
    expect(parsed.metadata).toEqual({ obj: [{ a: 1, b: 2 }] });
  });
});
