# The model↔engine under-call seam — the structural answer (product gap #3)

**Status: accepted (owner-approved gap #3), first increment shipped alongside this doc.**
Companions: ADR `docs/decisions/0003` (the conversation is the game), ADR `docs/decisions/0005`
(split authority by openness), the owner ruling "error-correct the omission, never engine-author
content" (CLAUDE.md, the consequence-loop section), and #1154 / ADR 0016 §D (the first forced
`tool_choice` seam, `frontend/tests/test_tool_choice_force.py`).

## 1. The problem

The narration LLM reliably **under-calls** the engine tools: it narrates a beat and skips the call
that makes the beat real. The engine is fine; the *model* skips the call. Game correctness today
leans on a **belt stack** — FE guardrails that detect the omission after the fact and error-correct
it. Every live playtest has added a belt. The belts work (each fixed a real, observed failure), but
the *trend* is the problem: correctness-by-accretion, each belt with its own trigger regex, cap,
escalation ladder, and NAR-1-class keying bug surface. This doc inventories the stack, weighs the
structural options honestly, and picks the increment.

**The belts are not deleted by this work.** The goal is that they *fire rarely* — they stay as the
safety net, and (new, part 3 below) every firing is now **counted** in the Vault-free sync ledger so
future playtests can *measure* belt reliance instead of feeling it.

## 2. The belt inventory

All reactive belts run **after** the model finished (or between rounds); the model has already had
its un-forced chance every time. Locations are current as of this doc.

### 2.1 Progression / closed-set beats

