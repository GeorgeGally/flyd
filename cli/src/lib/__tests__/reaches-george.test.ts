import { describe, expect, it } from "vitest";
import { plainLine, reachesGeorge, REACHES_HIM, untaggedKind } from "../reaches-george.js";
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

  it("goes by the kind its producer gave, never by the words: finished work that names a fixed error still reaches him", () => {
    expect(reachesGeorge({ kind: "fault", text: FLEET_FAULT }, "panel")).toEqual({ reach: false, kind: "fault", handle: "repair" });
    expect(reachesGeorge({ kind: "deliverable", text: "Fixed the TypeError on the settings page." }, "notification"))
      .toEqual({ reach: true, kind: "deliverable", line: "Fixed the TypeError on the settings page." });
    expect(reachesGeorge({ kind: "deliverable", text: "Flyd no longer couldn't read the state file." }, "notification")).toMatchObject({ reach: true, kind: "deliverable" });
    expect(reachesGeorge({ kind: "blocker", text: "The deploy is blocked (Command failed: npm test exited with code 1). Tell me whether to drop it." }, "notification"))
      .toEqual({ reach: true, kind: "blocker", line: "The deploy is blocked. Tell me whether to drop it." });
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
    expect(plainLine("Fixed the /api/status 500 and the and/or check")).toBe("Fixed the /api/status 500 and the and/or check");
    expect(plainLine("Wrote /Users/george/notes/today and …/bin/fm-inbox.sh and /docs/product/plan.md")).toBe("Wrote today and fm-inbox.sh and plan.md");
  });

  it("holds an untagged post that reports Flyd's own failure, and takes any other untagged post as finished work", () => {
    // The exact probe posted to Core's /notify with no kind.
    const probe = "Good news, sir. I couldn't read firstmate's fleet just now (Command failed: …/fm-bearings-snapshot.sh --json)";
    expect(reachesGeorge({ kind: untaggedKind(probe), text: probe }, "notification")).toEqual({ reach: false, kind: "fault", handle: "repair" });
    expect(untaggedKind("Command failed: npm test")).toBe("fault");
    expect(untaggedKind("I was unable to open the draft.")).toBe("fault");
    const done = "The GNM page is live.";
    expect(reachesGeorge({ kind: untaggedKind(done), text: done }, "notification")).toEqual({ reach: true, kind: "deliverable", line: done });
  });

  it("holds a line that is nothing but machinery as a fault", () => {
    expect(reachesGeorge({ kind: "credential", text: "(Command failed: ENOENT) --json" }, "notification")).toEqual({ reach: false, kind: "fault", handle: "repair" });
  });
});

describe("Flyd's mission", () => {
  it("lists exactly what the gate lets reach him", () => {
    const listed = DEFAULT_SOUL.slice(DEFAULT_SOUL.indexOf("What reaches George, and nothing else"), DEFAULT_SOUL.indexOf("\nVoice\n"));
    expect(listed.split("\n").filter((line) => line.startsWith("- "))).toEqual(REACHES_HIM.map((item) => `- ${item.says}`));
  });
});
