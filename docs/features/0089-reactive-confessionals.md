# 0089 — Reactive confessionals (the Diary Room remembers what just happened)

> **Status:** ✅ **BUILT (2026-06-27) · BDD-gated in `cucumber.cjs`.** Tracks issue **#866**.
> **Depends on:** 0040 (NPC confessionals — `confessionalFor` / `recordConfessional` / `involvedConfessionals`
> + the `ConfessionalContext.trigger` this generalizes), 0002 (event visibility & the witness-derived
> hidden flag — confessionals are `witnessSet:[npc]`, never the player), 0017/0026 (the relationship reads a
> confessional is still grounded in), 0041 + `emotionalArc` (the live soul/mood the confessor speaks from),
> 0007/0030 (persistence — the event log a reactive confessional reads back, and the soul it deepens). **Sibling
> of** 0084 (voice makes the *register* real; this makes the *subject matter* real) and 0075 (both turn a
> static templated read into an event-anchored beat). **Relates to** the #839 fix (the threat≠ally guard in
> `confessionalFor` — this feature keeps and extends that grounding). **Bounded by** mandate #2 (Vault Wall —
> a confessional is Vault-only NPC content and must leak no *other* hidden state), mandate #3 (anti-sycophancy
> — the **engine** supplies the facts; the model only voices them and never invents an outcome), mandate #1
> (behavioral fidelity) and mandate #4 (non-degradation — the house remembers).

