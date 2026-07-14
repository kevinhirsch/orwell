import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, sep } from "node:path";

/**
 * Regression guard: fastembed's `tar` dependency MUST resolve to a CommonJS build
 * (the 6.x line), never the pure-ESM tar@7.
 *
 * WHY THIS EXISTS (a real prod-breaker, 2026-06-27 → 2026-07-14): a `package.json`
 * override forced `"tar": "7.5.16"` for a security bump (issue #1069). But
 * fastembed@2.1.0's ESM build (`lib/esm/fastembed.js`) does `import tar from "tar"`,
 * and tar@7 is pure ESM with NO default export — so that import throws at module
 * evaluation:
 *
 *     The requested module 'tar' does not provide an export named 'default'
 *
 * The engine imports fastembed as its `EmbeddingProvider`; because the whole boot
 * warm-up threw, EVERY production boot fell back to `DeterministicEmbedding` and
 * semantic recall ran permanently DEGRADED (silently — the fallback is by design).
 *
 * tar@6 is CommonJS, so Node's ESM↔CJS interop synthesizes a usable default export
 * (`module.exports`), and fastembed's `import tar from "tar"` works. fastembed
 * declares `tar: "^6.2.0"`, so the override must stay on the 6.x line — with 6.2.1
 * as the CVE-patched floor.
 *
 * These checks run WITHOUT the real ONNX model (they never call `FlagEmbedding.init`),
 * so they are safe for the fast unit lane (`test:unit:fast`) / CI.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

function parseSemver(v: string): { major: number; minor: number; patch: number } {
  const [major = 0, minor = 0, patch = 0] = v.split(".").map((n) => parseInt(n, 10));
  return { major, minor, patch };
}

/** Resolve the tar that fastembed itself would load, without tripping fastembed's `exports` gate. */
function fastembedResolvedTarPkg(): { version: string; type?: string } {
  const reqFromRepo = createRequire(resolve(repoRoot, "package.json"));
  const feMain = reqFromRepo.resolve("fastembed"); // .../node_modules/fastembed/lib/cjs/index.js
  const marker = `${sep}fastembed${sep}`;
  const feRoot = feMain.slice(0, feMain.indexOf(marker) + marker.length - 1);
  const reqFromFastembed = createRequire(resolve(feRoot, "package.json"));
  return reqFromFastembed("tar/package.json") as { version: string; type?: string };
}

describe("fastembed ↔ tar interop (regression guard for the tar@7 ESM default-export prod break)", () => {
  it("pins the package.json tar override to the 6.x line (NOT 7.x — tar@7 is ESM-only, no default export)", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    const override: unknown = pkg.overrides?.tar;
    expect(override, "package.json overrides.tar must be set").toBeTruthy();
    expect(String(override)).toMatch(/^6\./);
    // Must satisfy the CVE-patched floor for the 6.x line.
    const { major, minor, patch } = parseSemver(String(override));
    expect(major).toBe(6);
    expect(minor > 2 || (minor === 2 && patch >= 1)).toBe(true);
  });

  it("documents WHY the pin is 6.x: fastembed still declares tar @ ^6.x", () => {
    // If fastembed ever bumps its tar range across the 7.x major, this guard (and the
    // override) must be revisited together — tar@7's ESM-only shape is the whole hazard.
    const reqFromRepo = createRequire(resolve(repoRoot, "package.json"));
    const feMain = reqFromRepo.resolve("fastembed");
    const marker = `${sep}fastembed${sep}`;
    const feRoot = feMain.slice(0, feMain.indexOf(marker) + marker.length - 1);
    const fePkg = JSON.parse(readFileSync(resolve(feRoot, "package.json"), "utf8"));
    const range = String(fePkg.dependencies?.tar ?? "");
    expect(range).toMatch(/6\./);
    expect(range).not.toMatch(/\^7\.|>=7\.|~7\./);
  });

  it("resolves fastembed's tar to a CommonJS 6.x build that exposes the extract API fastembed's default import needs", () => {
    const tarPkg = fastembedResolvedTarPkg();
    const { major } = parseSemver(tarPkg.version);
    expect(major, `fastembed resolved tar@${tarPkg.version}, expected the 6.x line`).toBe(6);
    // CJS package => Node synthesizes the default export that `import tar from "tar"` binds to.
    expect(tarPkg.type ?? "commonjs").toBe("commonjs");

    // And the actual module must expose the extraction API fastembed uses on that default.
    const reqFromRepo = createRequire(resolve(repoRoot, "package.json"));
    const feMain = reqFromRepo.resolve("fastembed");
    const marker = `${sep}fastembed${sep}`;
    const feRoot = feMain.slice(0, feMain.indexOf(marker) + marker.length - 1);
    const reqFromFastembed = createRequire(resolve(feRoot, "package.json"));
    const tar = reqFromFastembed("tar") as Record<string, unknown>;
    expect(typeof tar.x === "function" || typeof tar.extract === "function").toBe(true);
  });

  it("imports fastembed's ESM entry without the tar 'no default export' error (the exact prod break)", async () => {
    // The literal runtime failure this guards: `import tar from "tar"` throwing
    // "does not provide an export named 'default'". Loading fastembed's entry proves
    // the tar import evaluates cleanly (does NOT download or init the ONNX model).
    await expect(import("fastembed")).resolves.toBeTruthy();
  });
});
