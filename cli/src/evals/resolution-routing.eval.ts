import { describe, expect, it, afterEach, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { resolve } from "../resolve.js";
import { configureOutcomeJournalDirectory } from "../work-intelligence/outcome-journal.js";
import { configureCoachMemoryDirectory } from "../runtime/coach-memory.js";
import {
  clearFixtureModel,
  editableEnvironment,
  makeManifest,
  nonEditableEnvironment,
  useFixtureModel,
} from "./helpers.js";

// Behavioral contract: what Flyd does with an invocation — where the answer
// lands, what never gets inserted, when it stays out of the way.
//
// The work-intelligence gate can journal receipts when the local wiki carries
// domain standards, so point every module-level store at a scratch dir. Note:
// FLYD_DIR alone is NOT enough — config.ts freezes it at import time.

let scratch: string;

beforeAll(() => {
  scratch = join(tmpdir(), `flyd-eval-routing-${randomUUID()}`);
  mkdirSync(scratch, { recursive: true });
  configureOutcomeJournalDirectory(join(scratch, "journal"));
  configureCoachMemoryDirectory(join(scratch, "coach"));
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

afterEach(clearFixtureModel);

const RESOLVER_RULE_MARKER = "RESOLUTION RULES";

function resolverResponds(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

describe("resolution routing", () => {
  it("answers general questions in an augment card, never inside the focused element", async () => {
    useFixtureModel([
      {
        contains: RESOLVER_RULE_MARKER,
        respond: resolverResponds({
          mode: "requires_augment",
          rationale: "User asked a conceptual question.",
          operations: [],
          augmentations: [
            { kind: "explanation", content: "A monad is a structure that wraps computations.", placement: "cursor" },
          ],
        }),
      },
    ]);

    const resolution = await resolve(
      makeManifest("What is a monad?", { environment: nonEditableEnvironment() }),
      "test-model"
    );

    expect(resolution.mode).toBe("requires_augment");
    expect(resolution.operations).toHaveLength(0);
    expect(resolution.augmentations?.[0]?.content).toContain("monad");
  });

  it("corrects a misbehaving model that tries to insert an answer into the focused field", async () => {
    useFixtureModel([
      {
        contains: RESOLVER_RULE_MARKER,
        respond: resolverResponds({
          mode: "native",
          rationale: "Answer.",
          operations: [{ target: "el_02", kind: "insert_text", text: "A monad is a monoid in the category of endofunctors." }],
        }),
      },
    ]);

    const resolution = await resolve(
      makeManifest("What is a monad?", { environment: nonEditableEnvironment() }),
      "test-model"
    );

    // ask_answer route + native attempt → forced into an answer panel card
    expect(resolution.mode).toBe("requires_augment");
    expect(resolution.operations).toHaveLength(0);
    expect(resolution.augmentations?.[0]?.content).toContain("endofunctors");
  });

  it("lands drafted text in the focused field even when the model returns an augment card", async () => {
    useFixtureModel([
      {
        contains: RESOLVER_RULE_MARKER,
        respond: resolverResponds({
          mode: "requires_augment",
          rationale: "Here is a polite rewrite.",
          operations: [],
          augmentations: [
            { kind: "explanation", content: "Unfortunately I cannot attend this meeting.", placement: "cursor" },
          ],
        }),
      },
    ]);

    const resolution = await resolve(
      makeManifest("rewrite this sentence to be polite"),
      "test-model",
      undefined
    );

    // draft_insert route + augment attempt → forced into native insertion
    expect(resolution.mode).toBe("native");
    expect(resolution.augmentations ?? []).toHaveLength(0);
    expect(resolution.operations[0]).toMatchObject({ target: "el_01", kind: "insert_text" });
    expect(resolution.operations[0]?.text).toContain("Unfortunately");
  });

  it("composes deep research instead of answering or inserting", async () => {
    useFixtureModel([
      {
        contains: RESOLVER_RULE_MARKER,
        respond: resolverResponds({
          mode: "requires_compose",
          rationale: "Deep research requested.",
          operations: [],
          composeRationale: "Solid-state vs hydrogen needs a multi-source dossier.",
        }),
      },
    ]);

    const resolution = await resolve(
      makeManifest(
        "Do deep research comparing solid state batteries versus hydrogen fuel cells for passenger cars",
        { environment: nonEditableEnvironment() }
      ),
      "test-model"
    );

    expect(resolution.mode).toBe("requires_compose");
    expect(resolution.composeRationale).toBeTruthy();
    expect(resolution.operations).toHaveLength(0);
  });

  it("routes substantial work invocations through the work-intelligence gate to an explanation card", async () => {
    useFixtureModel(
      [],
      resolverResponds({
        diagnosis: {
          primary_issue: {
            finding: "The draft keeps restarting because the outline is undecided",
          },
        },
        intervention: {
          kind: "insight",
          content: "Pick a three-part structure and finish section one before re-editing anything.",
        },
      })
    );

    const resolution = await resolve(
      makeManifest("I keep second-guessing the structure of my Q3 planning doc and rewriting it from scratch"),
      "test-model",
      "fixture-key"
    );

    // model + apiKey present → work-intelligence gate intercepts before scene selection
    expect(resolution.mode).toBe("requires_augment");
    expect(resolution.augmentations?.[0]?.content).toContain("three-part structure");
  });

  it("handles greetings deterministically without any model call", async () => {
    useFixtureModel([{ contains: "anything", respond: "MODEL MUST NOT BE CALLED" }]);

    const resolution = await resolve(makeManifest("hey"));

    expect(resolution.mode).toBe("native");
    expect(resolution.operations[0]?.text).toContain("Hello");
    expect(JSON.stringify(resolution)).not.toContain("MODEL MUST NOT BE CALLED");
  });

  it("dictates text into the focused element verbatim without a model", async () => {
    useFixtureModel([{ contains: "anything", respond: "MODEL MUST NOT BE CALLED" }]);

    const resolution = await resolve(
      makeManifest("type The meeting moved to Thursday", { environment: editableEnvironment() })
    );

    expect(resolution.mode).toBe("native");
    expect(resolution.operations[0]).toMatchObject({
      target: "el_01",
      kind: "insert_text",
      text: "The meeting moved to Thursday",
    });
  });
});
