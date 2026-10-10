import { afterEach, describe, expect, it } from "vitest";
import { PreviewProbe } from "../preview-probe.js";

describe("PreviewProbe", () => {
  let probe: PreviewProbe | undefined;
  afterEach(() => probe?.close());

  it("is checking until the page answers, then up; a change is announced", async () => {
    probe = new PreviewProbe(async () => ({ status: 200 }));
    let changes = 0;
    probe.onChange(() => { changes += 1; });
    expect(probe.state("http://127.0.0.1:8097/")).toBe("checking");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(probe.state("http://127.0.0.1:8097/")).toBe("up");
    expect(changes).toBe(1);
  });

  it("calls a refused connection or a server error down", async () => {
    probe = new PreviewProbe(async (url) => {
      if (url.includes("8088")) throw new Error("ECONNREFUSED");
      return { status: 502 };
    });
    probe.state("http://127.0.0.1:8088/");
    probe.state("http://127.0.0.1:9000/");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(probe.state("http://127.0.0.1:8088/")).toBe("down");
    expect(probe.state("http://127.0.0.1:9000/")).toBe("down");
  });

  it("asks a page again only after the interval", async () => {
    let now = 1_000_000;
    let calls = 0;
    probe = new PreviewProbe(async () => { calls += 1; return { status: 404 }; }, () => now);
    probe.state("http://127.0.0.1:8097/");
    await new Promise((resolve) => setTimeout(resolve, 0));
    probe.state("http://127.0.0.1:8097/");
    expect(calls).toBe(1);
    now += 10_000;
    expect(probe.state("http://127.0.0.1:8097/")).toBe("up");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(2);
  });
});
