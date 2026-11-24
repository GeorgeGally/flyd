import { readFileSync, writeFileSync, chmodSync, cpSync } from "fs";

for (const entry of ["dist/entry.js", "dist/index.js"]) {
  const content = readFileSync(entry, "utf8");
  if (!content.startsWith("#!/usr/bin/env node")) {
    writeFileSync(entry, "#!/usr/bin/env node\n" + content, "utf8");
  }
  chmodSync(entry, 0o755);
}
console.log("postbuild: executable entrypoints prepared");
// The production presentation gate replays the same synthetic fixtures and
// provider recordings as the bench; a packaged CLI must not bypass or lose it.
cpSync("src/evals/fixtures/system-one", "dist/evals/fixtures/system-one", { recursive: true });
