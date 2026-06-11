import { describe, it, expect } from "vitest";
import {
  vaultBoundaryViolations,
  forbiddenRuleViolations,
  configuredForbiddenRules,
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
});
