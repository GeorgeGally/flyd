# Memory index health

Run `flyd memory-index status` to check the raw archive. It backs up the QMD database into a temporary directory and runs QMD's own collection scan on that copy. The output counts additions, changes and removals that an update would make, plus raw content hashes waiting for embeddings. QMD's collection glob, ignore rules, filename normalization and empty-file policy remain authoritative. A scan can race with captures, so rerun it after active writes settle.

`failed` means the latest update or embedding attempt for the named stage failed. `stale` means the scan found changes, embeddings are pending, or the vector index is absent. A successful retry clears the corresponding failure marker. Both states return a nonzero exit code. Status errors also return nonzero rather than presenting an unavailable index as healthy.

To repair the configured live raw index, run `flyd memory-index repair`. It updates the collection, embeds pending raw content and then reports status. Embedding may use substantial CPU, memory and disk space. The canonical Markdown files are not rewritten by this command. Other QMD collections are not repaired by it.
