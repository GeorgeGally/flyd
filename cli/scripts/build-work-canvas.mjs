// Builds the pinned Rounds UI into Flyd dist: no Rounds server or hook process.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const vendor = join(dirname(fileURLToPath(import.meta.url)), "..", "vendor", "rounds-ui");
function run(command, args) {
  const p = spawnSync(command, args, { cwd: vendor, stdio: "inherit" });
  if (p.error) throw p.error;
  if (p.status !== 0) throw new Error(`Work canvas build failed: ${command} (${p.status})`);
}
const vite = join(vendor, "node_modules", ".bin", "vite");
if (!existsSync(vite)) {
  // Separate lockfile keeps the upstream UI dependency graph out of Flyd Core.
  run(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--no-audit", "--no-fund"]);
}
// Unlike Vite transpilation alone, a strict typecheck fails on an incompatible upstream merge.
run(join(vendor, "node_modules", ".bin", "tsc"), ["--noEmit", "--project", "tsconfig.json"]);
run(vite, ["build"]);
console.log("postbuild: embedded Rounds work canvas prepared");