> **Owner direction (tracked under #866):**
> *"Confessionals feel canned — 'I need X gone; Y is the one I trust.' They should REACT to what just
> happened to that houseguest, the way a real Diary Room cut does — 'after the veto ceremony, when they left
> me on the block…'."*

## The problem this fixes

NPC confessionals exist (0040) and are correctly **engine-grounded** — a houseguest confesses their *real*
top-threat target and strongest bond, queried from the relationship model, never invented (the #839 fix even
guarantees the same houseguest is never named as both biggest threat and most-trusted). They are also
correctly **Vault-sealed** (`witnessSet:[npc]`, `hidden:true`) and they **deepen the soul** so a houseguest
can recall their own interiority.

But the *content* is **static and atemporal**. `confessionalFor` composes from two standing reads (target,
ally) plus, at best, a hard-coded **trigger label** string (`ConfessionalContext.trigger` = "the nomination
ceremony" / "the veto ceremony" / "the eviction vote") and a coarse mood word. So every confessional sounds
like a profile readout — *"I need {T} gone — they're my biggest threat. {A} is the one I actually trust."* —
no matter **what concretely just happened to this person**. A real Diary Room cut is the opposite: it is a
*reaction* to a specific, recent, witnessed beat — *"after the veto ceremony, when they left me on the
block… I'm done playing nice with them."* The houseguest is processing the **event**, not reciting their
standings.

That gap is a fidelity loss (mandate #1) and a non-degradation loss (mandate #4): the house's memory exists
in the event store, but the most human surface for *expressing* that memory ignores it. This feature closes
it — a confessional **reacts to concrete recent events the confessor witnessed or was part of**, with the
**engine** selecting those events as facts and the **model** voicing them.

## The core idea — the engine selects the recent event(s); the model voices the reaction

```
beat fires (a ceremony / eviction / off-screen tick)
  → engine selects the confessor's RECENT RELEVANT events from the EventStore
       (events whose witnessSet includes this NPC — what THEY witnessed or were part of),
       ranked by recency + salience, last N within a recency window
  → engine builds a Vault-only ConfessionalContext enriched with those FACTS
       (event type, the confessor's role in it, the concrete content gist — never another's hidden state)
  → confessionalFor composes a confessional that REFERENCES the real event
       ("after <the recent beat that happened to them>, …") + the existing grounded target/ally/mood
  → recorded Vault-only (witnessSet:[npc], hidden) — reaches no one (0002)
  → folded into the confessor's soul (deepens; recall-able; non-degradation)
  → later, when the model voices THIS npc recalling, it speaks the reaction in their voice
```

The reactive part is **additive** to 0040's grounding, not a replacement: the confessional still names the
engine-true target and bond (the #839-guarded reads stay), but now it is *occasioned by* and *opens with* a
concrete thing that actually happened to that houseguest.

### What "react to" means precisely (the engine's selection)

The engine selects from the **append-only event log** (`EventStore.query({ witnessedBy: npc })` /
`eventsSince`), restricted to events the confessor legitimately knows — i.e. their **own witness set**. The
selection is:

- **Recent** — within a bounded recency window (last few beats / a tunable lookback), so a confessional
  reacts to *now*, not to week 1.
- **Relevant to them** — events where this houseguest is the `initiator` or in the `witnessSet`: a comp they
  played, a nomination they were named in or made, a veto ceremony that left them on/off the block, a vote
  they survived, a scene they had with the player or another houseguest, a hidden element of theirs that
  surfaced. **Their** game, not a global board read.
- **Salient** — ranked so a beat that *changed their standing* (put them up, saved them, evicted an ally)
  outranks ambient flavor; ties broken by recency. The top one (or two) becomes the reaction's anchor.

The selected event(s) are passed to the confessional composer as **structured facts** — the event's type,
the confessor's role in it, and a **Vault-safe gist of its own content** — never a number, never another
houseguest's hidden read, never anything outside the confessor's own witness set.

### Why this is engine-as-source-of-facts, never model-as-author (anti-sycophancy + ADR 0005)

This is the same bright line 0040, 0075 and 0084 hold, applied to the confessional's *subject matter*:

- **The engine decides WHAT happened.** Which recent events the confessional reacts to, and what the
  reaction's factual content is, are computed by the engine from the recorded event log + the relationship
  model. The model never selects an event and never invents one. It cannot "remember" a blindside that the
  store does not record, and it cannot soften or upgrade an outcome to suit the drama — the facts are handed
  to it.
- **The model only VOICES.** The model turns the engine-supplied facts into that houseguest's in-character
  Diary Room line, in their 0084 voice and 0041 mood. This is **open-set** work (ADR 0005): the *texture* of
  how they process the beat is the model's to render richly and is recorded losslessly; the *facts and the
  outcome* are **closed-set** and engine-owned. A confessional may be as expressive as the scene while never
  asserting a competition result, a vote tally, a nomination, or any board outcome the engine did not
  produce — exactly the litmus ADR 0005 sets (it never collapses the open onto the closed, and never lets a
  voiced reaction restate an outcome into being).
- **Determinism holds.** Selection + composition are seeded (the existing
  `seed:confessional:<npc>:<week>:<beat>` rng), so the same seed + same history ⇒ the same confessional
  reacting to the same event(s). No model nondeterminism enters the *facts*.

For the **live ceremony path** the confessor's own confessional is composed engine-side (in
`GameSessionAdapter`) and recorded Vault-only; the narrator never sees another houseguest's confessional. For
any path where the model voices a houseguest *recalling* their own confessional (0040's soul-recall feedback),
the model is handed only that houseguest's own already-recorded, already-Vault-sealed content.

## The Vault Wall (the crux — read carefully)

A confessional is **Vault-only NPC content** and this feature must not weaken that:

1. **Still witnessed by the confessor alone.** Every reactive confessional is recorded exactly as 0040 does —
   `witnessSet:[npc]`, `hidden:true` — so by the 0002 visibility model it can **never** enter the player's
   knowledge, and the admin surface (which reads no events) never sees it either. The `validateEvent`
   invariant (an unwitnessed event must be hidden) still holds.
2. **The facts a confessional reacts to are the confessor's OWN witness set — never a free read of the
   Vault.** The engine selects only events `witnessedBy` the confessor. It must **not** enrich a confessional
   with another houseguest's hidden read, another's confessional, an off-screen scene the confessor was not
   in, or any sealed attribute the confessor does not hold. A reactive confessional reacts to *what this
   person lived*, not to omniscient board truth — the same perspective-bound rule 0086 holds for drives.
3. **No new pathway to the player.** This feature changes *what a confessional says*, not *who hears it*.
   There is no surfacing of confessional content to the player or admin. (If a houseguest later *tells* the
   player something, that is the existing 0002 / 0075 pathway machinery, recorded as a player-witnessed
   event — out of scope here.)
4. **The leak sentinel is extended.** The 0001/0040 no-leak sweep is extended over the reactive
   confessional's assembled content and its enriched `ConfessionalContext`: no other houseguest's sealed
   state, no number, ever appears — on the player surface or the admin surface. The structural Vault-Wall
   test (no outward module imports `VaultStore`) is unaffected; this is engine-internal enrichment of an
   already-Vault-only record.

So the player still **never reads** a confessional. The payoff lands two legitimate ways, both already in the
architecture: the houseguest's **later behavior** is consistent with what they confessed (the soul fold
bends their play), and the confessional becomes part of the **0048 post-season retrospective** unsealing —
where, *after* the season, the player finally reads the real, event-anchored interiority the house kept the
whole game. That is the Vault Wall working: the reaction is real, recorded, and invisible in play.

## ADR 0003 fit (the conversation is the game)

This feature **hands the model facts to voice, never a script to recite** — it removes a canned line and
replaces it with engine-true, event-anchored facts the model renders in character. It augments the existing
confessional beat; it adds no dashboard and no new player-facing UI. The Diary Room stays a *voiced* beat,
now occasioned by the real recent event — exactly ADR 0003's "augment the chat intelligently, never replace
an interaction." It also refines ADR 0005: the confessional's reaction is open-set texture recorded
losslessly, while the events it reacts to and any outcome stay closed-set and engine-owned.

## Engine seams (where this lands)

- `src/engine/confessionals.ts` — extend `ConfessionalContext` with an optional, Vault-safe
  **`recentEvents`** field: a small ordered list of `{ type, role, gist }` facts (the confessor's own
  witnessed events), already selected + redacted by the caller. `confessionalFor` composes the reaction
  **from those facts** when present (opening the line with the concrete beat), and falls back to today's
  `trigger`-label behavior when absent — so **no `recentEvents` ⇒ byte-identical to 0040** (additive,
  back-compatible). Pure, seeded, no I/O, no Vault handle (it is *handed* the already-read, already-redacted
  facts — same discipline as 0075's `confidence.ts`).
- `src/engine/confessionals.ts` (or a small sibling) — a pure **selector/ranker**
  `selectRecentForConfessional(events, npc, now, opts)` that, given the confessor's already-`witnessedBy`-
  filtered events, ranks by recency + salience and returns the top N within the window as Vault-safe gists.
  Pure + seeded; selection over existing events only (consumes no rng beyond a seeded tiebreak).
- `GameSessionAdapter.recordCeremonyConfessionals` / `confessorsFor` — the live ceremony path already builds
  a per-confessor `ConfessionalContext`. Extend its `ctxFor` to read the confessor's recent witnessed events
  (`this.events.query({ witnessedBy: npc })` / `eventsSince`), redact them to Vault-safe gists, and pass
  `recentEvents`. Engine-side; nothing crosses to the player.
- `Orchestrator.defaultApply` — the off-screen tick's single confessional (the confessor of a freshly-folded
  scene) likewise gains the recent-events enrichment from that NPC's own witness set, so off-screen
  confessionals react too.
- **No new port, no new MCP tool, no FE-driven write-back.** This is engine-internal enrichment of an
  existing Vault-only record; it does not touch the player channel, so the four-place write-back gotcha does
  not apply. The narrator already never receives another houseguest's confessional.

## Persistence (0007/0030 — non-degradation)

- A reactive confessional is an ordinary recorded `confessional` event — already durable; it **deepens, never
  thins**. Because it now embeds the concrete beat it reacted to, the persisted interiority is *richer* over
  a season, not flatter (the explicit anti-goal vs. the old version's degrading secret store).
- The soul fold (`recordConfessionalToSoul` + the durable `soul.memory` mirror) is unchanged: append-only,
  monotonic, replayed on restart so a houseguest can recall their own past reactive confessionals.
- Selection reads the append-only log via the existing `query`/`eventsSince` seam — no new persisted state is
  required for v1 (the events are already stored).

## Acceptance criteria

- [ ] **Reactive content:** at a dramatic beat, an involved houseguest's confessional **references a real,
      recent event from that houseguest's own witness set** (a comp they played, a nomination/veto/eviction
      that touched them, a scene they had) — not only the standing target/ally readout. A role-only test
      asserts the confessional content names the recent beat the engine selected.
- [ ] **Engine supplies the facts (anti-sycophancy):** the events a confessional reacts to, and their
      factual gist, are selected by the engine from the recorded event log — never invented by the model. A
      test asserts the selection comes from `EventStore` events the confessor witnessed, and that with **no**
      qualifying recent event the confessional degrades gracefully to the 0040 grounded read (no fabricated
      event).
- [ ] **No fabricated outcomes:** a reactive confessional never asserts a competition result, vote tally,
      nomination, or any board outcome the engine did not produce — it reacts to what is recorded
      (closed-set untouched, ADR 0005).
- [ ] **Perspective-bound to the confessor's witness set:** the selector returns only events `witnessedBy`
      the confessor; a confessional never reacts to an off-screen scene the confessor was not in, another
      houseguest's confessional, or any sealed state they do not hold.
- [ ] **Vault-sealed from everyone:** the reactive confessional is recorded `witnessSet:[npc]`, `hidden`; it
      never reaches the **player** or **admin/God Mode**; the no-leak sentinel finds no *other* hidden state
      and no number in its content or context. (The confessor's own already-witnessed events are theirs to
      voice; nothing of anyone else's leaks.)
- [ ] **Feeds the soul + voice (non-degradation):** the reactive confessional appends to the soul
      (monotonic, recall-able), so the houseguest's later voice/behavior stays consistent with the
      event-anchored read.
- [ ] **Deterministic + back-compatible:** seeded — same seed + same history ⇒ same confessional reacting to
      the same event(s); with `recentEvents` absent the fold/content is **byte-identical to 0040**.
- [ ] Role-only (HOH / nominee / evictee / veto winner / NPC / player); added to `cucumber.cjs` when built;
      `npm test` + `npm run test:arch` green.

## Open questions / defaults (resolve at build)

1. **Recency window + N.** How far back to look and how many events to anchor on — start with the **last 1–2
   salient events within the current + previous beat**, tuned so the reaction reads fresh, not historical.
   (A tunable in a `CONFESSIONAL`/sibling constants module, the `THREAD`/`GOSSIP` pattern.)
2. **Salience ranking.** The exact weighting of "changed my standing" (on/off the block, an ally evicted,
   a comp won/lost) vs. social scenes vs. ambient flavor. Default: standing-changing beats outrank social
   beats outrank flavor; recency breaks ties.
3. **Gist redaction shape.** How a witnessed event's content is reduced to a Vault-safe gist (the confessor's
   own witnessed content is theirs to voice, but the gist should be a *fact reference*, not a verbatim dump
   of another participant's words). Start: event type + the confessor's role + a short class-keyed phrase;
   verify against the leak sentinel.
4. **Off-screen NPC↔NPC reactions.** v1 enriches the confessor's *own* witnessed events. A confessional
   reacting to a scene the confessor witnessed *between two others* (jealousy, suspicion) is a natural
   enrichment — in scope only insofar as it stays within the confessor's witness set; a louder
   "they saw something" beat is a possible follow-on.
5. **Player-scene reactions.** A confessional reacting to a scene the player was *in* with the confessor is
   legitimate (the player witnessed it too — it is not secret), and is a strong fidelity beat (the
   houseguest's private take on a conversation the player remembers). Confirm at build that this reads as the
   houseguest's interiority, never as leaking a *hidden* read of the player (the read stays Vault; only the
   *fact of the scene* is referenced).

Tracks #866.
