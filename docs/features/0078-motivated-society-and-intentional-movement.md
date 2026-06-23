# 0078 — Motivated off-screen society & intentional movement (who bonds is character-driven, not room-driven)

> **Status:** 📝 **SPEC / sketch** (drafted 2026-06-23). **Gate (planned):** engine (Vitest +
> dependency-cruiser + the **calibration pass** — `juryReach` + the gradient band re-verified on the
> new model) and BDD `0078-motivated-society-and-intentional-movement.feature`. **Depends on:** 0002
> (events/pathways — overhearing stays a modeled pathway), 0017/0026 (the relationship model — the
> pairing signal), 0038 (the off-screen society this redesigns), 0041 (souls/motivation), 0049
> (presence/movement — the assignment this makes goal-driven), 0066 (the awake-set gating stays).
> **Unblocks** 0077 (house map / privacy & eyeshot): once this lands, the floor plan is provably
> calibration-neutral, so 0077's layout folds in safely. **Vault Wall (mandate #2):** the society is
> hidden; only an overheard *fragment* or a witnessed *meeting* reaches the player, through a pathway.

> **Owner direction (2026-06-23, this session):**
> 1. *"I don't think characters should bond based arbitrarily on if they are in the same room. Their
>    motivations should be much more nuanced than that — character personality or motivations."*
> 2. *"I have a problem with 'NPCs bumping into each other.' NPCs should act just as **intentional**
>    as the player would be in terms of location selection. Then the locations should be used to
>    **affect** gameplay."*
> 3. (From the calibration discussion.) *The floor plan must never move a vote* — rearranging the
>    house is presentation; competitive outcomes must not depend on room topology.

## The defect this fixes

Today the off-screen society (0038) — the hidden NPC↔NPC scheming/bonding that runs between the
player's turns — **pairs CO-PRESENT NPCs**: two houseguests the seeded, affinity-clustered room
drift (0049) happened to drop in the same room may scheme or bond. Two things are wrong with that:

1. **Bonding is room-driven, not motivation-driven.** *Who* an NPC schemes with is decided by an
   arbitrary roll of where they drifted, not by who they actually want to work, fear, or betray. The
   "NPCs bump into each other" model is the symptom — NPCs are passive particles, not intentional
   players.
2. **The floor plan is coupled to the calibrated vote spine.** Because pairing reads room
   co-presence, and pairing → relationship folds → eviction votes, **any layout change shifts the
   votes**. That is exactly why feature 0077's new floor plan tipped the gradient calibration gate
   (`active jury-reach 5/6 < passive 6/6`): more rooms diluted co-presence, re-rolling the society.
   Presentation should never touch a closed-set outcome (ADR 0005).

Both are the same root: **room co-presence is being used as the *cause* of social play**, when it
should be a *setting* and a *consequence*.

## The redesign — motivation is the cause, location is the consequence

### 1. The society pairs by motivation + relationship, not co-presence

`richOffscreenStretch` selects who interacts with whom from the **relationship + motivation** layer,
never from room occupancy:

- **Tie strength & valence** (0026): a strong ally is who you bond with; a rising threat is who you
  scheme against. Already half-present ("partners by tie strength") — this makes it the *whole*
  selector, dropping the co-presence gate.
- **Goals / agenda** (0041 souls, 0040 deals, 0044 strategic blocs): an NPC working a target, honoring
  a deal, or shoring up a bloc pairs with the houseguest their *agenda* points at.
- **Temperature** (0006): variance/initiative still rolls per moment, so it is not deterministic.

Because this selection **never reads `HOUSE_ROOMS`/adjacency/occupancy**, the society's pairing — and
therefore every downstream vote — is **invariant to the floor plan by construction**. That is the
decoupling: rearranging rooms cannot change who pairs, so it cannot move a vote.

### 2. The scene is *placed* in a room — location as consequence, for overhearing only

Once the society decides a motivated pair interacts, the engine **sets the scene in the initiator's
real room** (where their intentional movement, below, put them). Room placement is now a *downstream
presentation/observation* fact, used **only** for:

- **Overhearing** (0049 `rollOverhears`): a player (or NPC) one room over may catch a fragment — the
  real, traceable `overheard:` pathway, unchanged. Location decides *who can observe*, never *who
  bonds*.
- **Conspicuousness** (0077): being *seen* slipping off together is information; the content stays
  sealed.

So location still **affects** gameplay (what you can observe, privacy, reach) — it just no longer
**dictates** the social graph.

### 3. NPCs move intentionally (goal-driven), not by random drift

Presence assignment (0049 `assignRooms`) becomes **motivated**: an NPC moves toward what their agenda
wants — seek an ally to talk, seek a *private* room to scheme, follow or avoid a target, gravitate to
where their plan lives — instead of the current affinity-cluster drift. The player already moves with
full intent (`moveTo`); NPCs gain the same intentionality. This makes the *player-facing* house read
as a cast of people pursuing goals (you can watch two rivals keep finding each other, an outsider
hover at the edges), which is the texture the owner wants.

