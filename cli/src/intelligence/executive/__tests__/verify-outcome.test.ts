import { expect, it, vi } from "vitest";
import { GitHubRestAdapter } from "../../../evidence/adapters/github-rest.js";
import { verifyStaffOutcome } from "../verify-outcome.js";

it("checks the forge through the existing evidence adapter instead of trusting a completed label or evidence list", async () => {
  const locator = "https://github.com/example/project/pull/5";
  const calls: string[] = [];
  const adapter = new GitHubRestAdapter({ fetchFn: async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ id: 5, number: 5, title: "Keep the launch date visible", html_url: locator, merged: true, merge_commit_sha: "a".repeat(40) }), { status: 200 });
  } });
  const result = await verifyStaffOutcome(["completed", "Checks green", locator], (url) => adapter.read({ locator: url }));
  expect(calls).toEqual(["https://api.github.com/repos/example/project/pulls/5"]);
  expect(result).toEqual({ status: "verified", evidenceRefs: [locator, `github-merge:${"a".repeat(40)}`], summary: "The change is merged: Keep the launch date visible" });
});

it("keeps an open PR and unsupported or local evidence unverified without following arbitrary addresses", async () => {
  const read = vi.fn(async () => []);
  expect(await verifyStaffOutcome(["completed", "http://127.0.0.1:4815/secrets", "/Users/private/report.md"], read)).toEqual({ status: "unknown", evidenceRefs: [] });
  expect(read).not.toHaveBeenCalled();
  const locator = "https://github.com/example/project/pull/5";
  const adapter = new GitHubRestAdapter({ fetchFn: async () => new Response(JSON.stringify({ id: 5, number: 5, html_url: locator, merged: false }), { status: 200 }) });
  expect(await verifyStaffOutcome([locator], (url) => adapter.read({ locator: url }))).toEqual({ status: "unknown", evidenceRefs: [] });
});
