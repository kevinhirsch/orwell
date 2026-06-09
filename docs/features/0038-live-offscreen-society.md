# 0038 — Live off-screen society (wire the real simulation into the watcher)

> **Status:** **Partially implemented.** ✅ **Varied off-screen society is LIVE** — the watcher tick
> (`Orchestrator.defaultApply`) now runs `richOffscreenStretch`: **seven real interaction types**
> (alliance/gossip/conflict/bonding/strategy/showmance/betrayal), each folded into the relationship
> layer with its **true nature** (not the old 4-verb stub + a single "strategy" nudge). Bounded,
> seeded, Vault-walled, isolated; unit-gated by `tests/unit/offscreenSociety.test.ts`. **Remaining
> (B27b):** (a) **live gossip→player diffusion** — `diffuseGossip` is built, but routing it through the
> 0031 fail-closed checkpoint trips a **false-positive leak** (the generic `"gossip told-by:npc:Y"`
> provenance string collides between a hidden NPC→NPC retelling and the player's received event); wiring
> it needs the checkpoint's substring leak-heuristic reconciled with legitimate pathway propagation.
> (b) **soul deepening** — the live sandbox has **no `SoulStore`** (`engineRoot.ts` exposes only
> events/knowledge/relationships); wiring `recordToSoul`/`recall` live is **feature 0041**.
> **Executable spec:** [`0038-live-offscreen-society.feature`](./0038-live-offscreen-society.feature)

## 1. Summary

0035 made the house *tick* between turns; 0038 makes that tick **mean something**. Today an idle
sandbox accrues monotype loyalty drift and nothing else — no varied scheming, no information spreading,
no soul deepening. Yet the engine already contains all three behaviors, exercised only by unit tests.
0038 routes the live off-screen advance through them, under the same bounds, seeding, Vault Wall, and
isolation the watcher already guarantees (0031/0035).

## 2. What exists today (the gap this closes)

| Capability | Built in | Wired to the LIVE tick? |
|---|---|---|
| Off-screen tick on idle games | `composition/orchestrator.ts` `defaultApply` → `engine/offscreen.ts` `simulateOffscreenStretch` | ✅ but **thin** (4 verbs + 1 `applyDirected`) |
| Varied social sim (7 types, alliance form/fracture, betrayal, surfacing) | `engine/simulation.ts` `simulateSeason` | ❌ **test-only** |
| Knowledge propagation NPC→NPC (drift/confidence/provenance, ends at player) | `engine/gossip.ts` `diffuseGossip`; `KnowledgeService.transmitGossip` | ❌ **test-only** |
| Soul evolution from off-screen life | `adapters/engine/SoulStore.ts` `recordToSoul` / `recall` | ❌ **test-only** |

Net: the house's between-turn life is a 4-verb stub; the rich society never runs live.

## 3. Scope

**In:** route the live off-screen advance (`Orchestrator`'s apply step, behind the 0035 watcher) through
the **rich** interaction sim (varied types + alliance form/fracture + bounded betrayal + rare hidden-element
surfacing), run **gossip diffusion** over the social graph each stretch (so beliefs travel NPC→NPC and
drift), and **fold each off-screen scene into the soul** (`recordToSoul`) and relationships
(`applyDirected`). Keep it **bounded** (`maxOffscreenTicksPerWake`, 0031), **seed-deterministic**,
**Vault-walled** (all hidden; only a pathway terminating at the player updates player knowledge — as a
distorted belief with source + confidence, never a number), and **per-user isolated**. Add **0035 + 0038**
to `cucumber.cjs` (0035 is not BDD-gated today).

**Out:** rebuilding the sim/gossip/soul modules (reused, not rewritten); the watcher cadence/idle/bounds
(0031/0035); player-initiated surfacing (`surfaceInformationTo`, already live); the weekly *ceremony* loop
(0034 — this is the **between-beat** society, not the HOH→eviction spine).

## 4. Design

- **Rich apply step.** Replace the orchestrator's thin `defaultApply` content with the `simulateSeason`-class
  generator: each off-screen stretch yields a *varied* set of NPC-to-NPC scenes (alliance talk, gossip,
  conflict, bonding, strategy, showmance, betrayal) the player doesn't witness — bounded per wake. Each scene
  is a hidden event (witness set excludes the player) recorded to the `EventStore` (0002).
- **Gossip diffusion.** After the stretch, run `diffuseGossip` over the social graph: hidden beliefs travel
  NPC→NPC, **drifting** (content distortion) with **decaying confidence** and tracked **provenance/hops**.
  When a diffusion pathway **terminates at the player**, update player knowledge with the (possibly
  distorted) belief + its source + confidence — so the player later *hears a rumor*, true or not. Diffusion
  itself stays in the hidden layer (0002).
- **Soul fold.** Fold each off-screen scene's hidden impact into the actor's/witness's **soul**
  (`recordToSoul`, append-only — non-degradation, 0024) and the **relationship** edges (`applyDirected`,
  0023/0026). `recall` becomes usable live (a later narration can surface a *specific* remembered slight).
- **Bounds & determinism.** All of it runs inside the existing `advance(user, "offscreen-tick")` under
  `maxOffscreenTicksPerWake`, seeded by the per-user RNG (0031) — identical seed + identical ticks ⇒
  identical society. **Fail-closed** integrity checkpoint still applies (no degradation/leak).
- **Vault Wall.** Every off-screen scene + every diffusion hop is **hidden**; the player surface shows **no
  opinion numbers** — only later behavior and the rumors that reach them by pathway (sentinel-clean).

## 5. Contracts (stack-agnostic)

```
Orchestrator off-screen apply (per idle tick, bounded):
   scenes   = richOffscreenStretch(house, rng)        // varied hidden NPC↔NPC events (0003-class)
   for each scene: events.record(hidden); rel.applyDirected(...); soul.recordToSoul(...)
   diffuseGossip(graph, rng)                           // NPC→NPC belief travel; drift+confidence+provenance
       → on a pathway terminating at the player: knowledge.update(player, belief{source,confidence})
   (all hidden; player projection stays sentinel-clean; bounded by maxOffscreenTicksPerWake; seeded)
```

## 6. Definition of Done

- [ ] **Varied life:** between turns an idle house produces **multiple interaction types** (not one canned
      verb) — alliances shift, conflicts and bonding happen off-screen (assert variety, not a single kind).
- [ ] **Information travels:** a hidden fact **diffuses NPC→NPC** with **drift + decaying confidence +
      provenance**; a rumor can **reach the player** through a terminating pathway as a belief carrying a
      **source + confidence** (possibly distorted) — and **never a number**.
- [ ] **Souls deepen:** off-screen scenes **append to souls** (`recordToSoul`, monotonic — 0024/0007) and
      become **recall-able** live; relationships move (`applyDirected`).
- [ ] **Bounded + deterministic:** capped per wake (no season fast-forward); same seed + same ticks ⇒
      identical society.
- [ ] **Vault-free + isolated:** the player sees no opinion numbers/hidden scenes (extend the 0001 canary to
      the live off-screen path); one user's society never bleeds into another's (0021).
- [ ] **BDD-gated:** add **0035** and **0038** to `cucumber.cjs`; name-agnostic (roles only); `npm test` green.

## 7. Dependencies & traceability

The **content** behind **0035**'s watcher: reuses **0003** (off-screen richness), **gossip.ts/0002**
(knowledge propagation), **simulation.ts** (varied sim), **0023/0026** (consequence fold), **0024**
(`SoulStore` recall) — under **0001** (Vault Wall) and **0021** (isolation), bounded by **0031**. Closes the
gap the 0035 draft itself flags as highest-priority: the house must not just *tick* but *live*.

## 8. B27b — live gossip→player diffusion + the checkpoint reconciliation

**The trap (found while wiring B27a).** Routing `diffuseGossip` through the **0031 fail-closed checkpoint**
produces a **false-positive leak** that rolls back every advance. The 0031 leak check is a coarse
substring heuristic — `hidden.some(c => playerView.includes(c))` — and gossip breaks it two ways:
1. **Provenance collision.** `transmitGossip` records each retelling as an event whose content is the
   generic `"gossip told-by:npc:Y"`. The *same string* is both a **hidden** NPC→NPC retelling and the
   **player's received** (non-hidden) event when a rumor reaches them — so a hidden event's content
   "appears" in the player view, and the heuristic cries leak.
2. **Superset content.** `distort()` *appends* a hedge to the original, so a verbatim hidden fact is a
   substring of the rumor the player legitimately hears.

**The principle.** A leak is hidden content reaching the player **without a pathway**. Gossip **is** a
pathway — recorded transmissions + a `KnowledgeFact` with provenance/confidence. Content the player
**legitimately holds via a knowledge pathway is not a leak**, even if it overlaps hidden content. The
0031 substring check conflates "propagated by a traceable pathway" with "leaked."

**The fix (buildable).**
- **(a) Refine the 0031 leak heuristic to be pathway-aware.** Flag a hidden event's content as a leak
  only if it appears in the player projection **and is not covered by the player's legitimate knowledge**
  (their `KnowledgeService` facts / witnessed events). Concretely: exclude, from the leak comparison, any
  content the player holds as a `KnowledgeFact` with a pathway (gossip "told-by", "overheard",
  "surfaced"). The 0001 **sentinel canary stays the precise Vault-Wall guard** (seeded secret *values*
  never appear) — this only stops the runtime heuristic from false-flagging traceable propagation.
- **(b) Keep the rumor a vague paraphrase** (never the verbatim hidden scene — defense in depth; already
  the approach in the B27a draft: "word is X and Y have something going on").
- **(c) Then wire `diffuseGossip` into the off-screen tick** over a house graph with a **low transmit
  probability** (partial, distorted spread — not everyone hears everything), reaching the player only via
  a terminating pathway, as a belief with **source + confidence**, never a number.
- **(d) Add 0035 + 0038 to `cucumber.cjs`.**

**Acceptance (B27b):** a hidden fact diffuses NPC→NPC with drift/decay/provenance; a rumor reaches the
player as a pathway belief (source + confidence) — and the **0031 checkpoint still commits the advance**
(no false leak) **while the 0001 sentinel canary stays green** (no real secret value leaks). Bounded,
seeded, isolated.
