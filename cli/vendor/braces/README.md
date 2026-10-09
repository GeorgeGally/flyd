# braces 3.0.4-flyd.0 (vendored fork)

Upstream [braces](https://github.com/micromatch/braces) 3.0.3 plus a nesting depth guard for
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) (CVE-2026-93687): deeply nested
brace or paren patterns under the 10,000-character cap overflowed the stack in the recursive walkers.

`parse`, `compile`, `expand` and `stringify` now throw a `SyntaxError` past 100 levels of nesting
(`options.maxDepth` can lower it). Everything else is upstream 3.0.3 unchanged.

Flyd reaches braces only through `@tobilu/qmd` → `fast-glob` → `micromatch`; `cli/package.json`
overrides it to this directory. No patched upstream release existed when this was vendored.

The guard applies only to the documented install (the repo symlink into `cli/`). npm applies
`overrides` only at the root project, so packed or published installs of `@radarboy/flyd` keep
upstream braces 3.0.3 on qmd's glob path. Packed installs are not a supported install path today.
The only pattern that reaches braces is Flyd's fixed `**/*.md` (`cli/src/lib/qmd.ts`), so no
user-controlled pattern gets to it.

**Drop this fork** (delete this directory and the `braces` override) once upstream ships a release
that fixes the advisory.
