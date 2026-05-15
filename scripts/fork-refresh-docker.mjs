import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

const steps = [
  ["docker", ["compose", "pull", "claw3d"]],
  ["docker", ["compose", "up", "-d", "--force-recreate", "claw3d"]],
  ["docker", ["compose", "ps", "claw3d"]],
];

if (dryRun) {
  console.log("Docker refresh plan:\n");
  for (const [command, commandArgs] of steps) {
    console.log(`${command} ${commandArgs.join(" ")}`);
  }
  process.exit(0);
}

for (const [command, commandArgs] of steps) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status}`);
  }
}