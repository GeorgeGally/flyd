import { describe, expect, it, vi } from "vitest";
import { showMacNotification } from "../mac-notifications.js";

describe.runIf(process.platform === "darwin")("Mac notifications prefer the Flyd adapter", () => {
  it("uses the adapter and skips the fallback when the adapter accepts it", async () => {
    const adapter = vi.fn(async (_title: string, _message: string) => true);
    const fallback = vi.fn(async (_title: string, _message: string) => {});
    await showMacNotification("Flyd", "hello", { adapter, fallback });
    expect(adapter).toHaveBeenCalledWith("Flyd", "hello");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back with collapsed, 220-char-truncated text when the adapter is unavailable", async () => {
    const adapter = vi.fn(async (_title: string, _message: string) => false);
    const fallback = vi.fn(async (_title: string, _message: string) => {});
    await showMacNotification("Flyd", `hi\n\nthere ${"a".repeat(400)}`, { adapter, fallback });
    expect(fallback).toHaveBeenCalledTimes(1);
    const [ title, message ] = fallback.mock.calls[0];
    expect(title).toBe("Flyd");
    expect(message.length).toBe(220);
    expect(message.startsWith("hi there")).toBe(true);
  });
});
