import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function readGitCommit() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "local";
  }
}

const commit = readGitCommit();
const version = commit === "local" ? "local" : commit.slice(0, 12);
const outputPath = resolve("public", "app-version.json");
const payload = `${JSON.stringify({ version, commit }, null, 2)}\n`;

mkdirSync(dirname(outputPath), { recursive: true });

if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== payload) {
  writeFileSync(outputPath, payload);
}