| Belt | Trigger | What the model skipped | Failure mode if the belt breaks |
|---|---|---|---|
| **Progression stall-nudge ladder** (`_ADVANCE_NUDGES`, `frontend/src/agent_loop.py`) | Live advance-phase (`_ADVANCE_PHASES`) + player lull + beat stale ≥ grace (2 turns; 1 in the guided week 1), no progression tool fired, no social runway holding | `advanceGame` | The season freezes at a beat — the #1 playthrough blocker, robust even on strong models |
| **Preview-commit / decision-deliver nudges** (`_PREVIEW_COMMIT_NUDGE`, `_DECISION_DELIVER_NUDGE`) | Turn's LAST beat-tool was `runCompetition` (previewed, never committed) or `submitDecision` (resolved, never delivered) — bypasses the lull gate | The follow-up `advanceGame` | The model narrates a winner that never became official — chat contradicts the HUD (the #1 desync, audit 2026-06-18 #1/1b) |
| **L39b forced `advanceGame`** (`_ADVANCE_FORCE_LEVEL` → `_commit_advance_silently`) | Stall level climbed past all three text rungs (the model ignored every nudge), or the eviction-drain / silent-commit path when a scene was already shown | `advanceGame` | Permanent freeze (the 2026-06-19 God-Mode transcript: "not a single beat advanced") |
| **Eviction-reveal steer** (LIVE-4 #541, `_eviction_reveal_steer`) | `advanceGame` returned an eviction-stage beat with content | *Voicing* the returned ballot/result | The season's peak beat happens invisibly; the player on the block never sees the votes land |
| **Ceremony-narration steer** (F8 #1015, `_ceremony_narration_steer`) | Advance/pre-resolve returned a nomination/veto-ceremony beat with content | *Voicing* the ceremony | Noms appear only in the HUD; an NPC asks "when did the ceremony happen?" |
| **`_pre_resolve_npc_ceremony`** (`frontend/routes/chat_helpers.py`, C-02/C-03) | Pre-turn framing finds the game sitting at an NPC-owned ceremony/comp beat with no player pending (social-runway gated) | The `advanceGame` that resolves an NPC-owned beat | NPC-owned beats never resolve, or the alternative — the model fast-forwards them unnarrated |
| **#1154 forced `tool_choice`** (proactive, `_forced_tool_choice_for_beat`) | Framed phase ∈ comp/ceremony force set, no advance yet this turn, **no open player pending**, model honors `tool_choice`, kill-switch on | `advanceGame` (forced ON THE WIRE, before the model can skip it) | Falls back to the reactive belts above |

### 2.2 The consequence loop (social play must fold)

| Belt | Trigger | What the model skipped | Failure mode if the belt breaks |
|---|---|---|---|
| **`_auto_record_scene`** (0055) | Engaged player↔houseguest turn, nothing recorded | `recordInteraction` | The scene folds **zero** hidden impact — social play has no consequence and no memory (the point of the game lost) |
| **`_auto_record_deal`** (0039) | Deal-language in the turn's narration, no `makeDeal` | `makeDeal` | The deal never binds, never reconciles against later noms/votes; the deals surface stays empty |
| **`_auto_confide`** (0075) | Player pressed an ally to open up, no `confide` | `confide` | The trust-gated disclosure — the 0075 payoff — never fires |
| **`_auto_expose` / `_auto_trade`** (0093/0099) | Player outed/traded a known secret, no lever call | `exposeSecret` / `tradeSecret` | The marquee offense moves never fire; secrets-as-power is dead weight |
| **`_auto_move_player`** (L21/L24) / **`_auto_move_npc`** (ADR 0009) | Movement language, no `moveTo` / `moveHouseguest` | The positional write | Whereabouts snap-back: the board contradicts the prose next turn |

### 2.3 Game-start / premiere seams

| Belt | Trigger | What the model skipped | Failure mode if the belt breaks |
|---|---|---|---|
| **`_auto_record_casting`** | Player gave a casting answer, no `updateCasting` | `updateCasting` | The name/backstory/motivation never reach the engine; casting never becomes `finalizable`; the season can't premiere |
| **Casting substance ladder** (`_CASTING_SUBSTANCE_LEVEL`) | Casting `ready` but not `finalizable`, lull | Conducting the interview + `updateCasting` | The model re-acknowledges the name forever |
| **createCharacter finalize fallback** (`_CASTING_STALL_LEVEL`, J2-01/#549) | Casting `ready`+`finalizable`, player signalled readiness, model didn't finalize | `createCharacter` | The game never starts — the live walkthrough sat 5+ turns past an explicit "put me in the house" |
| **`apply_game_framing` headshot-on-file note** (A/C 2026-06-20, `CASTING_HEADSHOT_ON_FILE_NOTE`) | Headshot on file, pre-game turn | Trusting the intake instead of re-asking | The model waits on a photo already on file, indefinitely |
| **Premiere `markHouseguestMet` auto-belt** (#380) | Premiere moment, narrated intro matches a still-to-meet houseguest | `markHouseguestMet` | The meet-everyone gate never opens the first HOH — a soft-lock |
| **#1336 house-entry gate hold** (`frontend/src/tool_implementations.py`, `record_house_entry_gate_block`) | `createCharacter` committed while the cast is still being authored | (not a model skip — a pacing hold) | The player walks into an unauthored house (floater cast) |

The pending-decision barrier, the pre-emission outcome guard, and the 0065 desync re-ground are the
adjacent *closed-set sync* layer (feature 0065) — same family, already ledgered (`desyncDetected`,
`staleRejections`).

## 3. The structural options, weighed

Hard constraints, all three cited throughout:

* **ADR 0003** — the conversation is the game. Keep the dynamic DM; the engine hands the model
  *facts to voice*, never *scripts to recite*; nothing force-marches the week.
* **ADR 0005** — never normalize the open set. Only the **closed set** (outcomes, eligibility,
  progression, state truth) may be engine-dictated; the meaning/texture of social play may never be
  flattened to make sync easier. (`expressiveNonCollapse` gates are the proof and must stay green.)
* **Owner ruling** — *error-correct the omission, never engine-author content*. The engine/FE may
  pull the same lever the model was asked to pull; it may never write the player's choice or the
  scene.

### Option (a) — forced `tool_choice` at closed-set beats (the L39b pattern, generalized) ✅ chosen

When the engine knows a beat REQUIRES a specific lever, the FE **forces that tool call on the wire**
(`tool_choice: {"type":"function","function":{"name":…}}`) instead of nudging after the miss.

* **For:** it is a *guarantee*, not a plea — the whole belt history (and the Vault-Wall lesson:
  never rely on prompt wording) says prompts don't guarantee calls. The model still **voices the
  real returned result** (the dynamic DM is untouched; the engine authored nothing). It is
  per-round and additive: the full lever set stays available, spontaneous calling stays primary,
  ordinary turns are byte-identical (`tool_choice` absent). Already proven live: #1154 covers
  comp phases + nominations/veto-ceremony/eviction.
* **Against / hazards (all mitigated, all pinned in `test_tool_choice_force.py`):**
  * **Never force `submitDecision`** — it carries the *player's* binding pick; forcing it would
    make the model invent a choice (the exact opposite of the mandate). An open player pending
    suppresses ALL forcing.
  * **Moment overrides** (the J-3 lesson): the social-runway hold and the witnessed-ceremony
    override must suppress phase-keyed forcing, or forcing re-opens the force-march ADR 0003
    forbids. A `"social"` moment always suppresses.
  * **Provider-dependent:** DeepSeek-V4 400s on `tool_choice` in always-thinking mode — the
    rejecter gate + runtime kill-switch (`force_tool_choice_at_beats`) stay mandatory.
  * **FE-hardcoded beat→lever map:** today the force set is an FE literal
    (`_FORCE_COMP_PHASES`/`_FORCE_ADVANCE_PHASES`). The clean end-state is **engine-signaled** — the
    pending/moment projection carries a `requiredLever` field and the FE forces whatever the engine
    names. That is deliberately **deferred**: it is a `GameSession`/projection surface change (the
    four-place wiring rule), it churns the 0108 golden fixture, and every beat where exactly one
    lever is legal today is already expressible as `advanceGame`-or-`createCharacter` from state the
    FE holds. When a third lever class appears, do the engine field then — as its own spec/queue item.

### Option (b) — a narrower per-moment tool manifest ❌ rejected as the primary

Only offer the tools valid at this beat, so the model can't skip by distraction.

* **For:** smaller prompts; removes dead levers at fully-closed beats.
* **Against (decisive):** it **narrows the open set**. A "ceremony turn" is not guaranteed to stay
  closed — the player can whisper to a neighbor mid-ceremony, walk out, cut a deal in the kitchen
  doorway; the model then needs `recordInteraction`/`moveTo`/`confide`/… that the manifest just
  removed. Where ADR 0005 forbids flattening what can be *played* next, a beat-scoped manifest does
  exactly that, silently, for the whole turn (manifest selection is per-turn; forcing is per-round
  and leaves the full set callable on every other round). And a *missing* tool fails worse than a
  *forced* one: the model can't even error toward the right call. Note the game build already runs
  a curated `GAME_TOOL_KEEP` manifest — the *coarse* version of this option is in place; making it
  per-beat buys little that (a) doesn't, at real open-set risk. Retained only as a possible future
  optimization at provably-closed beats (e.g. a staged finale reveal), never on social turns.

### Option (c) — beat-contract in the system prompt + FE validation before emitting ❌ rejected as the primary

Engine emits "this turn MUST end with X"; the FE validates the finished turn and re-prompts if not.

* **For:** maximum model agency; transparent; no provider dependence.
* **Against (decisive):** the first half **is a nudge** — this project's founding lesson (the Vault
  Wall, mandate #2) is that prompt wording is not enforcement, and the entire §2 inventory is the
  empirical record of prompt-advertised levers going uncalled. The second half **already exists**
  (the pending barrier, the pre-emission outcome guard, the stall ladders) — it is the belt stack
  this doc is trying to make rare, with its known costs: the miss has already happened by
  validation time, re-prompt loops burn tokens/latency, and the one-narration-per-turn invariant
  forbids a second scene, so post-hoc correction must often commit state silently (exactly what
  L39b does). (c) is the *status quo*, kept — as the net, not the answer.

### Decision

**Generalize (a).** Proactive forced `tool_choice` at every closed-set beat where exactly one lever
is legal and the result is the engine's to compute; the reactive belts stay as the net; belt-fire
telemetry (part 3) measures whether the nets are actually going quiet. The engine-signaled
`requiredLever` field is the accepted follow-on shape when the FE-held map next grows.

## 4. The shipped increment

1. **Casting-finalize forced `tool_choice`** (`_forced_tool_choice_for_casting`,
   `frontend/src/agent_loop.py`): pre-game, when the engine says casting is `ready` **and**
   `finalizable`, the game has not started, the **player explicitly signalled readiness**
   (`_player_signals_casting_ready` — a production cue never counts), `createCharacter` is on the
   wire and hasn't fired this turn — the FE forces `createCharacter` on the wire. The gates are the
   **same** ones the reactive finalize fallback already requires (engine-ready + player-asked), so
   no new authority is created: only *when* the guaranteed call happens moves (proactive, so the
   model finalizes and narrates the premiere from the real result, instead of the FE finalizing
   after the fact and re-prompting). Same kill-switch, same rejecter gate. The reactive ladder
   (nudges → forced `do_create_character`) is untouched as the net; the #1312 pre-game context
   purge rides the existing model-called-createCharacter path. Comp/ceremony forcing (#1154) is
   unchanged. `premiere`/`finale`/`twist-reveal` stay deliberately un-forced (their own belts;
   more delicate — unchanged from #1154).
2. **Belt-fire telemetry** (part 3 of the mission): see below.

## 5. Belt-fire telemetry (measure, don't feel)

Every belt firing now increments a **named counter** in the existing Vault-free sync ledger
(`frontend/src/orwell_sync_ledger.py`):

* `note_belt_fire(user, belt, n=1)` — fail-soft, in-memory, per-user pending buffer (belt **names
  only**, bounded; the Vault-free coercion floor applies — no body can pass through a name).
* `record_turn(…)` drains the buffer into the turn entry's new `beltsFired` map
  (`{beltName: count}`), so each ledger turn shows exactly which belts carried it.
* `get_belt_totals(user)` — aggregate over the user's retained ring + pending buffer, the
  playtest-facing "how belt-reliant was this session" read.

Stable belt names (the registry — keep these tokens stable across refactors):
`advance-stall-nudge`, `forced-advance:<why>` (the L39b/silent-commit family, `<why>` =
`preview-commit` / `decision-deliver` / `eviction-drain` / `stall-force` / …),
`forced-tool-choice:<tool>` (#1154 + the casting force), `auto-record-scene`, `auto-record-deal`,
`auto-confide`, `auto-expose-secret`, `auto-trade-secret`, `auto-move-player`, `auto-move-npc`,
`premiere-meet-belt`, `casting-record-belt`, `casting-nudge`, `casting-finalize-force`,
`eviction-reveal-steer`, `ceremony-narration-steer`, `pre-resolve-npc-ceremony`,
`headshot-on-file-framing`, `house-entry-gate-hold`.

Notes: pre-turn belts (framing, pre-resolve) and pre-game belts land on the next recorded turn's
entry (the buffer holds them); under `AUTH_ENABLED=false` the ledger keys everything under the same
`"default"` sentinel the rest of the belt stores use (the NAR-1 lesson), and `get_belt_totals`
includes the pending buffer so single-tenant totals are readable even though per-turn entries
require an owner. The 0079 overseer-debug verdicts remain the *rich* per-turn view; this is the
cheap always-on counter.

**Success criterion for the seam:** on a healthy model, `forced-tool-choice:*` counters may be hot
(the guarantee doing its job, invisible to the player) while the *reactive* counters
(`advance-stall-nudge`, `forced-advance:*`, `casting-nudge`) trend toward zero. A playtest where
the reactive counters stay hot is the signal to extend the force set — with numbers, not vibes.
