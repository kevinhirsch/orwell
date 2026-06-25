# 0078 — Motivated off-screen society & intentional movement (co-presence earned, not arbitrary)

> **Status:** 🟢 **BUILT 2026-06-25 (Phase 1 + Phase 2 — feature complete).** **Phase 1
> (intentional movement):** NPCs move toward what their motivation points at — `MOVEMENT_INTENT`
> constants (`src/engine/presenceConstants.ts`) + the intent types, per-room `tanh`-bounded steering,
> and the unsatisfied-pursuit move-gate in `assignRooms` (`src/engine/presence.ts`), wired off the
> relationship model by `movementIntentFor` (`GameSessionAdapter`) and supplied on BOTH the base and
> weighted passes. Intent draws **no rng of its own** (the per-NPC draw COUNT is unchanged); it is
> DELIBERATELY calibration-load-bearing (owner ruling: location must affect play). **Phase 2 (nature
> clarity):** the scene's NATURE sets its fold — `natureFoldImpact` (`src/engine/relationshipConstants.ts`)
> with `FRIENDLY_NATURES = {bonding, showmance}`; a **friendly** scene folds **affinity only** (no
> strategic trust/threat/alignment, no vote-affecting change), a **game** scene folds its full strategic
> `IMPACT` **byte-identically** to before (same four jitter draws via `applyOneDirection`, so the spine
> stays in phase). The society fold in `src/composition/orchestrator.ts` now always routes through
> `natureFoldImpact`. **Combined calibration re-pass:** the friendly-affinity-only fold reduced society
> trust, so the move-intent lever was **re-tuned `0.2 → 0.15`** (`moveIntentStrength`) — at which
> **`juryReach` (20-seed) and the gradient (active ≥ passive reach & wins) both hold green**. **Gate:**
> `tests/unit/intentionalMovement0078.test.ts` (Phase 1 — trend-toward-target + avoidance + the
> no-side-channel-draw invariant + opt-in byte-identity) + `tests/unit/natureClarity0078.test.ts`
> (Phase 2 — friendly affinity-only, game byte-identical, draw-count-stable) + the green calibration
> sims + BDD `0078-motivated-society-and-intentional-movement.feature` (wired into `cucumber.cjs`,
> 8 scenarios green; the anti-sycophancy band is enforced authoritatively in the heavy sims, proved
> wired here per the 0073 structural pattern).
> **Depends on:** 0049 (presence/movement — the assignment this makes goal-driven), 0017/0026 (the
> relationship model — the motivation signal), 0040 (deals), 0044 (blocs), 0041 (souls/agenda), 0038
> (the off-screen society this enriches), 0066 (the awake set stays). **Relates to** 0077 (house map /
> privacy) — this makes "who's in a room together" *meaningful*, which is what 0077's observation/
> conspicuousness mechanics read. **Vault Wall (mandate #2):** the society is hidden; only an overheard
> fragment or a witnessed meeting reaches the player, through a pathway.

> **Owner direction (2026-06-23, this session — note the reversal):**
> - *First draft (decouple):* the floor plan tipped a calibration gate because the society pairs
>   co-present NPCs, so co-presence was the arbitrary *cause* of bonding. The first plan removed
>   co-presence from pairing entirely (motivation-only) to decouple layout from calibration.
> - **Owner reversed it:** *"I want motivation ON TOP OF co-presence… otherwise the ability to note
>   who is in rooms together has less of an impact. Houseguests need to be in the same room for any
>   gameplay conversations to happen. However, just because they are in the same room doesn't mean
>   they are talking about the game — it could just be friendly conversation. But relationships can
>   still build."*
> - And (carried from earlier): *"NPCs should act just as **intentional** as the player would be in
>   terms of location selection. Then the locations should be used to **affect** gameplay."*
> - **Friendly (non-game) co-present conversations DO nudge the hidden weights** — affinity only, no
>   strategic effect (owner, this session).

## The model

**Co-presence is the gate; intentional movement is what makes it *earned*; motivation sets the
*nature*.** Three layers, in order:

### 1. Co-presence is REQUIRED for any off-screen interaction (kept — owner ruling)

Two houseguests must be in the same room to have *any* scene — game or friendly. This is the current
0038/E45 model, and it stays: it is what makes **"who's in a room together" matter** (the player can
read it, 0077; a long private 1:1 is a tell). The floor plan therefore **stays connected to the
game's balance by design** — location is *meant* to affect play. (Consequence: a *new* floor plan is a
deliberate **calibration pass**, not a free change — see below.)

### 2. Intentional movement makes co-presence meaningful, not arbitrary (the headline build)

The owner's objection was never co-presence itself — it was that NPCs *drift* into rooms semi-
randomly, so bonding looked like luck. The fix is to make NPCs **choose where to go with intent**,
exactly as the player does (`moveTo`): an NPC moves toward what their **motivation** wants —

- **seek a bond** (gravitate to an ally / someone they're warming to),
- **work a target** (corner a rival, a nominee, a vote they need),
- **honor an agenda** (a deal partner 0040, a bloc 0044, a soul goal 0041),
- **seek privacy** (pull someone into a quiet room to scheme),
- **avoid a threat** (keep distance from someone dangerous).

So when two houseguests end up in a room together, it's usually because **one of them went looking
for the other** — co-presence is the *result* of intent, not a dice roll. This replaces the 0049
affinity-drift assignment with goal-driven positioning. It is **player-facing texture** (you can
watch two rivals keep finding each other, an outsider hover at the edges) *and* the new
calibration-load-bearing input (it changes who clusters → who interacts → votes), so it ships **with
a calibration pass**.

### 3. Co-presence ≠ game talk — motivation sets the nature, both build relationships

Being in a room together yields an interaction, but **not every interaction is strategic**. The
*nature* follows the pair's motivation + relationship read (this is largely the existing
`natureWeights`, made explicit and rebalanced):

