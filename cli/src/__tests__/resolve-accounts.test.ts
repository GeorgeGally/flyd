import { describe, expect, it, vi } from "vitest";
import { resolve, type ManifestRequest } from "../resolve.js";
import { answerAccountIntent } from "../connectors/invocation.js";
vi.mock("../connectors/invocation.js", async importOriginal => {
  const original = await importOriginal<typeof import("../connectors/invocation.js")>();
  return { ...original, answerAccountIntent: vi.fn(async () => "Found the Nuanu email in work and proposal in personal Drive.") };
});
const base: ManifestRequest = {
  invocation_id: "inv-account", environment_revision: 7, intent: "Find the Nuanu email and Google Drive proposal", modality: "voice",
  environment: { application: { bundle_id: "com.apple.mail", name: "Mail" }, window: { ref: "w", title: "Inbox" }, focused_element: { ref: "e", role: "AXTextArea", value: "", selected_text: "", placeholder: "", description: "Body" }, selection: "", sufficiency: "semantic" },
  invocation_fingerprint: { app: "Mail", window: "w", element: "e" },
};
describe("account requests through Mac resolution", () => {
  it.each(["text", "voice"] as const)("routes %s lookups through the connectors and returns an augment, not a typing operation", async modality => {
    vi.mocked(answerAccountIntent).mockClear();
    const result = await resolve({ ...base, modality });
    expect(answerAccountIntent).toHaveBeenCalledWith(base.intent, "");
    expect(result.mode).toBe("requires_augment");
    expect(result.operations).toEqual([]);
    expect(result.environmentRevision).toBe(7);
    expect(result.augmentations?.[0].content).toContain("Nuanu email");
  });
});
