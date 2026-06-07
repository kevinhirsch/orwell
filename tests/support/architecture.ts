import { cruise } from "dependency-cruiser";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Reuse the very same rules the CLI uses, so the test and `npm run test:arch` agree.
const config = require("../../.dependency-cruiser.cjs") as {
  forbidden: unknown[];
  options: Record<string, unknown>;
};

export interface Violation {
  rule: string;
  from: string;
  to: string;
}

let cache: Violation[] | undefined;

/** Run dependency-cruiser over `src` and return Vault-boundary violations. */
export async function vaultBoundaryViolations(): Promise<Violation[]> {
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

  cache = violations
    .map((v) => ({ rule: v.rule?.name ?? "unknown", from: v.from, to: v.to }))
    .filter((v) => v.rule === "no-vault-on-outward");

  return cache;
}
