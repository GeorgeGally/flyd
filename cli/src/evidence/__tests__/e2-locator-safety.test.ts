import { describe, expect, it } from "vitest";
import { sanitizeEvidenceLocator } from "../evidence-need.js";

describe("E2 locator safety", () => {
  it("blocks localhost and private network URLs", () => {
    expect(sanitizeEvidenceLocator("http://localhost:3000/admin")).toBeNull();
    expect(sanitizeEvidenceLocator("http://127.0.0.1/private")).toBeNull();
    expect(sanitizeEvidenceLocator("http://192.168.1.5/status")).toBeNull();
    expect(sanitizeEvidenceLocator("http://10.0.0.2/internal")).toBeNull();
  });

  it("blocks credentials and signed query parameters", () => {
    expect(sanitizeEvidenceLocator("https://user:pass@example.com/page")).toBeNull();
    expect(sanitizeEvidenceLocator("https://example.com/page?access_token=secret")).toBeNull();
    expect(sanitizeEvidenceLocator("https://example.com/page?X-Amz-Signature=secret")).toBeNull();
  });

  it("keeps public URLs while stripping trackers and fragments", () => {
    expect(sanitizeEvidenceLocator("https://example.com/article?utm_source=x&section=2#comments"))
      .toBe("https://example.com/article?section=2");
  });
});
