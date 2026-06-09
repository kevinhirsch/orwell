# 0040 — NPC Diary Room confessionals (Vault-only interiority)

> **Status:** Draft. NPCs get their **own** Diary-Room confessionals — a private, **Vault-only** read of
> the game that grounds their voice and strategy. Today `"confessional"` is only an **event-type enum**
> (`domain/event.ts`, `ports/VaultStore.ts`) with **no mechanism** that generates one, gives it content,
> or feeds it back into behavior. This feature defines **when** confessionals trigger, **what** they
> contain (engine-grounded from the soul + relationships — not free narration), and **how** they feed the
> soul — while staying **absolutely walled** from the player *and* the admin. MISSING today.
> **Executable spec:** [`0040-npc-confessionals.feature`](./0040-npc-confessionals.feature)

## 1. Summary

Real _Big Brother_ cuts to houseguests alone in the Diary Room saying what they actually think. The player
never hears those (that's the audience's view, not a houseguest's) — but the *fact that the NPC has a real,
consistent private read* is what makes them feel like a person rather than a prop. 0040 makes NPC
confessionals an explicit, engine-grounded, Vault-sealed mechanic: at dramatic beats an involved NPC
"confesses" their current target, trust/distrust, and plan — **derived from the engine's relationship truth,
not invented** — recorded Vault-only and folded into the soul so their later behavior and voice stay
consistent with it.

This is the **inverse** of 0013 (the *player's* DR, which is the player's own OOC knowledge with no NPC
pathway). An NPC confessional is the *NPC's* off-screen interiority with **no pathway to anyone**.

## 2. What exists today (the gap this closes)

- `"confessional"` is an enumerated **Vault event type** (`domain/event.ts`, `ports/VaultStore.ts`) and a
  passing mention in `momentPrompts.ts` — but **nothing generates one**, stores its content, or reads it back.
- NPC interiority is only *implicit* in the soul (0024); there is no discrete "private read at a dramatic
  beat" mechanic, so NPC voice/strategy can drift from their actual engine state (an anti-sycophancy risk:
  the narrator could improvise an NPC's "true feelings" instead of reading them).

## 3. Scope

**In:** a **confessional generator** that fires for **involved** NPCs at dramatic beats (post-nomination,
pre-vote, post-blindside, win/eviction — driven by the schedule 0008/0034 + a rare temperature-gated extra);
**content grounded in the engine** (the NPC's current **target** by threat, their **trust/distrust** reads,
their **plan**) computed from soul + relationships (0017/0024); recorded as a **Vault-only event** (witness
set = `{npc}`, `hidden`); **folded into the soul** (`recordToSoul`, append-only) so it accumulates and is
**recall-able** to keep that NPC's later voice/behavior consistent.

**Out:** the **player's** DR (0013 — separate, OOC, the player's knowledge); surfacing confessionals to
**anyone** (player or admin — they are Vault-only); narration quality (the engine supplies the *grounded
read*; the LLM may *voice* it only when legitimately recalling for that same NPC, never leaking it to others).

## 4. Design

- **Triggers.** Beat-driven (0008/0034): each ceremony/eviction/blindside enqueues confessionals for the
  directly-involved houseguests; a bounded, **temperature-gated** extra fires rarely for color (0028). Seeded.
- **Grounded content.** `confessionalFor(npc, beat)` builds a Vault-only content record from the NPC's
  **relationship reads** (top threat = current target; trust/affinity = allies; betrayal-shock = grudges)
  and soul — so a confessional **states the engine's truth** about that NPC's game, not an invented stance.
  This is the anti-sycophancy point: an NPC's "real feelings" are *queried*, not improvised.
- **Vault-only recording.** Recorded as event type `confessional`, `hidden: true`, witness set `{npc}` (the
  player is **never** a witness) — so by the 0002 visibility model it can never enter player knowledge.
  Folded into the soul (`recordToSoul`, 0024) — monotonic (0007).
- **Feedback.** When the narrator later voices **that** NPC, `recall` can surface their confessional so the
  voice stays consistent with their private read. The confessional **never** informs another NPC's knowledge
  or the player (no pathway — the wall is structural).
- **Wall (the crux).** Confessionals are Vault content. **No player surface and no admin/God-Mode surface**
  returns them (God Mode is walled from the Vault too — spoilers ruin the game). The 0001 sentinel canary is
  extended to confessional content on **both** surfaces.

## 5. Contracts (stack-agnostic)

```
confessionalFor(npc, beat): Confessional        // content grounded in soul + relationship reads (engine truth)
record: event{ type:"confessional", hidden:true, witnessSet:[npc] }   // player NEVER a witness (0002)
fold:   soul.recordToSoul(npc, confessional)     // append-only (0024/0007); recall-able to ground later voice
wall:   no player OR admin surface returns confessional content (sentinel-clean both — 0001/0016)
```

## 6. Definition of Done

- [ ] **Generated at beats:** involved NPCs confess at dramatic beats (post-nomination, pre-vote, post-
      blindside, eviction), seeded + bounded, with a rare temperature-gated extra.
- [ ] **Engine-grounded (anti-sycophancy):** a confessional reflects the NPC's **actual** relationship reads
      — their top-threat target, who they trust, their grudges — not an invented stance.
- [ ] **Vault-sealed from everyone:** confessionals never reach the **player** *or* **admin/God Mode**
      (extend the 0001 canary to both surfaces); witness set excludes the player (0002).
- [ ] **Feeds the soul + voice:** confessionals append to the soul (monotonic, 0024/0007) and are recall-able
      to keep that NPC's later voice/behavior consistent.
- [ ] Seed-deterministic; persisted (0030); name-agnostic (roles only — HOH/nominee/juror); added to
      `cucumber.cjs`; `npm test` + `npm run test:arch` green.

## 7. Dependencies & traceability

The **NPC inverse of 0013** (player DR), under **0001** (Vault Wall, incl. **0016** God-Mode walling) and
**0002** (witness-derived hidden visibility), grounded in **0017** (relationship reads) + **0024** (`SoulStore`
recall), beat-driven by **0008/0034**, temperature-gated by **0028**, persisted by **0030**. Gives every NPC a
real, private, engine-true interior the narrator can voice consistently — fidelity the player feels without
ever seeing.
