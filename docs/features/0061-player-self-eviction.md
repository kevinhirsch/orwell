# 0061 — Player self-eviction (the voluntary walk-out / quit path)

> **Status:** ✅ **BUILT — BDD-gated** (`0061-player-self-eviction.feature` in `cucumber.cjs`).
> A **real, recorded, confirmed** voluntary self-eviction (the player walks out / quits the game) on
> top of **0046** (player eviction & the juror's seat) — reusing that feature's terminal/exit
> `evictionOrder` door (no second hinge), **0047**'s player-authored parting message (offered but
> skippable), and **0023**'s consequence fold. This is the *confirmed* path that the **L39(a)** interim
> refusal stood in for: the GM still REFUSES a narrated-but-unrecorded exit for *unconfirmed/ambiguous*
> lines, while 0061 makes the genuine, explicitly-confirmed walk-out a sanctioned engine action.
> **Owner decisions baked in (see §9):** (1) a confirmed quit **FORFEITS** — the player exits the game
> ENTIRELY (terminal recap) and never takes a juror's seat, in any phase; (2) the parting message is
> **offered but skippable**; (3) legal at **any beat**, resolved at the next safe transition; (4) NPC
> self-eviction is **out of scope**.
> **Engine:** the `self-evict` pending + `submitDecision({kind:"self-evict",confirmed:true})` plus the
> `requestSelfEviction`/`cancelSelfEviction` handshake (`GameSession`); `applySelfEviction` in
> `liveSeason.ts`; the `self-evicted` ceremony fold + forfeit seat in `GameSessionAdapter`. **Tests:**
> `tests/unit/selfEviction.test.ts`, `features/step_definitions/self_eviction.steps.ts`, FE
> `frontend/tests/test_0061_self_eviction.py`.
> **Executable spec:** [`0061-player-self-eviction.feature`](./0061-player-self-eviction.feature)

## 1. Summary

In real _Big Brother_ a houseguest can **voluntarily leave** — walk out the front door, quit, or
self-evict (production frames it as a "self-eviction"). It is distinct from being **voted out**
(0046) and from a fabricated, narrated exit the GM must still refuse (**L39(a)**). 0061 adds the
**genuine, sanctioned path**: a deliberate, **confirmed**, player-level (OOC) decision that flows
through a **real engine lever**, produces a **recorded event** (correct witness set + the 0023
consequence fold), and transitions game state **through the same sanctioned door** as every other
player exit (0046) — never a second eviction or restart path. The non-negotiable line holds: **an
action that is narrated but never recorded has no consequence and no memory** — so a player exit is
*either* a recorded engine transition *or* it didn't happen (and the GM says so).

The departure is a **significant house event** (the daily-event invariant): the house reacts, NPC
souls fold the exit, jury-management ripples land, and — per the 0047 precedent — the player may
author their **own parting message** on the way out. Everything the player/NPCs/admin then see stays
**Vault-free** (the same projection rules as 0046).

## 2. What exists today (the gap this closes)

- **No voluntary-exit lever.** `submitDecision` (0034) has `nominate`/`veto`/`replacement`/`vote`/
  `comp-intent`/`tie-break`/`final-eviction`/`houseguests-choice`/`goodbye-message`/`juror-question`
  — none of which lets the player **choose to leave**. The player can only exit by being voted out
  (0046) or losing a comp ladder rung (0045).