> **Isolation note (the L21/L24 lesson holds, inverted).** Movement *weighting* was kept off the
> calibration spine via a dedicated RNG stream. Here the move is bigger: the **society no longer
> reads occupancy at all**, so movement (however intentional) is *purely player-facing* and cannot
> perturb calibration regardless of stream. The calibration-load-bearing thing becomes the
> motivation/relationship selection — which is already part of the seeded spine.

### 4. Location-as-gameplay (the payoff, ties to 0077)

With bonding decoupled, the floor plan is free to be a **gameplay surface**: privacy scarcity in the
open core, a private room to pull someone aside, eyeshot/earshot, the conspicuousness of a long
1:1 — all of 0077 — none of which can ever move a competitive outcome. The house is a *stage the
player and NPCs act on with intent*, not a dice table that decides the game.

## The calibration pass (load-bearing — this is most of the work)

Dropping the co-presence gate **changes the society's behavior vs. current `main`** (different pairs,
likely more scenes), so the seeded gates must be re-measured and, if needed, re-tuned:

- **`juryReach`** (20-seed band) and the **gradient** (active ≥ passive reach; active wins ≥ passive)
  must pass on the new model. The anti-sycophancy floor is non-negotiable: playing the game must
  never do worse than coasting (and must *win* more — the measured ~20% vs ~7%).
- Re-tuning, if needed, uses the **owner-sanctioned levers** (`JURY_WEIGHTS`,
  `decisionConstants.juryManagementWeight`, the society interaction rate), not ad-hoc hacks.
- **Then** the 0077 floor plan is re-applied (commit `2102264`) and the gates are shown **byte-stable
  across layouts** — the permanent decoupling guard (a test that swaps the floor plan and asserts
  identical seeded vote outcomes).

> Reminder (verified this session): "reach jury" = survive to **final 11** — the jury is the last 9
> evictees (`evictionOrder.slice(-9)`; `seatOf` uses `cast − 2 − 9 = 5` pre-jury evictions), the
> final 2 are **not** jurors. The gates measure this correctly; the redesign must keep it so.

## What must NOT change (the guardrails)

- **The Vault Wall** — the society stays hidden; only fragments/meetings surface via pathways.
- **The daily-event invariant**, the **awake-set** night gating (0066), **seeded determinism**, and
  **non-degradation** (every scene still records + folds + persists, 0023).
- **The conversation is the game** — this enriches the hidden sim and the player-facing texture; it
  does not add a dashboard or normalize the open set (`expressiveNonCollapse` stays green).

## Testability (role-only; HARD rules)

- **Decoupling (the headline):** a permanent test swaps the floor plan (e.g. 9-room ↔ 13-room) under
  the same seed and asserts the society's pairing and the **final vote outcomes are identical** — the
  proof that layout can never move a result.
- **Motivation drives bonding:** across seeds, an NPC's off-screen partners correlate with their
  *relationship/agenda* (strong tie / threat / deal target), not with room adjacency; shuffling rooms
  does not change partners.
- **Intentional movement:** an NPC with a motive toward a target trends toward that target's vicinity
  more than a motiveless one (a goal-driven spread, like the L21/L24 social-aptitude test).
- **Location still gates observation, not pairing:** overhearing/eyeshot still depend on rooms;
  pairing does not.
- **Calibration:** `juryReach` + gradient green on the new model AND with the 0077 floor plan applied.
- **Vault + determinism:** no sealed content leaks; same seed ⇒ same society + same outcomes.

## Phasing

1. **Phase 1 — decouple.** Society pairs by motivation/relationship; scene placed in the initiator's
   room for overhearing; re-verify/re-tune `juryReach` + gradient. *Unblocks 0077.*
2. **Phase 2 — intentional movement.** Replace the affinity-drift assignment with goal-driven NPC
   positioning (player-facing; calibration-irrelevant after Phase 1).
3. **Phase 3 — fold in 0077.** Re-apply the floor plan + privacy/eyeshot; add the cross-layout
   decoupling guard; land location-as-gameplay.

## Open questions / defaults

1. **Motivation signal weighting** — how much goal/agenda vs. raw tie-strength drives pairing; start
   from the existing tie-strength selector and layer agenda in, tuned in the calibration pass.
2. **Scene count** — without the co-presence gate the society could pair *more*; cap the per-tick
   interaction count so the hidden layer stays bounded (it already is) and calibration stays sane.
3. **Intentional movement vs. the awake set** — goal-driven movement composes with 0066 (asleep NPCs
   don't move/scheme); confirm no double-count.
