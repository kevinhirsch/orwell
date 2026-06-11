import { cruise } from "dependency-cruiser";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Reuse the very same rules the CLI uses, so the test and `npm run test:arch` agree.
const config = require("../../.dependency-cruiser.cjs") as {
  forbidden: Array<{ name: string }>;
  options: Record<string, unknown>;
};

export interface Violation {
  rule: string;
  from: string;
  to: string;
}

let cache: Violation[] | undefined;

async function allViolations(): Promise<Violation[]> {
  if (cache) return cache;

  const result = await cruise(["src"], {
    ...config.options,
    outputType: "json",
    ruleSet: { forbidden: config.forbidden as never },
  });

  const out =
    typeof result.output === "string" ? JSON.parse(result.output) : (result.output as any);

  const violations = (out.summary?.violations ?? []) as Array<{
    rule?: { name?: string };
    from: string;
    to: string;
  }>;

  cache = violations.map((v) => ({ rule: v.rule?.name ?? "unknown", from: v.from, to: v.to }));
  return cache;
}

/** Run dependency-cruiser over `src` and return Vault-boundary violations. */
export async function vaultBoundaryViolations(): Promise<Violation[]> {
  return (await allViolations()).filter((v) => v.rule === "no-vault-on-outward");
}

/**
 * Audit E77: EVERY forbidden rule is enforced by the unit gate — previously only the Vault
 * rule was asserted and `no-circular` (plus any future rule) was enforced nowhere, because
 * `npm test` never runs the `test:arch` CLI step.
 */
export async function forbiddenRuleViolations(): Promise<Violation[]> {
  return allViolations();
}

/** The configured rule names — lets the test prove the rule set itself hasn't been hollowed out. */
export function configuredForbiddenRules(): string[] {
  return config.forbidden.map((r) => r.name);
}
