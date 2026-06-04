import { describe, it, expect } from "vitest";
import { similarity, tokenize } from "../dedup.js";

describe("tokenize", () => {
  it("splits text into lowercase word tokens", () => {
    const result = tokenize("Hello World Test");
    expect(result).toEqual(new Set(["hello", "world", "test"]));
  });

  it("filters out words shorter than 3 characters", () => {
    const result = tokenize("a an the cat dog bird");
    expect(result).toEqual(new Set(["the", "cat", "dog", "bird"]));
  });

  it("removes punctuation", () => {
    const result = tokenize("hello, world! test...");
    expect(result).toEqual(new Set(["hello", "world", "test"]));
  });

  it("returns empty set for short text", () => {
    const result = tokenize("a b c");
    expect(result.size).toBe(0);
  });

  it("returns empty set for empty string", () => {
    const result = tokenize("");
    expect(result.size).toBe(0);
  });
});

describe("similarity", () => {
  it("returns 1 for identical strings", () => {
    expect(similarity("hello world", "hello world")).toBe(1);
  });

  it("returns 0 for completely different strings", () => {
    expect(similarity("hello world", "completely different content here")).toBe(0);
  });

  it("returns value between 0 and 1 for partially similar strings", () => {
    const score = similarity("Senior Developer at Acme", "Senior Developer at Beta");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("ignores case and punctuation", () => {
    const score = similarity("Hello, World!", "hello world");
    expect(score).toBe(1);
  });

  it("returns 0 when one string has only short words", () => {
    expect(similarity("a b c", "hello world test")).toBe(0);
  });

  it("handles empty strings", () => {
    expect(similarity("", "")).toBe(0);
    expect(similarity("hello", "")).toBe(0);
    expect(similarity("", "hello")).toBe(0);
  });
});
