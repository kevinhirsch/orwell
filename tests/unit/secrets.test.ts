import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);

// Secret-looking tokens that must never be committed (feature 0010; widened per audit E78).
const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{12,}/,
  /\bsk-[A-Za-z0-9]{24,}\b/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // GitHub tokens (classic + fine-grained + app) — the A4 private-repo design makes a pasted
  // PAT the most likely accident class.
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  // Slack / Google API keys — cheap to refute, common paste mistakes.
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
];

// Audit E78: the guard used to scan only deploy/ + root configs — not src/, not the vendored
// front-end. Now EVERY tracked file is in scope except lockfiles and binary assets.
const EXCLUDED_FILES = new Set(["package-lock.json", "frontend/requirements.lock.txt"]);
// Files whose PURPOSE is to carry secret-SHAPED literals so the redaction layer can be tested
// against them (features 0071/0073). They contain only FAKE/example tokens. Exempt by EXACT path
// (never a glob), so a real secret pasted into ANY other file is still caught — the fixtures simply
// can't test redaction without holding the shapes the scanner forbids elsewhere.
const INTENTIONAL_SECRET_FIXTURES = new Set([
  "frontend/tests/test_secret_redaction.py",
  "features/step_definitions/defensive_hardening.steps.ts",
]);
const BINARY_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|eot|pdf|zip|gz|tar|mp[34]|wav|onnx|bin|sqlite|db)$/i;

function inScope(f: string): boolean {
  if (EXCLUDED_FILES.has(f)) return false;
  if (INTENTIONAL_SECRET_FIXTURES.has(f)) return false;
  if (/(^|\/)package-lock\.json$|(^|\/)yarn\.lock$|(^|\/)pnpm-lock\.yaml$/.test(f)) return false;
  if (BINARY_EXTENSIONS.test(f)) return false;
  return true;
}

describe("secrets never live in the repo (feature 0010 + audit E78)", () => {
  it("no committed file — engine, front-end, deploy, docs — contains an API key or private key", () => {
    const files = tracked.filter(inScope);
    // Self-check: the sweep must genuinely cover the engine and the vendored front-end —
    // a silently-narrowed scope is exactly the failure E78 found.
    expect(files.some((f) => f.startsWith("src/")), "scope covers src/").toBe(true);
    expect(files.some((f) => f.startsWith("frontend/")), "scope covers frontend/").toBe(true);
    expect(files.some((f) => f.startsWith("deploy/")), "scope covers deploy/").toBe(true);

    const offenders: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue; // unreadable (deleted in worktree) — git ls-files can lag the tree
      }
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(text)) offenders.push(`${file} matches ${pattern}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no real .env file is committed (only .env.example)", () => {
    const envFiles = tracked.filter((f) => /(^|\/)\.env$/.test(f));
    expect(envFiles).toEqual([]);
  });
});
