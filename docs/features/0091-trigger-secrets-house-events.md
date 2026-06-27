# 0091 — Trigger secrets fire house events (the foreseeable blow-up)

> **Status:** 🟢 **BUILT (2026-06-27).** Pure engine + orchestrator-wired + BDD + unit-gated.
> **Tracks #869.**
> **Depends on:** 0001 (Vault Wall), 0002 (event visibility — a witnessed house event is the
> player's knowledge), 0008 (the daily-event invariant + the `house-event` type this rides), 0038
> (the off-screen society / the per-turn bounded tick this attaches to), 0041 (the live soul —
> `emotionalState` / `volatility` is the *charge* on a trigger), 0058 (deep profiles — where the
> richest volatile triggers are authored), 0078 (motivated society — co-presence + the scene that
> precipitates a detonation), 0085/0086 (campaigns/drives — a confrontation/showmance under strain
> is a natural precipitant). **Sibling of** 0075 (trust-gated confidences — the *other* direction a
> sealed attribute legitimately becomes player knowledge: there by being *told*, here by *erupting*
> in front of the player). **Bounded by:** mandate #1 (behavioral fidelity — the eruptions ARE the
> texture), mandate #2 (Vault Wall — the hidden trigger never surfaces; only the public event does),
> mandate #3 (anti-sycophancy — the engine owns whether/when a trigger fires and the seeded
> magnitude; the model never decides it and never invents one), mandate #4 (non-degradation — a
> fired trigger is a durable recorded event + a persisted soul fold, and never thins).

## Why (the gap #869 names)

Every houseguest carries 3–6 sealed `hiddenElements` (`src/engine/characterFactory.ts`,
`HIDDEN_ELEMENT_POOLS`). Several of them are **volatile by their very wording** — the kind a real
_Big Brother_ houseguest is *one bad night away* from acting on:

- *"smiles through a grudge they will never forget"*
- *"is quietly desperate and will gamble bigger than they let on"*
- a deep-profile (0058) secret like *"buries a temper that already cost them dearly"* or
  *"one trigger from a blow-up they've been told would sink them."*

