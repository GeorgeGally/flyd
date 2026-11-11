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
    expect(pairing.state()).toEqual({ paired: false, error: "WhatsApp connection timed out" });
  });

  it("says why the last try failed until George sets the offer aside", async () => {
    connect.mockRejectedValue(new Error("WhatsApp did not accept the link"));
    const pairing = new WhatsAppPairing();
    pairing.start(); await flush();
    connect.mockReturnValue(new Promise(() => {}));
    pairing.start(); await flush();
    expect(pairing.state().error).toBe("WhatsApp did not accept the link");
    pairing.stop();
    expect(pairing.state()).toEqual({ paired: false });
  });

  it("does not carry the stopped run's ending into the next Link WhatsApp", async () => {
    let reject: (error: Error) => void = () => {};
    connect.mockReturnValue(new Promise<void>((_, no) => { reject = no; }));
    stop.mockImplementation(() => reject(new Error("Linking was stopped.")));
    const pairing = new WhatsAppPairing();
    pairing.start(); await flush();
    pairing.stop(); await flush();
    connect.mockReturnValue(new Promise(() => {}));
    pairing.start(); await flush();
    expect(pairing.state()).toEqual({ paired: false });
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
