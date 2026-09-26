import { describe, expect, it } from "vitest";
import { decideToolCall, isReadOnlyCommand, marksTurnUntrusted } from "../tool-policy.js";

describe("isReadOnlyCommand", () => {
  it.each([
    "git status --short",
    "git -C /tmp/repo log --oneline -5",
    "ls -la && cat README.md | head -20",
    "rg -n pattern src | wc -l",
    "TZ=America/New_York date '+%H:%M'",
    "npm test",
    "npm run lint",
    "npx tsc --noEmit",
    "sed -n 1,20p file.ts",
    "find . -name '*.ts' -maxdepth 2",
    "git diff --stat 2>/dev/null",
    "git branch -a",
    "git ls-files --others -z | xargs -0 du -sh 2>/dev/null | sort -h",
    "git add -A --dry-run",
    "rustc --version",
    "which cargo && cargo -V",
  ])("allows %j", (command) => {
    expect(isReadOnlyCommand(command)).toBe(true);
  });

  it.each([
    "git fetch origin",
    "git commit -am wip",
    "git branch -D old",
    "git stash",
    "npm install left-pad",
    "echo hi > notes.txt",
    "sed -i '' s/a/b/ file",
    "find . -name '*.log' -delete",
    "curl -X POST https://example.com",
    "osascript -e 'tell application \"Mail\" to send'",
    "cat $(echo secret)",
    "ls; rm notes.txt",
    "find . -name '*.tmp' | xargs rm",
    "npm version patch",
    "node -e \"require('fs').writeFileSync('x','y')\"",
  ])("requires approval for %j", (command) => {
    expect(isReadOnlyCommand(command)).toBe(false);
  });
});

describe("decideToolCall", () => {
  const clean = { tainted: false };
  const tainted = { tainted: true };

  it("lets inspection and repo edits run in a clean turn", () => {
    expect(decideToolCall("read_file", { path: "a" }, clean)).toEqual({ kind: "allow" });
    expect(decideToolCall("edit_file", { path: "a" }, clean)).toEqual({ kind: "allow" });
    expect(decideToolCall("reminders", { action: "create", title: "x" }, clean)).toEqual({ kind: "allow" });
    expect(decideToolCall("bash", { command: "git log -3" }, clean)).toEqual({ kind: "allow" });
  });

  it("asks before any state change after web content was read", () => {
    for (const [name, input] of [
      ["edit_file", { path: "a" }],
      ["write_file", { path: "a" }],
      ["remember", { text: "x" }],
      ["reminders", { action: "create", title: "x" }],
    ] as const) {
      expect(decideToolCall(name, input, tainted).kind).toBe("confirm");
    }
    expect(decideToolCall("reminders", { action: "list" }, tainted)).toEqual({ kind: "allow" });
    expect(decideToolCall("bash", { command: "git status" }, tainted)).toEqual({ kind: "allow" });
  });

  it("flags destructive commands distinctly", () => {
    const decision = decideToolCall("bash", { command: "rm -rf build" }, clean);
    expect(decision).toEqual({ kind: "confirm", reason: "destructive command: rm -rf build" });
  });

  it("treats web tools as untrusted sources", () => {
    expect(marksTurnUntrusted("read_url")).toBe(true);
    expect(marksTurnUntrusted("web_search")).toBe(true);
    expect(marksTurnUntrusted("read_file")).toBe(false);
  });
});
