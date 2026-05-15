import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArgValue = (flag, fallback = "") => {
  const exact = args.find((value) => value.startsWith(`${flag}=`));
  if (exact) return exact.slice(flag.length + 1);
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) return args[index + 1];
  return fallback;
};

const targetBranch = getArgValue("--branch", "main");
const upstreamUrl = getArgValue("--upstream-url", "https://github.com/iamlukethedev/Claw3D.git");
const shouldMerge = hasFlag("--merge");
const shouldPush = hasFlag("--push");

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
  });

  if (result.status !== 0) {
    const message = options.inherit
      ? `${command} ${commandArgs.join(" ")} failed with exit code ${result.status}`
      : (result.stderr || result.stdout || `${command} failed`).trim();
    throw new Error(message);
  }

  return options.inherit ? "" : result.stdout.trim();
};

const remoteExists = (name) => {
  const result = spawnSync("git", ["remote", "get-url", name], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return result.status === 0;
};

if (!remoteExists("upstream")) {
  if (!shouldMerge && !shouldPush) {
    console.log(`Missing upstream remote. Add it with: git remote add upstream ${upstreamUrl}`);
    process.exit(0);
  }
  run("git", ["remote", "add", "upstream", upstreamUrl], { inherit: true });
}

run("git", ["fetch", "origin", "--prune"], { inherit: true });
run("git", ["fetch", "upstream", "--prune"], { inherit: true });

const currentBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
const worktreeDirty = run("git", ["status", "--porcelain"]);
const counts = run("git", [
  "rev-list",
  "--left-right",
  "--count",
  `origin/${targetBranch}...upstream/${targetBranch}`,
]);
const [forkOnlyRaw, upstreamOnlyRaw] = counts.split(/\s+/);
const forkOnly = Number(forkOnlyRaw || 0);
const upstreamOnly = Number(upstreamOnlyRaw || 0);

console.log(`Current branch: ${currentBranch}`);
console.log(`Fork-only commits on origin/${targetBranch}: ${forkOnly}`);
console.log(`Upstream-only commits on upstream/${targetBranch}: ${upstreamOnly}`);

if (!shouldMerge && !shouldPush) {
  console.log("\nDry run only. Re-run with --merge to merge upstream/main into your current branch.");
  console.log("Add --push to push the merged result back to origin.");
  process.exit(0);
}

if (currentBranch !== targetBranch) {
  throw new Error(`Current branch is ${currentBranch}. Switch to ${targetBranch} before merging upstream.`);
}

if (worktreeDirty) {
  throw new Error("Working tree is dirty. Commit or stash changes before merging upstream.");
}

if (shouldMerge) {
  run("git", ["merge", "--no-edit", `upstream/${targetBranch}`], { inherit: true });
}

if (shouldPush) {
  run("git", ["push", "origin", targetBranch], { inherit: true });
}