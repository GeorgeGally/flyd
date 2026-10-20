import { beforeEach, describe, expect, it, vi } from "vitest";

const { connect, stop, paired } = vi.hoisted(() => ({
  connect: vi.fn(),
  stop: vi.fn(),
  paired: vi.fn(() => false),
}));

vi.mock("../whatsapp.js", () => ({ whatsappClient: () => ({ connect, stop, paired }) }));

const { WhatsAppPairing } = await import("../whatsapp-pairing.js");

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("the pairing session", () => {
  beforeEach(() => { connect.mockReset(); stop.mockReset(); paired.mockReset(); paired.mockReturnValue(false); });

  it("releases the socket when a pairing attempt ends without a link", async () => {
    connect.mockRejectedValue(new Error("WhatsApp connection timed out"));
    const pairing = new WhatsAppPairing();
    pairing.start();
    await flush();
    expect(stop).toHaveBeenCalled();
    expect(pairing.state().paired).toBe(false);
  });

  it("keeps the socket after a link so the first history can land", async () => {
    connect.mockResolvedValue(undefined);
    const pairing = new WhatsAppPairing();
    pairing.start();
    await flush();
    expect(pairing.state().paired).toBe(true);
    expect(stop).not.toHaveBeenCalled();
  });
});
