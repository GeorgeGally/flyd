import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { useWorkIndexPath, resetWorkIndexPath, closeDb } from "../../database.js";
import {
  readPresentModel,
  writePresentModel,
  appendCorrection,
  activeDemotions,
} from "../store.js";

describe("work hypothesis store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "flyd-wh-store-"));
    useWorkIndexPath(join(dir, "work-index.sqlite"));
  });

  afterEach(() => {
    closeDb();
    resetWorkIndexPath();
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a structured hypothesis", () => {
    const written = writePresentModel({
      hypothesisText: "Good Neighbours · CleanX look like tonight's active threads.",
      primaryThreads: [
        {
          root: "/tmp/gn",
          name: "Good Neighbours",
          lastCommitAt: "2026-08-12T10:00:00.000Z",
          isDirty: true,
          hasTasks: false,
          isForeground: false,
          signals: ["commit:2026-08-12T10:00:00.000Z"],
          demoted: false,
        },
      ],
      secondaryThreads: [],
      confidence: "medium",
      uncertainty: [],
      evidenceRefs: ["commit:2026-08-12T10:00:00.000Z"],
      demotions: [],
      revisedAt: "2026-08-12T12:00:00.000Z",
      generatedAt: "2026-08-12T12:00:00.000Z",
      fromCache: false,
    });

    const read = readPresentModel();
    expect(read?.id).toBe(written.id);
    expect(read?.primaryThreads[0]?.name).toBe("Good Neighbours");
    expect(read?.confidence).toBe("medium");
    expect(read?.hypothesisText).toContain("Good Neighbours");
  });

  it("returns null for empty store", () => {
    expect(readPresentModel()).toBeNull();
  });

  it("tracks demotions from corrections; latest wins", () => {
    appendCorrection({
      kind: "demote",
      projectName: "flyd",
      text: "don't treat flyd as my primary work",
    });
    expect(activeDemotions()).toContain("flyd");

    appendCorrection({
      kind: "reaffirm",
      projectName: "flyd",
      text: "actually treat flyd as primary",
    });
    expect(activeDemotions()).not.toContain("flyd");
  });
});
