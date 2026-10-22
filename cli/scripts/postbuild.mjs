import { readFileSync, writeFileSync, chmodSync } from "fs";
import { execFileSync } from "child_process";

for (const entry of ["dist/entry.js", "dist/index.js"]) {
  const content = readFileSync(entry, "utf8");
  if (!content.startsWith("#!/usr/bin/env node")) {
    writeFileSync(entry, "#!/usr/bin/env node\n" + content, "utf8");
  }
  chmodSync(entry, 0o755);
}
const clean = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() === "";
const buildCommit = clean ? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() : null;
writeFileSync("dist/build-info.json", JSON.stringify({ buildCommit }), "utf8");
console.log("postbuild: executable entrypoints prepared");
