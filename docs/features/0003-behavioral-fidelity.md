# 0003 — Behavioral fidelity (richness)

> **Status:** Draft. **Build priority:** #3 (and the project's #1 *mandate*).
> **Executable spec:** [`0003-behavioral-fidelity.feature`](./0003-behavioral-fidelity.feature)

## 1. Summary

The simulation must reproduce the **full social texture** of a *Big Brother* house — alliances
forming and fracturing, gossip, scheming, showmance, betrayal, private strategy — with a
**meaningful portion off-screen** relative to the player, and with deep hidden character
elements surfacing **rarely**, never dumped. Tests assert **richness**, not just mechanics.

This is the hardest thing to test, so the feature's job is to **operationalize "rich"** into
measurable, seed-reproducible thresholds.

## 2. Operationalizing richness (metrics)

Computed over a seeded multi-day simulation; thresholds are **tunable parameters** (the
exact surfacing rate is an open decision, `bb-sim-spec.md` §16.2):

| Metric | Assertion |
|---|---|
| **Off-screen share** | fraction of NPC interactions whose witness set excludes the player ≥ `MIN_OFFSCREEN_SHARE` |
| **Interaction-type diversity** | distinct interaction types present (alliance, gossip, conflict, bonding, strategy, showmance…) ≥ `MIN_TYPE_DIVERSITY` |
| **Alliance churn** | ≥1 alliance formed **and** ≥1 shifted/fractured; relationship-edge strengths change over time |
| **Surfacing rarity** | share of moments revealing a hidden element ≤ `MAX_SURFACING_RATE`, and > 0 over a long game |
| **No dumping** | hidden elements revealed in any single moment ≤ `MAX_REVEALS_PER_MOMENT` |

## 3. Scope

**In:** the richness metrics above and the property tests that enforce them; that NPC-to-NPC
scenes are generated with witness sets excluding the player; that alliances/relationships
evolve; that hidden-element surfacing is rare and bounded.

**Out:** the *mechanism* of visibility/propagation (→ #2, depended on); character generation
depth and souls (→ #4, depended on); the per-moment temperature roll that *gates* surfacing
and initiative (→ #6, depended on); the prose quality of any single line (a narrative-layer
concern, not asserted numerically here).

## 4. Test strategy

- **Property-based** over many seeds: each metric holds for every seed (no story-specific
  fixtures). Use the seedable `RandomnessSource`.
- Drive a multi-day simulation, then compute metrics from the `EventStore` (visibility via
  #2) and the relationship graph.
- Assert **bounds**, not specific narratives — richness is statistical, not scripted.
- Keep thresholds in one config module so tuning is a single source of truth.

## 5. Definition of Done

- [ ] All scenarios pass across the seed set, name-agnostic.
- [ ] Off-screen life **provably exists** (off-screen share ≥ minimum) — and witnessed events
      are not secret (cross-checks #2).
- [ ] Surfacing is provably **rare and bounded** (≤ max rate, ≤ max per moment, > 0 long-run).
- [ ] Alliance/relationship evolution demonstrated.
- [ ] Metrics + thresholds live in a tunable config; property tests are reproducible by seed.

## 6. Dependencies

#2 (event visibility & propagation) for the substrate; #4 (generation/souls) for the deep
hidden elements that surface; #6 (temperature) for the rolls that gate initiative and
surfacing. Draft-buildable against stubs, but full green needs these in place.

## 7. Traceability

`bb-sim-spec.md` §1 (mandate), §6.1, §7, §9, §12 (Behavioral fidelity);
`CLAUDE_CODE_INSTRUCTIONS.md` §1, §4, §9.4; `CLAUDE.md` mandate #1.
