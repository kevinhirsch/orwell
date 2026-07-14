import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, sep } from "node:path";

/**
 * Regression guard: the engine keeps the SECURE tar@7 AND working embeddings.
 *
 * WHY THIS EXISTS (a real prod-breaker, 2026-06-27 → 2026-07-14):
 *
 *   tar@7 was a real security bump (CVE-2026-29786 + siblings, issue #1069), so the
 *   `package.json` `overrides.tar` pin MUST stay on the 7.x line. But fastembed@2.1.0's
 *   builds do `import tar from "tar"` (ESM) / `__importDefault(require("tar"))` (CJS),
 *   and tar@7 is pure ESM with NO default export — so the ESM entry throws at module
 *   evaluation:
 *
 *       The requested module 'tar' does not provide an export named 'default'
 *
 *   The engine imports fastembed as its `EmbeddingProvider`; because the whole boot
 *   warm-up threw, EVERY production boot fell back to `DeterministicEmbedding` and
 *   semantic recall ran permanently DEGRADED (silently — the fallback is by design).
 *
 * THE FIX (issue #1591): instead of DOWNGRADING tar to the insecure 6.x line (which
 * reintroduced the CVEs), we KEEP tar@7 and patch fastembed's import via `patch-package`
 * (`patches/fastembed+2.1.0.patch`): `import tar from "tar"` → `import * as tar from "tar"`
 * (and the CJS mirror), binding fastembed's `tar.x` call to tar@7's NAMED `x` export.
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

describe("fastembed ↔ tar interop (secure tar@7 kept, fastembed's default import patched — issue #1591)", () => {
  it("pins the package.json tar override to the SECURE 7.x line (NOT the CVE-vulnerable 6.x)", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    const override: unknown = pkg.overrides?.tar;
    expect(override, "package.json overrides.tar must be set").toBeTruthy();
    expect(String(override), "tar override must be on the 7.x line — 6.x reintroduces the #1069 CVEs").toMatch(
      /^7\./,
    );
    // Must satisfy the security floor for the 7.x line (the #1069 pin was 7.5.16).
    const { major, minor, patch } = parseSemver(String(override));
    expect(major).toBe(7);
    expect(minor > 5 || (minor === 5 && patch >= 16)).toBe(true);
  });

  it("carries the patch-package machinery: a fastembed patch file + the postinstall hook + patch-package as a RUNTIME dependency", () => {
    // The patch is what lets tar@7 (ESM-only, no default export) coexist with fastembed's
    // default import. Without it, the 7.x override crashes warm-up.
    const patchesDir = resolve(repoRoot, "patches");
    expect(existsSync(patchesDir), "patches/ directory must exist").toBe(true);
    const patchFiles = readdirSync(patchesDir).filter((f) => f.startsWith("fastembed") && f.endsWith(".patch"));
    expect(patchFiles.length, "a patches/fastembed*.patch file must exist").toBeGreaterThan(0);

    const patch = readFileSync(resolve(patchesDir, patchFiles[0]!), "utf8");
    // The patch must convert fastembed's default tar import into a namespace import.
    expect(patch).toMatch(/import \* as tar from "tar"/);

    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    expect(pkg.scripts?.postinstall, "postinstall must run patch-package").toMatch(/patch-package/);
    // patch-package MUST be a RUNTIME dependency, not a devDependency (Greptile #1600 P1): the
    // deploy runs `npm ci` then `npm prune --omit=dev`, and any `--omit=dev` install path still
    // runs the root `postinstall` — if patch-package were dev-only it would be pruned/absent and
    // `postinstall: patch-package` would fail, so the fastembed patch would never apply in prod.
    expect(pkg.dependencies?.["patch-package"], "patch-package must be a runtime dependency").toBeTruthy();
    expect(pkg.devDependencies?.["patch-package"], "patch-package must NOT be a devDependency").toBeFalsy();
  });

  it("resolves fastembed's tar to the secure 7.x build that exposes the extract API fastembed calls", () => {
    const tarPkg = fastembedResolvedTarPkg();
    const { major } = parseSemver(tarPkg.version);
    expect(major, `fastembed resolved tar@${tarPkg.version}, expected the 7.x line`).toBe(7);

    // The named `x`/`extract` API fastembed's patched `import * as tar` binds to must exist.
    const reqFromRepo = createRequire(resolve(repoRoot, "package.json"));
    const feMain = reqFromRepo.resolve("fastembed");
    const marker = `${sep}fastembed${sep}`;
    const feRoot = feMain.slice(0, feMain.indexOf(marker) + marker.length - 1);
    const reqFromFastembed = createRequire(resolve(feRoot, "package.json"));
    const tar = reqFromFastembed("tar") as Record<string, unknown>;
    expect(typeof tar.x === "function" || typeof tar.extract === "function").toBe(true);
  });

  it("imports fastembed's ESM entry without the tar 'no default export' error under tar@7 (the exact prod break)", async () => {
    // The literal runtime failure this guards: `import tar from "tar"` throwing
    // "does not provide an export named 'default'". Loading fastembed's entry proves
    // the patched tar import evaluates cleanly (does NOT download or init the ONNX model).
    await expect(import("fastembed")).resolves.toBeTruthy();
  });
});
