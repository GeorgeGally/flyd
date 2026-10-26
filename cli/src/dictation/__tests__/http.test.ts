import { describe, expect, it, vi } from "vitest";
import { dictationFetch } from "../http.js";

describe("dictation fetch", () => {
  it("retries once on a fresh connection when a pooled socket was already closed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const send = vi.fn()
      .mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } }))
      .mockResolvedValueOnce(new Response("ok"));
    const response = await dictationFetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST" }, send as unknown as typeof fetch);
    expect(await response.text()).toBe("ok");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![1]).not.toHaveProperty("dispatcher");
  });

  it("does not retry an aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const send = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(dictationFetch("https://x", { signal: controller.signal }, send as unknown as typeof fetch)).rejects.toThrow("fetch failed");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
