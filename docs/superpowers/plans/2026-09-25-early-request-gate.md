# Early Request Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route answer, recall, research, typing, and work requests before work-intelligence so ordinary personal-agent requests are useful and fast.

**Architecture:** Extend the existing bounded router with a request purpose and run it immediately after deterministic local resolutions. Only a `work_help` purpose may enter Ground → Diagnose → Intervene. All other purposes retain the existing general resolution pipeline, where E2 evidence enrichment remains available. Deterministic consequence assessment remains authoritative and hosted Jev stays explicitly opt-in.

**Tech Stack:** TypeScript, Vitest, Flyd Core resolver, optional Typesafe Jev.

---

### Task 1: Define and test the early purpose gate

**Files:**
- Modify: `cli/src/router.ts`
- Modify: `cli/src/__tests__/router.test.ts`

- [x] **Step 1: Write failing classification tests**

```ts
expect(requestPurposeFromRoute("reply saying I'll be there", draftRoute)).toBe("type_text");
expect(requestPurposeFromRoute("what's left to be done on Flyd?", answerRoute)).toBe("recall_personal");
expect(requestPurposeFromRoute("search for the latest Flyd release", answerRoute)).toBe("research_web");
expect(requestPurposeFromRoute("fix the null check", answerRoute)).toBe("work_help");
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `cd cli && npm test -- --run src/__tests__/router.test.ts`

Expected: failure because `requestPurposeFromRoute` does not exist.

- [x] **Step 3: Add a pure, conservative purpose classifier**

```ts
export type RequestPurpose = "type_text" | "answer" | "recall_personal" | "research_web" | "work_help" | "control_flyd";

export function requestPurposeFromRoute(intent: string, route: IntentRoute): RequestPurpose {
  if (route.placement === "insert_at_cursor") return "type_text";
  if (/\b(search|browse|look up|investigate|latest|current|news)\b/i.test(intent)) return "research_web";
  if (/\b(remember|recall|where were we|what(?:'s| is) left|my )\b/i.test(intent)) return "recall_personal";
  if (/\b(fix|implement|build|change|continue|plan)\b/i.test(intent)) return "work_help";
  return "answer";
}
```

- [x] **Step 4: Run the focused test and verify it passes**

Run: `cd cli && npm test -- --run src/__tests__/router.test.ts`

Expected: PASS.

### Task 2: Move the work-intelligence gate behind routing

**Files:**
- Modify: `cli/src/resolve.ts`
- Modify: `cli/src/__tests__/resolve.test.ts`

- [x] **Step 1: Write failing gate tests**

```ts
expect(shouldRunWorkIntelligence("what's left to be done on Flyd?", "text", "recall_personal")).toBe(false);
expect(shouldRunWorkIntelligence("search for the latest Flyd release", "voice", "research_web")).toBe(false);
expect(shouldRunWorkIntelligence("fix the null check", "text", "work_help")).toBe(true);
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `cd cli && npm test -- --run src/__tests__/resolve.test.ts`

Expected: failure because `shouldRunWorkIntelligence` does not exist.

- [x] **Step 3: Resolve route and purpose before work-intelligence**

```ts
const regexRoute = routeIntent(intent, environment, modality);
const classified = await classifyRoute(intent, routeEnvironment, modality, router ?? null);
const route = modality === "voice" && regexRoute.kind === "ask_answer" ? regexRoute : classified?.route ?? regexRoute;
const purpose = requestPurposeFromRoute(intent, route);
if (shouldRunWorkIntelligence(intent, modality, purpose) && model && apiKey) {
  // existing runWorkIntelligence block
}
```

`shouldRunWorkIntelligence` must return true only for non-dictation `work_help`, and false for all answer/recall/research/control purposes. Reuse that same `classified` result in the later general-resolution `Promise.all`; do not make a second classifier call.

- [x] **Step 4: Run focused resolver tests**

Run: `cd cli && npm test -- --run src/__tests__/resolve.test.ts src/__tests__/router.test.ts`

Expected: PASS.

### Task 3: Verify evidence and release behavior

**Files:**
- Modify: `cli/src/__tests__/resolve.test.ts`
- Test: `cli/src/evidence/__tests__/e2-resolution-evidence.test.ts`

- [x] **Step 1: Add a regression assertion that research-purpose requests skip work intelligence and retain answer routing**

```ts
expect(shouldRunWorkIntelligence("browse current Flyd news", "voice", "research_web")).toBe(false);
expect(routeIntent("browse current Flyd news", env, "voice").placement).toBe("answer_panel");
```

- [x] **Step 2: Run focused routing and E2 evidence tests**

Run: `cd cli && npm test -- --run src/__tests__/resolve.test.ts src/__tests__/router.test.ts src/evidence/__tests__/e2-resolution-evidence.test.ts`

Expected: PASS.

- [x] **Step 3: Run static verification and rebuild the CLI**

Run: `cd cli && npm run lint && npm run build`

Expected: typecheck and build complete without errors.

- [x] **Step 4: Dogfood one recall, one web-research, and one work request through the installed Core**

Run: invoke Flyd with `what's left to be done on Flyd?`, `search for the latest Flyd release`, and `fix the null check in this function`.

Expected: recall and research avoid a work-plan card; work retains the concise task surface; no lifecycle mutation occurs from either question.