- **Game conversation** (scheme / strategy / conflict) — fires when motivation/relationship points
  there (a threat to manage, an agenda to push). Folds the **strategic** weights (trust/threat) that
  feed votes.
- **Friendly conversation** (bonding, downtime, just hanging out) — the *default* texture of a house
  that isn't always plotting. **Nudges affinity only** (the relationship warms), **no strategic
  effect** (no scheming, no vote math) — owner ruling this session. Relationships still build.

So the house feels alive with ordinary social life, and a strategic beat lands *because* it stands
out against that — while *every* co-present scene still deepens the relationship layer (non-
degradation 0007: nothing is inert).

## Location stays calibration-coupled — by design (the explicit trade)

Because co-presence gates interaction, the floor plan feeds the calibrated vote spine. The owner has
**chosen** this (location must matter). The implication is recorded so it never surprises us again:

- The **current 9-room house is the calibrated baseline** (green).
- **Intentional movement** (this feature) changes clustering → it gets its own calibration pass here.
- A **future floor-plan change** (e.g. the 0077 13-room layout, preserved as commit `2102264`) will
  shift calibration and must land **with a deliberate re-tune pass** — it is *not* auto-safe. That is
  the accepted cost of location mattering.

## The calibration pass (load-bearing)

Intentional movement concentrates co-presence among motivated pairs, intensifying the society's
relationship folds, so the gates are re-measured/re-tuned:

- **`juryReach`** (20-seed band) and the **gradient** (active ≥ passive reach; active wins ≥ passive)
  must hold on the new model — the anti-sycophancy floor is non-negotiable (playing must never do
  worse than coasting; the measured ~20% vs ~7% win edge must survive).
- Re-tuning uses the **owner-sanctioned levers** (`JURY_WEIGHTS`, `decisionConstants.juryManagementWeight`,
  the society interaction rate / move-intent strength), never ad-hoc hacks.

> Reminder (verified this session): "reach jury" = survive to **final 11** — the jury is the last 9
> evictees (`evictionOrder.slice(-9)`; `seatOf` uses `cast − 2 − 9 = 5` pre-jury evictions); the final
> 2 are not jurors. The gates measure this correctly; keep it so.

## What must NOT change (guardrails)

- **The Vault Wall** — the society stays hidden; only fragments/meetings surface via pathways (0002).
- **The daily-event invariant**, the **awake-set** night gating (0066 — a turned-in houseguest drops
  out of play: gone from the society floor and the player-visible house, never paired into an off-screen
  scene), **seeded determinism**, **non-degradation** (every scene records + folds + persists, 0023).
- **The conversation is the game** — this enriches the hidden sim + the player-facing texture; no
  dashboard, no normalizing the open set (`expressiveNonCollapse` stays green).
- The L21/L24 **movement-stream isolation** discipline: intentional movement still rides a dedicated/
  calibrated stream as appropriate so the *mechanism* is reproducible.

## Testability (role-only; HARD rules)

- **Co-presence still gates:** no off-screen scene fires between houseguests in different rooms.
- **Movement is intentional:** an NPC with a motive toward a target (ally to bond, rival to work)
  trends toward that target's vicinity measurably more than a motiveless one (a goal-driven spread,
  like the L21/L24 social-aptitude test) — so co-presence correlates with agenda, not luck.
- **Nature follows motivation:** a warm pair tends to a *friendly* scene (affinity-only fold, no
  strategic move); a threatened/strategic pair tends to a *game* scene (strategic fold). Both record.
- **Friendly builds, doesn't scheme:** a friendly scene raises affinity and folds **no** strategic
  weight and triggers **no** vote-affecting change.
- **Calibration:** `juryReach` + gradient green on the new movement model.
- **Vault + determinism:** no sealed content leaks; same seed ⇒ same society + same outcomes.

## Phasing

1. ✅ **Phase 1 — intentional movement (BUILT).** Replaced affinity-drift assignment with goal-driven NPC
   positioning (toward bonds/targets/privacy, away from threats). **Calibration pass** (`juryReach` +
   gradient re-green at `moveIntentStrength 0.2`). *The bulk of the work and the calibration risk.*
2. ✅ **Phase 2 — nature clarity (BUILT).** The game-vs-friendly split is explicit: `natureFoldImpact`
   folds a friendly scene **affinity-only** (no strategic move, no vote-affecting change) and a game
   scene byte-identically (the spine). Combined **calibration re-pass** re-tuned `moveIntentStrength`
   to **0.15** (the friendly fold reduced society trust) — `juryReach` + gradient green.

## Open questions / defaults

1. **Move-intent strength** — how strongly motivation bends an NPC's room choice vs. staying put;
   tune in the calibration pass (start modest so the house doesn't all collapse into one room).
2. **Friendly:game ratio** — the baseline proportion of non-strategic scenes; start friendly-leaning
   (most house life is downtime) and tune for drama density.
3. **Privacy-seeking vs the open core** — a scheming pair seeking a private room ties into 0077; until
   0077 lands, "seek privacy" is a soft room-preference, not a hard mechanic.
