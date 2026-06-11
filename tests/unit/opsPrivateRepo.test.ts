import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Lane 8 — ops & private-repo gates (audit A4/ruling #17 + E83 + E84 + E85).
 *
 * The repo flips private behind a single deploy PAT in data/.env (A4): these are the
 * structural gates that the deploy surface honors that design —
 *  - E84: no deploy script fetches branch tips from raw.githubusercontent (LOCAL-COPY bridges);
 *  - A4:  the git credential helper (token read from .env at use time) is wired by install AND
 *         update, and the update owns the one-time `--set-token` setup/rotation path;
 *  - A4:  no PAT literal is ever committed (the secrets-guard extension the audit asked for);
 *  - E83: the frontend lockfile exists, is fully pinned, and is what the scripts install;
 *  - E85: the systemd units carry the hardening set and the frontend unit has a default port.
 */

const DEPLOY = "deploy";
const deployScripts = readdirSync(DEPLOY).filter((f) => f.endsWith(".sh"));

describe("E84 — no raw-GitHub fetches in deploy scripts (A4 local-copy bridges)", () => {
  it("no executable line in any deploy script touches raw.githubusercontent.com", () => {
    for (const script of deployScripts) {
      const lines = readFileSync(join(DEPLOY, script), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/^\s*#/.test(line)) return; // comments may DOCUMENT the bootstrap one-liner
        if (/\bgrep\b/.test(line)) return; // smoke.sh's own E84 lint greps for the hostname
        expect(
          /raw\.githubusercontent\.com/.test(line),
          `${script}:${i + 1} still fetches from raw.githubusercontent.com`,
        ).toBe(false);
      });
    }
  });

  it("no deploy script pipes a remote script into a shell (curl … | bash)", () => {
    for (const script of deployScripts) {
      const lines = readFileSync(join(DEPLOY, script), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/^\s*#/.test(line)) return;
        expect(
          /curl[^|]*\|\s*(sudo\s+)?(ba)?sh\b/.test(line),
          `${script}:${i + 1} pipes a remote fetch into a shell`,
        ).toBe(false);
      });
    }
  });
});

