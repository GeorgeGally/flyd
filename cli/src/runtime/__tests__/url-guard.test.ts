import { describe, expect, it } from "vitest";
import { fetchPublicUrl, isPrivateAddress, publicUrlProblem } from "../url-guard.js";

const publicLookup = async () => ["93.184.216.34"];

describe("publicUrlProblem", () => {
  it.each([
    ["http://localhost:4815/manifest", /local or private host/],
    ["http://127.0.0.1:4815/manifest", /private or local address/],
    ["http://169.254.169.254/latest/meta-data/", /private or local address/],
    ["http://[::1]:3000/", /private or local address/],
    ["http://192.168.1.10/admin", /private or local address/],
    ["http://printer.local/", /local or private host/],
    ["file:///etc/passwd", /file: URLs are not allowed/],
    ["https://user:pass@example.com/", /embedded credentials/],
  ])("blocks %s", async (url, reason) => {
    expect(await publicUrlProblem(url, publicLookup)).toMatch(reason);
  });

  it("blocks public names that resolve to private addresses (DNS rebinding)", async () => {
    expect(await publicUrlProblem("https://evil.example/", async () => ["10.0.0.5"]))
      .toBe("evil.example resolves to private address 10.0.0.5");
  });

  it("allows the public web", async () => {
    expect(await publicUrlProblem("https://www.formula1.com/en/results", publicLookup)).toBeNull();
    expect(await publicUrlProblem("https://1.1.1.1/", publicLookup)).toBeNull();
  });

  it("classifies addresses", () => {
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("fd12:3456::1")).toBe(true);
    expect(isPrivateAddress("100.100.1.1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });
});

describe("fetchPublicUrl", () => {
  it("re-checks every redirect hop and refuses a redirect into the private network", async () => {
    const requested: string[] = [];
    const fetchFn = async (url: string) => {
      requested.push(url);
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:4815/manifest" } });
    };
    await expect(fetchPublicUrl(fetchFn, "https://example.com/start", { lookup: publicLookup }))
      .rejects.toThrow("Blocked http://127.0.0.1:4815/manifest");
    expect(requested).toEqual(["https://example.com/start"]);
  });

  it("follows public redirects without sending credentials", async () => {
    const inits: RequestInit[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      inits.push(init ?? {});
      return url.endsWith("/a")
        ? new Response(null, { status: 301, headers: { location: "/b" } })
        : new Response("final", { status: 200 });
    };
    const response = await fetchPublicUrl(fetchFn, "https://example.com/a", { lookup: publicLookup });
    expect(await response.text()).toBe("final");
    expect(inits.every((init) => init.credentials === "omit" && init.redirect === "manual")).toBe(true);
  });
});
