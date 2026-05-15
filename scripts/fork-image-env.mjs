import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

const runGit = (gitArgs) => {
  const result = spawnSync("git", gitArgs, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Git command failed").trim());
  }

  return result.stdout.trim();
};

const parseGitHubOwner = (remoteUrl) => {
  const raw = String(remoteUrl || "").trim();
  const match = raw.match(/github\.com[:/](?<owner>[^/]+)\/[^/]+(?:\.git)?$/i);
  return match?.groups?.owner || "";
};

const upsertEnvValue = (content, key, value) => {
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, `${key}=${value}`);
  }

  const suffix = content.length && !content.endsWith("\n") ? "\n" : "";
  return `${content}${suffix}${key}=${value}\n`;
};

const originUrl = runGit(["remote", "get-url", "origin"]);
const defaultOwner = parseGitHubOwner(originUrl);
if (!defaultOwner) {
  throw new Error(`Could not parse a GitHub owner from origin remote: ${originUrl}`);
}

const owner = getArgValue("--owner", defaultOwner).toLowerCase();
const tag = getArgValue("--tag", "latest");
const envFile = path.resolve(repoRoot, getArgValue("--env-file", ".env"));
const hostBind = getArgValue("--host-bind", "127.0.0.1");
const helper = getArgValue("--helper", "1");
const image = `ghcr.io/${owner}/claw3d:${tag}`;
const updates = {
  CLAW3D_IMAGE: image,
  HOST_BIND: hostBind,
  STUDIO_ACCESS_LOCAL_HELPER: helper,
};

if (!hasFlag("--write")) {
  console.log("Recommended .env values for this fork:\n");
  for (const [key, value] of Object.entries(updates)) {
    console.log(`${key}=${value}`);
  }
  console.log("\nUse --write to persist these values into your .env file.");
  process.exit(0);
}

let content = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
for (const [key, value] of Object.entries(updates)) {
  content = upsertEnvValue(content, key, value);
}
writeFileSync(envFile, content, "utf8");

console.log(`Updated ${path.relative(repoRoot, envFile) || path.basename(envFile)} with:`);
for (const [key, value] of Object.entries(updates)) {
  console.log(`- ${key}=${value}`);
}