describe("A4 — the single-PAT credential design is wired", () => {
  const install = readFileSync(join(DEPLOY, "orwell-install.sh"), "utf8");
  const update = readFileSync(join(DEPLOY, "orwell-update.sh"), "utf8");
  const bootstrap = readFileSync(join(DEPLOY, "orwell.sh"), "utf8");

  it("install + update + bootstrap wire the credential helper reading GIT_TOKEN from .env", () => {
    for (const [name, text] of [["orwell-install.sh", install], ["orwell-update.sh", update], ["orwell.sh", bootstrap]] as const) {
      expect(text, `${name} must configure the credential helper`).toContain("credential.helper");
      expect(text, `${name} must authenticate as x-access-token`).toContain("username=x-access-token");
      expect(text, `${name} must read GIT_TOKEN from .env at use time`).toMatch(/GIT_TOKEN=.*\.env|\.env.*GIT_TOKEN/s);
    }
  });

  it("the token never rides a remote URL (no token-in-URL clone anywhere in deploy)", () => {
    for (const script of deployScripts) {
      const text = readFileSync(join(DEPLOY, script), "utf8");
      expect(text, `${script} embeds a credential in a git URL`).not.toMatch(/https:\/\/[^\s"']*@github\.com/);
    }
  });

  it("orwell-update.sh owns the one-time --set-token setup/rotation path", () => {
    expect(update).toContain("--set-token");
  });

  it("no PAT literal is committed anywhere in the tree (the E78-scope secrets extension)", () => {
    const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
    const patPatterns = [/github_pat_[A-Za-z0-9_]{30,}/, /\bghp_[A-Za-z0-9]{30,}\b/, /\bgho_[A-Za-z0-9]{30,}\b/];
    for (const file of tracked) {
      let text: string;
      try {
        if (statSync(file).size > 5 * 1024 * 1024) continue; // skip big binaries
        text = readFileSync(file, "utf8");
      } catch {
        continue; // unreadable/binary
      }
      for (const p of patPatterns) {
        expect(p.test(text), `${file} appears to contain a committed GitHub token`).toBe(false);
      }
    }
  });
});

describe("E83 — the frontend dependency lockfile", () => {
  const lock = readFileSync("frontend/requirements.lock.txt", "utf8");

  it("every requirement line is exactly pinned (==)", () => {
    const lines = lock.split("\n");
    let pinned = 0;
    lines.forEach((line, i) => {
      if (/^\s*(#|$)/.test(line)) return; // comments/blank
      if (/^\s+/.test(line)) return; // pip-compile "via" continuations are indented comments
      expect(
        /^[A-Za-z0-9._-]+(\[[^\]]+\])?==\S+/.test(line),
        `requirements.lock.txt:${i + 1} is not exactly pinned: "${line}"`,
      ).toBe(true);
      pinned++;
    });
    expect(pinned).toBeGreaterThan(50); // the real closure, not a stub
  });

  it("the lockfile covers every top-level requirement", () => {
    const wanted = readFileSync("frontend/requirements.txt", "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => l.replace(/\[.*$/, "").replace(/[<>=!~;].*$/, "").trim().toLowerCase().replace(/_/g, "-"));
    const locked = new Set(
      lock
        .split("\n")
        .filter((l) => /^[A-Za-z0-9._-]+(\[[^\]]+\])?==/.test(l))
        .map((l) => l.replace(/\[.*$/, "").split("==")[0]!.trim().toLowerCase().replace(/_/g, "-")),
    );
    for (const dep of wanted) {
      expect(locked.has(dep), `lockfile is missing top-level dep "${dep}"`).toBe(true);
    }
  });

  it("install and update scripts install from the lockfile", () => {
    for (const script of ["orwell-install.sh", "orwell-update.sh"]) {
      expect(readFileSync(join(DEPLOY, script), "utf8")).toContain("requirements.lock.txt");
    }
  });
});

describe("E85 — systemd hardening", () => {
  const HARDENING = [
    "CapabilityBoundingSet=",
    "RestrictAddressFamilies=",
    "SystemCallFilter=@system-service",
    "ProtectKernelTunables=yes",
    "ProtectKernelModules=yes",
    "ProtectKernelLogs=yes",
    "RestrictSUIDSGID=yes",
    "LockPersonality=yes",
    "UMask=0077",
    "NoNewPrivileges=yes",
    "ProtectSystem=strict",
  ];

  for (const unit of ["orwell-engine.service", "orwell-frontend.service"]) {
    it(`${unit} carries the full hardening set`, () => {
      const text = readFileSync(join(DEPLOY, "systemd", unit), "utf8");
      for (const directive of HARDENING) {
        expect(text, `${unit} is missing ${directive}`).toContain(directive);
      }
      // Node/ONNX JIT needs W+X — the unit must take an explicit, documented position, not omit it.
      expect(text).toContain("MemoryDenyWriteExecute=no");
    });
  }

  it("the frontend unit defaults ORWELL_PORT (its EnvironmentFile is optional)", () => {
    const text = readFileSync(join(DEPLOY, "systemd", "orwell-frontend.service"), "utf8");
    expect(text).toContain("Environment=ORWELL_PORT=8080");
    // …and the default must come BEFORE the EnvironmentFile so the .env value wins when present.
    expect(text.indexOf("Environment=ORWELL_PORT=8080")).toBeLessThan(text.indexOf("EnvironmentFile="));
  });

  it("E32 — the installer turns multi-user identity on by default", () => {
    expect(readFileSync(join(DEPLOY, "orwell-install.sh"), "utf8")).toContain("ORWELL_ENGINE_MULTIUSER=1");
  });
});