- **The narrated-but-unrecorded exit gap (L39(a)).** A live session had the GM **narrate** "you walk
  out the front door," but the engine never processed it — game state stayed Week 1 with the player
  ACTIVE, and later turns correctly admitted "you never actually left." The interim fix (PR #332):
  the GM **refuses** to fabricate the exit and keeps the player active until the *game* evicts them.
  That refusal is correct **for unconfirmed/ambiguous exits** — but it leaves the *real* mechanic
  (a houseguest genuinely can quit) **unbuilt**. 0061 builds it.
- **No confirmation gate for an irreversible player action.** Self-eviction is permanent and high-
  stakes; the seam has no "are you sure?" handshake, and the **L36** OOC-channel work (a bare meta/
  intent line is an OOC request the *house does not hear*) means an in-character "ugh, I want to
  leave" must **not** be parsed into an eviction. There is no structural place today for a confirmed,
  OOC, deliberate quit.

## 3. Scope

**In:** a new **`self-evict`** binding decision on the 0034 `submitDecision` seam (a deliberate,
**player-level/OOC**, **explicitly-confirmed** decision); the **confirmation handshake** (an
unconfirmed "I want to leave" surfaces a confirmation pending and **never** auto-evicts — the L36/
confirmation gate holds); on confirmation, a **recorded `self-eviction` event** (witness set = the
present house; not hidden) with the **0023 consequence fold**; the **state transition reuses 0046**
(pre-jury ⇒ terminal recap; jury phase ⇒ the owner-decided default below) through the **one
sanctioned door** (no second eviction/restart path); a **significant house event** (daily-event
invariant) with NPC soul folds + jury-management ripple; an **optional player-authored parting
message** (reuse 0047's `goodbye-message` precedent); the whole flow **Vault-free** (extend the 0001
canary).

**Out:** the *who-is-voted-out* mechanic (0046/0011/0034 — unchanged); the eviction-night *staging*
of a normal vote (0047 — reused as the goodbye precedent, not rebuilt); the post-season
unsealing/recap content (0048 — the pre-jury terminal state ties into it, as in 0046); NPC
self-eviction (NPCs do not quit in this spec — out of scope, flagged below); the L39(a) refusal
itself (it **stays** for unconfirmed/ambiguous exits — 0061 only adds the *confirmed* alternative).

## 4. Design

### 4.1 A real, recorded engine action — never narrated-but-not-recorded

Self-eviction is a **first-class engine transition**, identical in kind to any other state change:

```
player confirms self-evict (OOC)  →  submitDecision({ kind: "self-evict", choice: { confirmed: true } })
   →  engine validates the pending + the explicit confirmation
   →  records a `self-eviction` event (witness set = present house; hidden:false)   [0002]
   →  folds the event's hidden impact into the relationship/soul layer               [0023]
   →  transitions player.status through the SAME sanctioned door as 0046             [0046 / D1-R1 hinge style]
   →  persists the snapshot (survives restart)                                       [0030]
```

The GM **never** authors the exit in prose without this transition. If the engine has not recorded a
`self-eviction`, the player is **still in the house** — and the GM says so (the L39(a) line). This is
the project's core invariant applied to player exits: *narrated-but-not-recorded == didn't happen.*

### 4.2 Deliberate + confirmed (the anti-accident handshake)

Because the action is **irreversible and high-stakes**, it requires an **explicit, two-step,
player-level (OOC) confirmation** — it is **never** triggered by an in-character throwaway line:

1. **Intent (no state change).** A bare "I want to leave / I quit / let me out" is, per **L36**, an
   **OOC meta request** — the **house does not hear or react**, and it does **not** evict. Instead the
   engine surfaces a **`self-evict` confirmation pending** (`{ kind: "self-evict",
   options: [confirm, cancel] }`) — a producer/OOC aside that names the stakes ("this ends your game;
   it cannot be undone"). An **ambiguous** statement defaults to **intent**, never to action.
2. **Confirmation (the recorded transition).** Only an **explicit confirm** through
   `submitDecision({ kind: "self-evict", choice: { confirmed: true } })` executes §4.1. **Cancel**
   (or any non-confirming response) clears the pending and **leaves the player active and in the
   house, with no state change** — they simply played on.

The confirmation lives on the **player-level/OOC channel** (the same channel as the Diary Room and
the L36 OOC asides), **never** the in-character channel — so no NPC ever "hears" the deliberation,
and no diegetic line is the trigger. (The marker `((...))`/`ooc:` of L36 is the unambiguous OOC
override the model already honors.)

### 4.3 Outcome wiring — reuse 0046 (by phase)

A self-evictee **is a player exit**, so the terminal handling **reuses 0046 verbatim**, branched by
the **phase at the moment of confirmation**:

- **Pre-jury** ⇒ `player.status: "evicted"` → the **terminal recap** / season-end state (ties to
  0048), exactly as a pre-jury vote-out.
- **Jury phase** ⇒ **OWNER DECISION (see §9).** Real BB typically **forfeits jury eligibility** on a
  voluntary quit/expulsion. **Recommended default: a self-evictee exits entirely** (`player.status:
  "evicted"`, terminal recap) **even in the jury phase** — they do **not** take the juror's seat, do
  **not** cast a finale vote, and the jury size shrinks by one for that season (a faithful, real-BB
  consequence). The alternative (seat them as a juror via 0046's juror path) is left as the flagged
  open question; the tests are agnostic to which the owner picks, asserting only that the transition
  is recorded, sanctioned, and Vault-free.

The transition flows through the **same single sanctioned door** the rest of 0046's exits use — the
live loop's player-exit branch in `liveSeason.ts` — **never** a new eviction or restart hinge (the
project allows exactly one season-restart door, D1/R1; 0061 adds **no** second one).

### 4.4 House reaction + consequences (daily-event invariant)

The departure is a **significant house event**: it satisfies the daily-event invariant for that
in-game day, the present house **witnesses** it (the event's witness set), and **NPC souls fold the
exit** (0023) — a houseguest reacts to a rival/ally walking out (relief, shock, a shifted threat
read), and there are **jury-management ripples** (a player who quit on someone they'd promised
safety to pays for it in the record the same way a betrayal would). The player may author an
**optional parting message** — reusing 0047's player-authored `goodbye-message` precedent (tone is
the player's choice; the engine never speaks for them). Whether a *self*-exit gets the goodbye beat
is a small open question (§9); the recommended default is **yes, offered but skippable**.

### 4.5 Vault Wall

The whole flow is **Vault-free**: the confirmation pending, the recorded event projection, the house
reaction surfaced to the player, and the terminal recap all obey the **same projection rules as
0046** — no hidden scheme, no relationship number, no confessional crosses. Extend the **0001
sentinel canary** to the `self-evict` pending, the `submitDecision` output, and the post-self-eviction
projection / recap (a planted Vault sentinel never reaches any player **or admin** surface).

### 4.6 Timing / legality

A confirmed self-eviction is processed **whenever the player confirms it** — the player can decide to
quit at **any beat**. The engine applies it at the **next safe transition point** so it never
corrupts an in-flight ceremony sub-state machine (e.g. mid vote-reveal or mid veto-draw): the
confirmation is recorded immediately, and the **player-exit transition resolves the current beat
cleanly** before flipping status (the same way the loop already resolves a pending before advancing).
The **default recommendation: self-eviction is legal at any beat**, resolved at the next safe point;
the narrower alternative (only at defined non-ceremony beats) is a flagged open question (§9). Either
way it never overrides the **0005** hard rules of a ceremony already in progress.

## 5. Contracts (stack-agnostic)

```
pending (player/OOC channel):
  { kind: "self-evict", options: [ "confirm", "cancel" ] }       // surfaced on an intent-to-leave; NO state change

submitDecision({ kind: "self-evict", choice: { confirmed: true } }): AdvanceView   // readsVault:false, sentinel-clean
   → confirmed:true  → record `self-eviction` event (witness = present house; hidden:false)  [0002]
                     → 0023 consequence fold; player.status transition via the 0046 door      [0046/0023]
                     → optional player-authored `goodbye-message` (0047 precedent)            [0047]
                     → persist (0030)
   → confirmed:false / cancel / no pending → no-op; player stays active, in the house, unchanged

state: pre-jury  → player.status "evicted" → terminal recap (0048)
       jury-phase→ OWNER DECISION (§9); recommended default: "evicted" + exit (forfeit jury)

invariants: confirmed-and-recorded only (never narrated-but-unrecorded);
            ambiguous/unconfirmed ⇒ intent, never auto-evict (L36/confirmation gate);
            one sanctioned exit door (no second eviction/restart path);
            daily-event satisfied; Vault-free throughout (0001); deterministic + persisted (0030)
```

## 6. Definition of Done

- [ ] **Confirmed self-eviction is a real, recorded transition:** an explicit confirmed `self-evict`
      records a `self-eviction` event (player in the witness set; non-hidden), folds its 0023 impact,
      and flips `player.status` via the **same sanctioned door** as 0046 — persisted, survives restart.
- [ ] **Unconfirmed/ambiguous does NOT evict:** a bare "I want to leave" surfaces the confirmation
      pending and changes **no** state (the L36/confirmation gate holds; no fabricated exit; the house
      neither hears nor reacts to the OOC intent).
- [ ] **Cancel is safe:** declining/cancelling the confirmation leaves the player **active and in the
      house**, state unchanged.
- [ ] **Terminal/jury handling by phase:** pre-jury ⇒ terminal recap (0048); jury phase ⇒ the
      owner-decided default (§9) — reusing 0046's machinery, no new exit path.
- [ ] **The house reacts:** the departure satisfies the **daily-event invariant** and NPC souls fold
      the exit (0023) with jury-management ripple; an optional player-authored parting message is
      offered (0047 precedent).
- [ ] **Vault Wall holds throughout:** a planted Vault sentinel never appears on the `self-evict`
      pending, the `submitDecision` output, the post-exit projection, the recap, or **any admin**
      surface (extend the 0001 canary).
- [ ] Name-agnostic `.feature` (roles only — player/HOH/nominee/juror/houseguest) added to
      `cucumber.cjs`; `npm test` green.

## 7. Dependencies & traceability

Builds **directly on 0046** (player exit terminal/jury machinery + the `player.status` projection)
and reuses the **0034** `submitDecision` binding-decision seam (a new `self-evict` kind, validated
exactly like every other binding choice — never parsed from prose), the **0023** consequence fold,
the **0047** player-authored goodbye precedent, **0002** witness-derived visibility, **0048** for the
pre-jury terminal recap, **0030** durable persistence, and the **L36** OOC/confirmation channel.
Closes the **L39(a)** gap: the GM's interim refusal (PR #332) becomes the correct behavior for
*unconfirmed/ambiguous* exits only, with 0061 the sanctioned *confirmed* path. Under **0001** (Vault
Wall) and **0021** (per-user isolation).

## 8. Implementer-ready (Definition of Ready)

**Touch points (exact):**
- `src/ports/GameSession.ts` — add the `self-evict` pending kind + the `{ confirmed }` choice shape to
  the `submitDecision` contract; the projection mirrors 0046's `player.status`.
- `src/engine/liveSeason.ts` — on a confirmed `self-evict`, branch into the **existing player-exit
  path** (the 0046 branch): resolve the current beat cleanly, record the `self-eviction` event
  (witness = present house; non-hidden), and flip status by phase. **No new exit/restart hinge.**
- The consequence fold (0023) runs in the adapter on the recorded event (`EngineCommandsAdapter`/
  `GameSessionAdapter` fold path) — the same fold any witnessed beat gets.
- `src/engine/momentPrompts.ts` — add a `self-evict` confirmation **OOC** moment fragment (a quiet
  producer aside that names the irreversible stakes); ensure the **L36** classifier routes a bare
  intent-to-leave to OOC intent, not a diegetic line, and never to auto-eviction.
- The optional parting message reuses the 0047 `goodbye-message` pending/`goodbyeMannerFor` fold.
- Extend the **0001** sentinel canary to the `self-evict` pending + `submitDecision` output + the
  post-exit projection/recap.
- FE relay (out of the engine scope, noted for the implementer): the OOC confirmation chip +
  intent→confirm handshake in the agent loop / `submitDecision` relay (mirrors the existing pending
  relays; the model must NOT call `self-evict` confirmed from an unconfirmed in-character line).

**Build order / deps:** after **0046** (player exit machinery) + **0034** (the seam) + **0023** +
**0047** + **0048** — all built. **Test targets:** a new `tests/unit/selfEviction.test.ts` +
`docs/features/0061-*.feature` → `cucumber.cjs`. Assert §6 (esp. the confirmed-vs-unconfirmed gate
and the Vault canary).

## 9. Open decisions for the owner

1. **Jury eligibility on a voluntary quit (the headline call).** In real BB a voluntary
   quit/expulsion typically **forfeits jury eligibility**. **Recommended default: a self-evictee
   exits the game entirely** (`player.status: "evicted"`, terminal recap) **even in the jury phase** —
   no juror's seat, no finale vote, jury shrinks by one for the season (faithful + the cleanest
   consequence). *Alternative:* seat them on the jury via 0046's juror path (more permissive, less
   faithful). The tests are agnostic — they assert the transition is recorded, sanctioned, and
   Vault-free, not which branch fires.
2. **Goodbye / parting message on a self-exit.** Does a *voluntary* walk-out get the 0047
   player-authored goodbye beat? **Recommended default: yes — offered but skippable** (a quitter may
   want to address the house, or just go). *Alternative:* no parting beat for a self-exit (a walk-out
   is abrupt by nature).
3. **Timing / legality of when a quit can fire.** **Recommended default: legal at any beat,** recorded
   immediately and resolved at the **next safe transition point** (never corrupting an in-flight
   ceremony sub-state machine; never overriding 0005). *Alternative:* only at defined non-ceremony
   beats (simpler, but blocks "I'm done" mid-ceremony, which is exactly when a real houseguest snaps).
4. **NPC self-eviction (scope boundary).** This spec covers **only the player**. Should **NPCs** ever
   voluntarily walk out (a soul-driven, rare, twist-governed quit)? **Recommended default: out of
   scope here — defer to a later spec** under the 0025 reserve-twist governance if ever wanted (rare,
   seeded, non-structural). Flagged so it isn't silently assumed.
