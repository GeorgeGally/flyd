# Memory index health

Run `flyd memory-index status` to check the raw archive. It backs up the QMD database into a temporary directory and runs QMD's own collection scan on that copy. The output counts additions, changes and removals that an update would make, plus raw content hashes waiting for embeddings. QMD's collection glob, ignore rules, filename normalization and empty-file policy remain authoritative. A scan can race with captures, so rerun it after active writes settle.

`failed` means the latest update or embedding attempt for the named stage failed. `stale` means the scan found changes, embeddings are pending, or the vector index is absent. A successful retry clears the corresponding failure marker. Both states return a nonzero exit code. Status errors also return nonzero rather than presenting an unavailable index as healthy.

To repair the configured live raw index, run `flyd memory-index repair`. It updates the collection, embeds pending raw content and then reports status. Embedding may use substantial CPU, memory and disk space. The canonical Markdown files are not rewritten by this command. Other QMD collections are not repaired by it.

## Recall benchmark

Keep labels and results outside the repository: they contain private queries, file names and answer text. The schema is an array of cases with an `id`, `query`, `split` (`development` or `held-out`), `category` (`exact`, `alias`, `temporal` or `no-answer`), `answers` (relative raw `path` and an exact `contains` excerpt), and `stale` (paths that should not be treated as current). No-answer cases have an empty `answers` array. The harness checks every answer excerpt against its source before running. Maintain held-out labels independently of tuning.

Run `npx tsx src/evals/recall/run.ts /path/to/private-labels.json` from `cli`, with `FLYD_DIR` and `XDG_CACHE_HOME` pointing at a copy. The output includes private source paths; redirect it to a private file. It compares the conversation's resilient lexical retrieval, local QMD hybrid retrieval, and escalation on an insufficient lexical result. It reports top-one and top-five source hits, misses, stale sources ranked first, negative cases with any results, and median retrieval time. A negative result is a retrieval candidate, not proof that the model made a false claim. The labels are known answer-bearing sources, not necessarily an exhaustive list of all valid sources. Hybrid errors fail the run; this harness does not use the hosted query-expansion fallback.
