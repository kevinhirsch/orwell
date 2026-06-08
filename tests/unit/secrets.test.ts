import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);

// Secret-looking tokens that must never be committed (feature 0010).
const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{12,}/,
  /\bsk-[A-Za-z0-9]{24,}\b/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

describe("secrets never live in the repo (feature 0010)", () => {
  it("no committed deploy script or config contains an API key or private key", () => {
    const inScope = tracked.filter(
      (f) =>
        f !== "package-lock.json" &&
        (f.startsWith("deploy/") || /^[^/]+\.(cjs|mjs|json)$/.test(f) || f.endsWith(".env.example")),
    );
    for (const file of inScope) {
      const text = readFileSync(file, "utf8");
      for (const pattern of SECRET_PATTERNS) {
        expect(pattern.test(text), `${file} appears to contain a secret`).toBe(false);
      }
    }
  });

  it("no real .env file is committed (only .env.example)", () => {
    const envFiles = tracked.filter((f) => /(^|\/)\.env$/.test(f));
    expect(envFiles).toEqual([]);
  });
});
