import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { kindOfText, plainLine, reachesGeorge, REACHES_HIM } from "../reaches-george.js";
import { DEFAULT_SOUL } from "../soul.js";

// What George saw on 2026-10-18, under "Good news, sir.".
const FLEET_FAULT = "I couldn't read firstmate's fleet just now (Command failed: /Users/george/Documents/firstmate/bin/fm-bearings-snapshot.sh --json).";

describe("the gate", () => {
  it("keeps internal faults, stale readings, staff silence and routine work from him, with how Flyd handles each", () => {
    expect(reachesGeorge({ kind: "fault", text: "The fleet read timed out." }, "panel")).toEqual({ reach: false, kind: "fault", handle: "repair" });
    expect(reachesGeorge({ kind: "stale", text: "The fleet snapshot is two hours old." }, "panel")).toEqual({ reach: false, kind: "stale", handle: "repair" });
    expect(reachesGeorge({ kind: "silence", text: "2 notes you sent are still waiting." }, "notice")).toEqual({ reach: false, kind: "silence", handle: "chase" });
    expect(reachesGeorge({ kind: "routine", text: "Merged the routine dependency bump." }, "notification")).toEqual({ reach: false, kind: "routine", handle: "settle" });
  });

  it("reads the words too: a fault or a nag called finished work, status or a blocker is still Flyd's own", () => {
    expect(reachesGeorge({ kind: "status", text: FLEET_FAULT }, "panel")).toMatchObject({ reach: false, kind: "fault", handle: "repair" });
    expect(reachesGeorge({ kind: "deliverable", text: "Work hit a problem: Command failed: npm test exited with code 1" }, "notification")).toMatchObject({ reach: false, kind: "fault" });
    expect(reachesGeorge({ kind: "blocker", text: "spawn fm-inbox.sh ENOENT" }, "notification")).toMatchObject({ reach: false, kind: "fault" });
    expect(reachesGeorge({ kind: "deliverable", text: "I've heard nothing back on \"Fix the footer\" for 3 h." }, "notification")).toMatchObject({ reach: false, kind: "silence", handle: "chase" });
    expect(reachesGeorge({ kind: "status", text: "Queued for a next step" }, "status")).toMatchObject({ reach: false, kind: "silence" });
    expect(kindOfText("The island now shows plan limits.")).toBeUndefined();
  });

  it("lets every whitelisted kind reach him, pushed or on screen, as one plain line", () => {
    for (const kind of ["decision", "deliverable", "blocker", "credential", "irreversible"] as const) {
      for (const surface of ["notification", "notice", "panel", "status"] as const) {
        expect(reachesGeorge({ kind, text: "The Kinsta login\nhas expired." }, surface)).toEqual({ reach: true, kind, line: "The Kinsta login has expired." });
      }
    }
  });

  it("never loses his call, even when it carries error text: it reaches him without the machinery", () => {
    expect(reachesGeorge({ kind: "decision", text: "Publish the GNM page now (Command failed: /tmp/x.sh --json)?" }, "notification"))
      .toEqual({ reach: true, kind: "decision", line: "Publish the GNM page now?" });
  });

  it("shows where work stands only on a screen he opened, never pushed at him", () => {
    const line = { kind: "status" as const, text: "3 jobs under way." };
    expect(reachesGeorge(line, "panel").reach).toBe(true);
    expect(reachesGeorge(line, "status").reach).toBe(true);
    expect(reachesGeorge(line, "notification")).toEqual({ reach: false, kind: "status", handle: "settle" });
    expect(reachesGeorge(line, "notice").reach).toBe(false);
  });

  it("says a line with no paths, flags or error asides, and keeps links whole", () => {
    expect(plainLine("Saved the report to ~/Documents/firstmate/data/gnm/report.md for you.")).toBe("Saved the report to report.md for you.");
    expect(plainLine("Read it with fm-bearings-snapshot --json now")).toBe("Read it with fm-bearings-snapshot now");
    expect(plainLine("Landed (exit code 1 on the first try): https://github.com/GeorgeGally/flyd/pull/174")).toBe("Landed: https://github.com/GeorgeGally/flyd/pull/174");
    expect(plainLine("Dark mode is merged (with a test).")).toBe("Dark mode is merged (with a test).");
  });

  it("holds a line that is nothing but machinery as a fault", () => {
    expect(reachesGeorge({ kind: "credential", text: "(Command failed: ENOENT) --json" }, "notification")).toEqual({ reach: false, kind: "fault", handle: "repair" });
  });
});

describe("Flyd's mission", () => {
  it("says who Flyd is, what it owns and that it handles everything internal itself", () => {
    expect(DEFAULT_SOUL).toMatch(/^You are Flyd, George's chief of staff\./);
    expect(DEFAULT_SOUL).toContain("Firstmate and the coding staff, the researchers and every background job are your staff");
    expect(DEFAULT_SOUL).toContain("You own outcomes, not messages.");
    expect(DEFAULT_SOUL).toMatch(/Internal failures, errors, timeouts, retries, stale or unreadable data: repair it, retry it, or work from the last good reading\. He never sees the error\./);
    expect(DEFAULT_SOUL).toMatch(/Silence from your staff, unread notes, overdue replies: chase them yourself, quietly, and keep chasing\./);
  });

  it("puts its prime directives in priority order: nothing irreversible without him, handle it yourself, report faithfully, speak only when it is worth it", () => {
    const directives = ["1. Never do anything destructive or irreversible", "2. Handle it yourself.", "3. Report outcomes faithfully.", "4. Speak to him only when it is worth his attention"];
    const at = directives.map((directive) => DEFAULT_SOUL.indexOf(directive));
    expect(at.every((index) => index > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("lists exactly what the gate lets reach him, and how it must read", () => {
    const listed = DEFAULT_SOUL.slice(DEFAULT_SOUL.indexOf("What reaches George, and nothing else"), DEFAULT_SOUL.indexOf("\nVoice\n"));
    expect(listed.split("\n").filter((line) => line.startsWith("- "))).toEqual(REACHES_HIM.map((item) => `- ${item.says}`));
    expect(listed).toContain("no paths, commands, error text, task ids, branches or internal machinery");
  });

  it("keeps his voice rules", () => {
    for (const rule of ["Say \"I\" and mean it.", "Never name helpers or describe internal machinery", "Weekends and evenings are lighter.", "Never invent facts about his life."]) {
      expect(DEFAULT_SOUL).toContain(rule);
    }
  });

  it("is the same contract in the repository's SOUL.md", () => {
    const repo = readFileSync(fileURLToPath(new URL("../../../../SOUL.md", import.meta.url)), "utf8");
    const contract = DEFAULT_SOUL.slice(DEFAULT_SOUL.indexOf("Who you are"), DEFAULT_SOUL.indexOf("\nVoice\n"));
    for (const line of contract.split("\n").filter((text) => /^(?:- |\d\. )/.test(text))) expect(repo).toContain(line);
  });
});