Today these are **inert**. A volatile secret only ever does what every other hidden element does:
it surfaces *rarely* as a line of off-screen flavor (`richOffscreenStretch`'s B50 reveal) or
diffuses as a vague rumor. It **never goes off**. So the single most _Big Brother_ moment a hidden
attribute could earn — **the slow-fuse houseguest finally detonating in front of the whole house**:
a public screaming match, a showmance imploding at the dinner table, a floater's mask cracking —
does not exist as a consequence of the secret that set it up.

This feature gives **trigger-type** hidden attributes a way to *fire*: under the right accumulated
stress and a temperature roll, a houseguest's buried trigger emits an **emergent, Vault-safe public
house event** the player witnesses. The hidden attribute stays hidden; only the eruption is seen.

### The retention value: variable-ratio surprise the player could have foreseen

This is a **variable-ratio reinforcement** beat — the most engaging schedule there is. The player
cannot predict *when* a houseguest will blow, only that the pressure is building, and the payoff
(a sudden, dramatic, board-shaking eruption) lands on an unpredictable schedule. Crucially, it is a
**fair** surprise, not a cheap one: the blow-up is *foreseeable in hindsight*. The player has
watched this houseguest get rattled (0041 mood, surfaced through behavior), watched the pressure
build over a bad stretch, maybe caught a rumor that they're "wound tight." When the detonation
comes, the honest reaction is *"I should have seen that coming"* — not *"that came from nowhere."*
That is the difference between a **plant that pays off** and a **deus ex machina**: the engine seeds
the charge from real, observable history; the timing is the only thing the player can't call. This
is the same contract 0075 holds for confidences and ADR 0003 holds for the whole game — **earned and
anchored, never a cold pop-up.**

## The bright line this respects (read first)

At a glance a trigger firing looks like it might leak the secret — the player learns this person had
a temper / a grudge / a desperate streak. It does not, and the reason is the same architecture that
licenses 0075's confidences (§ "The event/visibility model" in `CLAUDE.md`, ADR 0002):

> **The player learns the *eruption*, never the *trigger*.** A public blow-up is a witnessed
> happening — ordinary player knowledge. The sealed attribute that caused it (its wording, its
> existence as a known weakness) is *never handed to anyone* and never appears on a projection.

Three structural facts hold the Wall, none of them prompt wording:

1. **The engine decides, not the model.** Whether a trigger fires, *which* trigger, and *how big*
   the eruption is are all computed by the engine from sealed soul state + the trigger's charge +
   a seeded roll. The model is handed a Vault-free **public event line** to voice (exactly like
   `nextHouseEvent` today) — it never selects a trigger, never reads the sealed attribute, and the
   `momentPrompts` "never invent biography beyond the card" rule already forbids it inventing one.
2. **What's recorded is the public event, not the secret.** A fired trigger writes a `house-event`
   with `hidden: false` and the player in the witness set (0002) — *the eruption*. The sealed
   `hiddenElement` is **not** copied into that event's content; the link from event → trigger lives
   only in the Vault-side fold. So the player's knowledge gains "a blow-up happened," never "X has a
   buried temper."
3. **The model is never given the trigger text.** The public event line is engine-authored from a
   **generic eruption pool** (no name, no sealed wording) — a *type* of scene ("a simmering feud
   finally explodes into a shouting match in the kitchen"), grounded in week/day like every house
   event. The model dresses it in its own voice. It cannot leak what it is never handed.

A trigger firing is therefore the **inverse companion to 0075**: 0075 is a sealed attribute becoming
player knowledge by being *deliberately told*; 0091 is a different sealed attribute (a volatility,
not a fact) producing a *witnessed public consequence* — and in 0091 the attribute itself stays fully
sealed (only its *effect* is seen), an even tighter relationship to the Wall than a confidence.

## The mechanic

### 1. Trigger attributes — a volatile hidden element with a charge

A new hidden-element kind makes "volatile" first-class instead of inferred from wording:

- **`HiddenElementKind` gains `"trigger"`** (`src/engine/characterFactory.ts`). A `trigger` element
  carries the existing `detail` (the sealed wording — *"buries a temper that already cost them
  dearly"*) plus, **engine-side only**, a `volatility ∈ [0,1]` (how easily it goes off) and an
  eruption `kind` it maps to (a **public** scene type: `blow-up` / `showmance-detonation` /
  `mask-slips` / `meltdown`). These are minted on the same seeded side-rng as the other hidden
  elements (byte-stable to the house stream, 0007), gated by `HIDDEN_ELEMENT_GATES` (sibling to the
  C9 internal-consistency rules), and **bounded/rare** — a house of ticking bombs is noise, so a
  per-NPC cap (`maxTriggers`, default 1–2) and a population sparseness keep most houseguests un-
  triggered, exactly like 0059's "≤2 ties / ≤2 showmances" discipline.
- Existing volatile pool lines (the grudge / desperate / mask wordings above) become `trigger`
  elements; deep profiles (0058) author the richest ones. Backward-compatible: an NPC with no
  trigger element simply never fires one.

A trigger is **pure sealed state**. It is never on `npcVoice`, never on any projection, never a
number the player sees — identical Vault treatment to every other hidden element.

### 2. The fire condition — accumulated charge × stress × temperature (engine-owned)

A trigger fires only when the **pressure clears a seeded bar**. The "pressure" is engine-computed
from signals that **already exist**, no new hidden authoring:

```
pressure(npc, trigger) =
      trigger.volatility                       // who they are (sealed, static)
    × strain(npc)                              // where the season has them (sealed, live)
    × precipitant(scene)                       // what just happened (this tick)
```

- **`strain(npc)`** reads the **live soul (0041)**: high distress (`emotionalState` well below the
  calm baseline) and/or high `volatility` = a wound-tight houseguest. This is the charge the player
  *can* observe accumulating — through behavior, a rattled tone (0084), a rumor that they're on edge
  (0086 drives). Recent blows (a blindside, a betrayal, repeated comp losses, time on the block) are
  exactly what `evolveEmotion` already pushed into the soul.
- **`precipitant(scene)`** reads **this tick's context** (the off-screen society / the player's
  scene): a fresh conflict scene, a betrayal landing, a showmance partner pulling away, a nomination
  — a real *spark*. No spark ⇒ no detonation (the no-cold-open guarantee: a trigger never fires out
  of a quiet stretch; the strain has to meet a precipitating event).
- **The temperature roll (0028) is the final gate.** Eruptions are *rare* even at high pressure — the
  fire check is `rng.next() < pressure × TRIGGER.fireRate`, with `fireRate` bounded **low** (a treat,
  not a flood; sibling to `hiddenSurfacingRate = 0.05`). Temperature governs the *surprise* (the
  player can't predict the exact moment) without ever overriding a hard rule.

All magnitudes live in **one tunable `TRIGGER` constants module** (`triggerConstants.ts`, the
`SOCIETY` / `GOSSIP` / `CONFIDENCE` sibling — the B59 grep gate covers it). No constant is decorative
(audit E53 discipline): every weight has a real consumer.

### 3. The eruption — a Vault-safe public house event (what the player witnesses)

When a trigger fires, the engine emits a `house-event` **exactly like `nextHouseEvent`** — a public,
player-witnessed, day-indexed, name-free line — chosen from an **eruption pool** keyed to the
trigger's eruption `kind`:

| Eruption kind | Public event line (engine-authored, no name, no sealed wording) |
|---|---|
| `blow-up` | *"A simmering grudge finally boils over into a shouting match that empties the room."* |
| `showmance-detonation` | *"A showmance detonates in front of the whole house, and the fallout splits the room."* |
| `mask-slips` | *"A houseguest who has played it cool all season finally lets the mask slip — and everyone notices."* |
| `meltdown` | *"The pressure of the week breaks one houseguest into a public meltdown over something small."* |

These are **the same shape as the existing `HOUSE_EVENT_POOL`** — generic, voiceable, name-free; the
narrator attaches the people in its own voice from the public board (who's been rattled, who's in the
room — all Vault-free). The pool guarantees no two consecutive eruptions repeat content (the existing
store-consulted `nextHouseEvent` anti-repeat pattern).

The line carries **no sealed wording** — never the trigger's `detail`. The player sees *that* a
blow-up happened (and can infer *who*, from observable behavior and the narration); they are never
told it was caused by a buried temper. The connection trigger → event stays Vault-side.

### 4. The fold — a real, durable consequence (0023 / 0041)

A fired trigger is not just narration; it **folds consequence** like every happening:

- The erupting houseguest's soul takes a fold (a public meltdown is *consequential* — it can spend
  the charge down toward baseline, or in a `meltdown`/`showmance-detonation` raise volatility
  further). Reuses `evolveEmotion` (0041) — one swing formula, one tunables home.
- Witnesses' reads move along **existing pathways** (0002 / 0026): seeing someone blow up legitimately
  shifts how the house (and the player) reads their threat/affinity — a real relationship fold, never
  a number shown.
- The event is recorded once, durable, and **never thins** (0007/0030). The fact that *this trigger
  has fired* persists Vault-side (a monotonic `fired` flag) so a one-shot trigger (a mask, once
  slipped, can't un-slip) doesn't re-fire, and a restored game remembers exactly which fuses are
  spent. **Non-degradation: detail accumulates** — the season's eruptions are a permanent part of the
  record.

### 5. Where it runs — the bounded per-turn tick, on a dedicated rng (calibration-neutral)

The fire check rides the **existing per-turn off-screen tick** in `src/composition/orchestrator.ts`
(beside `whisperPairings` / `scheduleStoryThreads` / `campaignTick` / the `nextHouseEvent` day
event), so an eruption is anchored to a live moment and never a free-floating scheduler pop. It runs
on a **dedicated side rng inside the session** — *never the shared tick stream that drives the seeded
society/vote spine* — exactly the pattern `whisperPairings` and the 0060 thread scheduler use, so:

> **Triggers MUST NOT perturb any seeded competition, vote, or jury outcome.** The fire check draws
> only on its own dedicated rng; the relationship folds it applies are the same kind the society
> already applies (they move *reads*, which the game already accounts for) but the **RNG STREAM that
> resolves comps and votes is untouched**. With the feature off (an `ORWELL_TRIGGERS` flag, sibling
> to `ORWELL_CAMPAIGNS`), **zero draws happen and the calibration harness is byte-identical** — the
> `juryReach` / UAT / gradient gates stay green. This is the load-bearing determinism guarantee.

## Engine seams (where this lands)

- `src/engine/characterFactory.ts` — `HiddenElementKind` gains `"trigger"`; the `HiddenElement`
  type gains the engine-only `volatility` + eruption `kind` for trigger elements; the volatile pool
  lines are reclassified as triggers; `generateHiddenElements` mints them under a per-NPC cap +
  sparseness (the C9 gate pattern). Side-rng minted ⇒ house stream byte-stable.
- `src/engine/triggers.ts` *(new)* — pure: `pressure(...)`, the fire decision
  `shouldFire(trigger, strain, precipitant, rng)`, and the eruption-pool selector
  `eruptionEvent(kind, events, opts)` (the `nextHouseEvent` anti-repeat shape). No I/O, no Vault
  handle — it is handed the already-read soul + scene signals.
- `src/engine/triggerConstants.ts` *(new)* — the single `TRIGGER` tunable (volatility mint range,
  `fireRate`, the strain/precipitant weights, the per-NPC `maxTriggers` cap, population sparseness).
  The `SOCIETY`/`GOSSIP`/`CONFIDENCE` sibling.
- `src/composition/orchestrator.ts` — in the bounded tick, after the society/confessional folds,
  run the trigger check on the **dedicated session rng**: for each plausibly-strained, co-present
  erupting houseguest, evaluate `pressure`, and on a fire, **record the eruption `house-event`**
  (Vault-free) + fold the soul/witness consequence. Self-gated by `ORWELL_TRIGGERS` ⇒ no draws when
  off (calibration byte-identical).
- `GameSessionAdapter` — exposes the sealed reads the check needs (the strained souls + their trigger
  elements + occupancy), all engine-side; persists the per-trigger `fired` flag in the snapshot.
- `src/engine/momentPrompts.ts` — no new lever; an eruption is voiced as a **house event** through the
  existing `house-event` narration path (the narrator already voices `nextHouseEvent` lines). The
  manifest note: voice the public blow-up from the board; never state or invent the underlying cause.

## Engine-owned magnitude vs. model-narrated texture (ADR 0005)

Authority splits by **openness**, exactly as ADR 0005 requires:

- **Closed set (engine-dictated, no dynamism to lose):** *whether* a trigger exists, *whether/when*
  it fires, *which* eruption kind, the seeded magnitude of the fold. All sealed + seeded. The model
  cannot move any of it.
- **Open set (model-narrated, never normalized):** the *texture* of the eruption — the words of the
  shouting match, who says what, how the room reacts. The engine hands a generic public line + the
  Vault-free board; the model voices the scene richly. Nothing the model writes feeds back into the
  closed magnitude (the `expressiveNonCollapse` contract holds — no creative prose is collapsed into
  a bucket that changes what can be played next).

The model proposing the *shape* of the resulting fold (which read moves, which way) is allowed via
the existing optional `consequence` descriptor (PR #355) — but the **magnitude stays engine-seeded**
and `kind` is the floor, so no descriptor ⇒ byte-identical fold.

## ADR 0003 fit (the conversation is the game)

This adds **no dashboard and no new UI** — an eruption is a house event in the chat, the same
surface every other beat uses. It deepens the *conversation*: the player can now witness the
slow-fuse houseguest go off, react to it in-character, and have it matter (the fold). It is the
engine doing exactly its job under ADR 0003 — fixing a degradation (a sealed attribute that should
*do something* sat inert; the old chat-only game would have had the LLM spontaneously decide a
blow-up, ungrounded and un-recorded — sycophantic and forgettable) and otherwise getting out of the
model's way (hand it a fact to voice, never a script to recite).

## Persistence (0007/0030 — non-degradation)

- Each trigger gains a sealed, monotonic **`fired`** flag (and a `lastFiredWeek`), so a one-shot
  eruption never re-fires and a restored game remembers which fuses are spent. Monotonic — never
  cleared.
- The eruption itself is an ordinary recorded 0002 `house-event` — already durable; it deepens the
  record, never thins it.
- A per-season **eruption count** persists (sibling to `surfacedThreadCount`) to enforce the cap
  across restarts.

## Testability (role-only; HARD rules)

- **Vault Wall (the load-bearing test):** a trigger's sealed `detail`/`volatility`/`kind` never
  appears on `npcVoice`, on the eruption `house-event` content, or on any projection — a sentinel
  sweep over the assembled prompt + the recorded event + every player-facing surface finds no sealed
  trigger wording and no number, before *and after* a trigger fires. The player learns *an eruption
  happened*, never *X has a buried temper*.
- **A trigger fires under stress:** a houseguest with a high-volatility trigger + high strain + a
  fresh precipitant fires (seeded); the same houseguest with low strain / no precipitant does not.
- **No cold open:** with no precipitating scene (a quiet stretch), no trigger fires; an eruption is
  always anchored to a live tick, never started by a free-floating scheduler.
- **Foreseeable in hindsight:** the soul strain that gates a fire is the *same* state surfaced to the
  player through prior behavior/rumor (assert the eruption's owner had observable rattled signals
  before it fired — the plant is paid off, not a deus ex machina).
- **Engine-owned / anti-sycophancy:** the model never selects or invents a trigger; `eruptionEvent`
  returns only a generic pool line; a trigger never fires *more* readily to please the player (the
  seeded pressure dictates it; the engine never rewards the human with drama).
- **Determinism + calibration-neutral:** same seed + same history ⇒ same fire decision + same
  eruption kind; and with `ORWELL_TRIGGERS` off, **zero draws** ⇒ `juryReach` / UAT / gradient
  byte-identical (no comp/vote/jury outcome perturbed).
- **Bounded & durable:** eruptions are capped per season; a one-shot trigger's `fired` flag persists
  across a restart (no re-fire); the recorded eruption survives a save round-trip and never thins.

## Open questions / defaults (resolve at build)

1. **Default `fireRate`:** start low (~0.04, sibling to `hiddenSurfacingRate`), tuned against the UAT
   so eruptions feel *rare and earned* (a few per season), never a soap opera.
2. **Eruption-count cap:** default ≤3/season (mirrors the 0059 / 0075 sparseness), tuned live.
3. **Player as erupter (out of scope v1).** The engine never models the *player's* temper — the human
   owns their own outbursts (consistent with 0086 ruling #3 / 0085 keeping the player human-driven).
   v1 is NPC-only.
4. **One-shot vs. re-armable triggers.** Default: a `mask-slips` is one-shot (a mask, once dropped,
   stays dropped); a `blow-up`/`meltdown` can re-arm after a cooldown if strain rebuilds. Confirm the
   per-kind one-shot policy at build.
5. **Cross-feature: precipitant sourcing.** A trigger's precipitant is the natural consumer of 0078's
   conflict scenes and 0086's drives (a `target` drive colliding is a spark). Recommend: 0091 reads
   the precipitant; the companion features supply it — keeps this feature to the trigger layer.
6. **Loud vs. quiet eruptions.** Whether a low-pressure fire can produce a *smaller* public beat
   (a terse snap vs. a full screaming match) — a graduated eruption ladder (the 0075 disclosure-tier
   pattern) is a possible enrichment; v1 is binary (fires / doesn't).
