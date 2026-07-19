import { readFileSync, writeFileSync, chmodSync } from "fs";

for (const entry of ["dist/index.js", "dist/runtime-bridge.js"]) {
  const content = readFileSync(entry, "utf8");
  if (!content.startsWith("#!/usr/bin/env node")) {
    writeFileSync(entry, "#!/usr/bin/env node\n" + content, "utf8");
  }
  chmodSync(entry, 0o755);
}
console.log("postbuild: executable entrypoints prepared");
