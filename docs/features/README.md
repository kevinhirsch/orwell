# Feature specs

Drafted, stack-agnostic feature definitions for the `bbai` build. Each feature is authored
here **before** implementation and handed to an implementer (a separate Claude Code
instance). The author drafts; the implementer builds to green and refactors.

## Convention

Each feature is two files, numbered by **build priority** (lower = built first):

| File | Role |
|---|---|
| `NNNN-<slug>.md` | **Design note** — context, scope, the port/tool contracts involved, test strategy, acceptance criteria, and an implementer handoff with open questions. |
| `NNNN-<slug>.feature` | **Executable spec** — Gherkin scenarios. Failing-first; the implementer makes them pass. |

## Rules these specs must hold to

- **BDD/TDD-first.** The `.feature` file is written to fail, then implemented to green
  (`docs/CLAUDE_CODE_INSTRUCTIONS.md` §9, `docs/bb-sim-spec.md` §12).
- **Roles only, never names.** No houseguest or player names appear in scenarios — only
  roles (player, admin, NPC, HOH, nominee, evictee, veto winner). Fixtures are **generated**;
  sample-save content is format-only and is never used as seed/test data.
- **Definition of done** (per `CLAUDE_CODE_INSTRUCTIONS.md` §11): a passing name-agnostic
  feature test; Vault isolation verified on the relevant player **and** admin surfaces;
  domain logic unit-tested with a **seeded** randomness source; no Vault read reachable from
  any player- or admin-facing adapter/tool.

## Build priority order

From `docs/CLAUDE_CODE_INSTRUCTIONS.md` §9. Draft and build in this order:

1. **Vault isolation (incl. God Mode)** — `0001-vault-wall-isolation`
2. Event visibility & propagation
3. Behavioral fidelity
4. Replayability / naming
5. Competition eligibility
6. Outcomes by stats + temperature
7. Persistence non-degradation
8. Daily-event invariant

## Status legend

`Draft` (authored, awaiting implementation) · `Ready` (accepted for build) ·
`In progress` · `Done` (feature green on player **and** admin surfaces).

## Index

| # | Feature | Priority | Status |
|---|---|---|---|
| 0001 | [Vault Wall isolation](./0001-vault-wall-isolation.md) | 1 | Done |
| 0002 | [Event visibility & propagation](./0002-event-visibility-and-propagation.md) | 2 | Done |
| 0003 | [Behavioral fidelity](./0003-behavioral-fidelity.md) | 3 | Done |
| 0004 | [Replayability & naming](./0004-replayability-and-naming.md) | 4 | Done |
| 0005 | [Competition eligibility](./0005-competition-eligibility.md) | 5 | Draft |
| 0006 | [Outcomes by stats + temperature](./0006-outcomes-by-stats-and-temperature.md) | 6 | Draft |
| 0007 | [Persistence non-degradation](./0007-persistence-non-degradation.md) | 7 | Draft |
| 0008 | [Daily-event invariant](./0008-daily-event-invariant.md) | 8 | Draft |

Each row is shipped as its own auto-merged PR, in priority order.
