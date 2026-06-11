import { describe, it, expect } from "vitest";
import {
  vaultBoundaryViolations,
  forbiddenRuleViolations,
  configuredForbiddenRules,
  cruisedModuleSources,
  forbiddenRulePatterns,
} from "../support/architecture";

describe("Vault Wall — structural boundary (dependency graph)", () => {
  it("no outward module depends on the Vault or the engine-only vector index", async () => {
    const violations = await vaultBoundaryViolations();
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  // Audit E77: previously only the Vault rule was asserted here and `npm test` never ran the
  // dep-cruiser CLI — `no-circular` (and any future rule) was enforced nowhere. Now every
  // configured forbidden rule is part of the unit gate.
  it("EVERY configured forbidden rule holds (incl. no-circular and the E18 default-deny)", async () => {
    const violations = await forbiddenRuleViolations();
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  // Audit E18 (meaningfulness guard): the default-deny posture cannot be silently deleted or
  // renamed away — the gate proves the rule set still contains the rules it claims to enforce.
  it("the rule set still carries the Vault denylist, the engine-layer default-deny, and no-circular", () => {
    const rules = configuredForbiddenRules();
    for (const required of [
      "no-vault-on-outward",
      "no-engine-layer-on-outward",
      "entrypoint-composes-runtime-only",
      "no-circular",
    ]) {
      expect(rules, `forbidden rule "${required}" must stay configured`).toContain(required);
    }
  });

  // Audit E18 (non-vacuity): a forbidden rule whose path patterns match NOTHING in the cruised
  // graph passes forever, silently — e.g. after a directory rename. Prove that both sides of the
  // Vault rule and the default-deny rule genuinely match live modules, so "zero violations"
  // means "checked and clean", never "checked nothing".
  it("the Vault and default-deny rules match real modules on BOTH sides (no vacuous pass)", async () => {
    const modules = await cruisedModuleSources();
    expect(modules.length).toBeGreaterThan(50); // the graph itself is real
    for (const rule of ["no-vault-on-outward", "no-engine-layer-on-outward"]) {
      const { from, to } = forbiddenRulePatterns(rule);
      expect(from, `rule "${rule}" has a from.path`).toBeTruthy();
      expect(to, `rule "${rule}" has a to.path`).toBeTruthy();
      const fromMatches = modules.filter((m) => new RegExp(from!).test(m));
      const toMatches = modules.filter((m) => new RegExp(to!).test(m));
      expect(fromMatches.length, `rule "${rule}": from-side matches no module — vacuous`).toBeGreaterThan(0);
      expect(toMatches.length, `rule "${rule}": to-side matches no module — vacuous`).toBeGreaterThan(0);
    }
    // The default-deny's protected side must cover the hidden-state modules E18 called out as
    // missing from the old enumerated denylist — the day-one coverage the posture exists for.
    const { to } = forbiddenRulePatterns("no-engine-layer-on-outward");
    const covered = (m: string): boolean => new RegExp(to!).test(m);
    for (const hidden of [
      "src/engine/characterFactory.ts",
      "src/engine/emotionalArc.ts",
      "src/engine/deals.ts",
      "src/engine/consequence.ts",
    ]) {
      expect(covered(hidden), `${hidden} must sit behind the default-deny`).toBe(true);
    }
  });
});
