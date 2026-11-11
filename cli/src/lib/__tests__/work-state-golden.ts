import type { ReadState } from "../work-state.js";

/**
 * The one golden table of staff sentences and where each says the work stands.
 * Every surface that shows a work state (status card, reply cards, rail, state
 * of play, Jobs) is checked against these rows in work-state.test.ts, so no
 * surface can read the same sentence differently. Rows marked `from` were
 * ported from the regex reader each surface used to keep of its own.
 * `null` is a sentence that says nothing about the work (or only a plan).
 */
export interface GoldenRow {
  sentence: string;
  state: ReadState | null;
  from?: "executive" | "for-george" | "rail" | "state-of-play" | "audit";
}

export const GOLDEN: GoldenRow[] = [
  // The state-machine audit's sentence: four readers said needs, stuck, stuck and done.
  { sentence: "Blocked on the Stripe key.", state: "blocked", from: "audit" },

  // needs you
  { sentence: "Shall I put today's local Flyd commit on top of GitHub's latest and push it?", state: "needs_you", from: "executive" },
  { sentence: "Shall I put today's local Flyd commit on top of GitHub's latest and push it? Until then, fixes that land won't reach the running Flyd.", state: "needs_you", from: "executive" },
  { sentence: "Do you want the command that lets firstmate message Flyd and get a real reply?", state: "needs_you", from: "for-george" },
  { sentence: "It's built. Want me to merge it?", state: "needs_you", from: "rail" },
  { sentence: "Ready, it waits on your go-ahead.", state: "needs_you", from: "rail" },
  { sentence: "The page is ready for your review.", state: "needs_you", from: "executive" },
  { sentence: "Approve the page and it goes live.", state: "needs_you", from: "executive" },
  { sentence: "That one is your call.", state: "needs_you", from: "state-of-play" },
  { sentence: "Waiting on you to pick a colour.", state: "needs_you", from: "for-george" },
  { sentence: "Say \"keep\" to keep it.", state: "needs_you", from: "executive" },

  // blocked
  { sentence: "Still stuck on its checks.", state: "blocked", from: "for-george" },
  { sentence: "Flyd decides itself and Flyd watches staff are still stuck on a check.", state: "blocked", from: "for-george" },
  { sentence: "The deploy failed.", state: "blocked", from: "state-of-play" },
  { sentence: "I can't get past the login.", state: "blocked", from: "for-george" },
  { sentence: "Gave up on the old importer.", state: "blocked", from: "state-of-play" },
  { sentence: "The deploy failed, so I'm retrying it.", state: "moving", from: "for-george" },
  { sentence: "It is no longer blocked.", state: null, from: "state-of-play" },
  { sentence: "Nothing is blocked.", state: null, from: "for-george" },

  // ready
  { sentence: "The fix is ready to merge.", state: "ready", from: "executive" },
  { sentence: "The pull request is green and waiting to be merged.", state: "ready" },

  // moving
  { sentence: "The fix is under way; a worker is running the checks.", state: "moving", from: "rail" },
  { sentence: "The fix will be merged once checks pass.", state: "moving", from: "executive" },
  { sentence: "Final checks are running.", state: "moving", from: "for-george" },
  { sentence: "Still in progress: search and replace.", state: "moving", from: "state-of-play" },
  { sentence: "Station ID between sets: started.", state: "moving", from: "state-of-play" },
  { sentence: "Layout: Flyd will decide the layout next.", state: "moving", from: "state-of-play" },
  { sentence: "It hasn't merged yet.", state: "moving", from: "executive" },
  { sentence: "The checks are still running.", state: "moving", from: "rail" },

  // landed
  { sentence: "The menu fix is merged.", state: "landed", from: "executive" },
  { sentence: "Both are live now.", state: "landed", from: "rail" },
  { sentence: "Merged. The checks were running for a while.", state: "landed", from: "rail" },
  { sentence: "The phantom island alerts are fixed.", state: "landed", from: "for-george" },
  { sentence: "Fix for the failing previews: landed and pushed.", state: "landed", from: "state-of-play" },
  { sentence: "Request page: landed after review.", state: "landed", from: "state-of-play" },

  // nothing about the work
  { sentence: "The fix for \"Merged deployed.\" will be worded properly from the start.", state: null, from: "executive" },
  { sentence: "Agreed. Each note gets a row tagged done, under way or needs you.", state: null, from: "rail" },
  { sentence: "Your Rails dev server is running on port 3000.", state: null, from: "rail" },
  { sentence: "USB Overdrive is a driver being sold since 2000.", state: null, from: "rail" },
  { sentence: "Running the tests showed 3 failures.", state: null, from: "rail" },
];
