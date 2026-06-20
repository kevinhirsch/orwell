# 0063 — Casting diversity floor (a cast that authentically reflects the country)

> **Status:** ✅ **BUILT — BDD-gated** (#352; `0063-casting-diversity-floor.feature` in `cucumber.cjs`). The guaranteed, engine-seeded diversity FLOORS for the
> cast (BIPOC representation, gender balance, age spread, LGBTQ+ representation) plus an **organic,
> character-driven sexual-orientation model** that ties into **0059**'s seeded showmance layer. This
> spec **extends** the existing variety-via-CAPS machinery (ledger **L28** spread helpers in
> `src/engine/characterFactory.ts`) and the **0058** physical-characteristics facet
> (`src/engine/deepProfile.ts`, `src/domain/physicalCharacteristics.ts`); it adds **minimums**, not
> just maximums. Orientation disclosure is **Vault-sealed** state that surfaces only through in-game
> pathways (0002), governed exactly as **0025 / 0059** reserve content.
> **Design-intent reference (STRUCTURE & SPIRIT ONLY — never the named legacy cast):**
> `docs/legacy/meta-feedback/genesis-design-session.md` ("I really want this cast to be diverse. In
> age, gender, race, experience. Please make this a good reflection of country." + the explicitly
> wanted queer showmance) and `docs/legacy/BB_ProducersVault.md` (the showmance discipline: *"must
> develop entirely organically through gameplay… The AI must never push this connection
> artificially"*). **Executable spec:** `0063-casting-diversity-floor.feature` (skeleton; NOT yet in
> `cucumber.cjs` — added when built to green, exactly as 0058 Phase 1's feature was).

## 1. Summary — the gap this closes

A real *Big Brother* cast (and the original design) deliberately reflects the country: people of
color, a gender balance, a genuine age range, and queer houseguests. Today the engine has
**variety-via-CAPS** (L28: no single vocation, region, body type, demeanor, or voice register may
dominate the 15-cast) — but it has **no FLOORS**:

- **No guaranteed minimum BIPOC representation.** Appearance is drawn per-NPC off `APPEARANCE_POOLS`
  and skin/ethnicity lives in 0058's `physicalCharacteristics.skinTone`, but nothing *guarantees* a
  minimum number of houseguests of color — a seed could deal a near-monochrome cast.
- **No gender balance target.** Names are sampled from a mixed-gender corpus with no gender tag, so
  the gender split is incidental, not balanced.
- **An age floor but no enforced spread.** L18c guarantees `age ≥ 21` (BB-eligible); the draw skews
  young (min-of-two), but nothing guarantees the cast *spans* generations.
- **Sexual orientation isn't modeled at all.** The only queer content in the project is legacy
  reference docs. There is no orientation attribute, no representation floor, and no way for a
  showmance to be queer.

0063 closes all four with **engine-guaranteed floors** validated/repaired at cast creation (the same
discipline as L28's caps — *guaranteed, not hoped-for-from-the-LLM*), and adds a **sexual-orientation
model** handled the owner's way: **organic, character-driven, Vault-walled, never tokenizing.**

## 2. Design principles (the non-negotiables for this subject matter)

1. **Authentic, never tokenizing or reductive.** Diversity is the **depth of a full character**, not a
   defining single word (ties to L19 "richer than one word" and L28 non-mirroring). Ethnicity and
   orientation are **facets of a real person**, never a label that *is* the person. A houseguest is
   never "the gay one" or "the Black one" on any surface — they are a whole person whose identity is
   one true facet among many.
2. **Floors are GUARANTEED in code, like L28's caps.** The engine seeds, then **validates and repairs**
   the cast to meet each floor before sealing — never relies on the LLM or a hopeful draw. (The L28
   caps already validate/repair; floors are the symmetric operation.)
3. **Orientation disclosure is the character's own, surfaced organically.** Each houseguest has a
   generated orientation, but **whether and how it is known is character-driven**: some are publicly
   out (a public facet), some hold it privately (a **Vault-sealed** attribute that reaches the player
   ONLY through an in-game pathway — 0002). Never forced, never telegraphed, never sensationalized —
   exactly the legacy discipline: *"must develop entirely organically… the AI must never push this."*
4. **Representation must read as a genuine, country-reflecting cast.** Handled with care and dignity:
   no stereotyping, no caricature, the spread reads as real people, not a checklist.
5. **The Vault Wall is absolute.** A private/closeted orientation is hidden state until the player
   learns it organically — never on a player **or** admin/God-Mode projection, never derivable from a
   stat, never in `npcVoice` or the moment prompt until a pathway surfaces it (mandate #2).
6. **Determinism / replayability holds.** Floors hold across seeds; orientation and the
   ethnicity-grounded identity facet are **seeded**, so the same seed ⇒ the same cast (0004/E38).

## 3. The four floors (engine-guaranteed, seeded at cast creation)

All thresholds live in a **single new tunable constants module** —
`src/engine/diversityConstants.ts` — the sibling of `decisionConstants.ts` /
`relationshipConstants.ts` / `temperatureConstants.ts` (no magnitude hard-coded at a call site; the
existing grep gate covers it). Each floor is a **minimum**; L28's caps remain the **maximums** — the
two together force a balanced spread, not just an un-clumped one.

| Floor | What it guarantees | Builds on |
|---|---|---|
| **BIPOC representation** | At least `MIN_BIPOC` houseguests of color across the 15-cast, grounded in an **ethnicity/skin-tone identity facet** (extends 0058 `physicalCharacteristics.skinTone`). | 0058 physical facet; L28 appearance spread |
| **Gender balance** | The cast is **balanced**, not incidental — neither binary gender below `MIN_PER_GENDER` (a near-even split target, e.g. the genesis "8/7"). Names then sample from the matching corpus so name and presentation cohere. | the mixed-gender name corpora (`src/engine/data/`) |
| **Age spread** | The cast **spans** the eligible range, not just clusters young: at least `MIN_PER_AGE_BAND` in each of a small set of age bands (e.g. 20s / 30s / 40s+), on top of the L18c `age ≥ 21` floor. | L18c age floor; `generateAppearance` |
| **LGBTQ+ representation** | At least `MIN_QUEER` houseguests have a non-straight orientation across the cast (see §4). | the new orientation model (§4); 0059 |

- **Validate / repair, exactly as L28's caps.** The factory deals the cast cast-wide off the seeded
  rng; a post-pass **checks each floor and repairs the minimum number of picks** to satisfy it
  (swap the next legal-ish draw, never loop forever — the same guard-budget discipline `spreadFacet`
  already uses). Repair is deterministic per seed.
- **Floors + caps are jointly satisfiable.** The pools/corpora are large enough that
  `MIN_BIPOC ≤ … ≤ MAX` etc. hold comfortably for a 15-cast; the constants module documents the
  satisfiability margin (like `MAX_PER_DEMEANOR`'s "12 builds / ≤2 each covers 15" note).
- **The ethnicity-grounded identity facet** extends the existing `physicalCharacteristics.skinTone`
  cue into the floor's countable axis. **Open decision (§9):** whether ethnicity is a *full identity
  attribute* (named heritage, a real person's background) or *appearance-grounded only* (skin-tone /
  complexion cue, the lighter-touch option) — recommendation in §9.

## 4. The orientation model (organic, character-driven, Vault-walled)

Every houseguest gets a **seeded sexual orientation**. The model has two layers, split across the
Vault Wall by **disclosure**, not by the orientation itself:

- **PUBLIC layer — the out houseguests.** A houseguest who is **publicly out** carries orientation as
  an *observable* facet (the house knows; it may color their voice/persona like any other public
  trait). This is Vault-free public `CHARACTER` data — the same status as appearance or hometown.
- **HIDDEN layer — the private / not-yet-out houseguests.** A houseguest who holds their orientation
  **privately** carries it as a **Vault-sealed attribute** (a new hidden field on the soul/Vault
  record): it **never** appears on any player or admin projection until the player learns it through a
  modeled in-game pathway (0002 — witnessed, told, overheard, gossip-diffused). The player may come to
  *suspect* without *knowing*; knowledge arrives only when a pathway terminates at them, possibly as a
  belief with a source + confidence (and gossip drift). This is the legacy *"out in real life but
  hasn't led with it in the house"* texture, modeled structurally.

Disclosure is **character-driven**: which houseguests are out vs. private is a seeded property of who
they are, not a uniform rule. Orientation is **never** derivable from a stat, never a competition
input, never telegraphed by a banner; it surfaces (if at all) only as **behavior and pathway-borne
knowledge**, exactly as a secret in 0058 does. **This is the L28-style depth applied to identity:** an
orientation is one true facet of a whole character, never the character.

### 4.1 Tie to 0059 — the seeded queer showmance / pre-game tie

0063 makes the **0059** seeded-relationship layer **orientation-aware** so it can seed a **queer
showmance or pre-game tie**:

- The 0059 showmance seeder may pair two houseguests whose orientations make a same-gender (or any)
  romance plausible — a **queer showmance** is a first-class possible seed, not a special case. (The
  genesis design explicitly wanted this: *"I would LOVE to explore a queer showmance storyline."*)
- It surfaces under **exactly the 0025/0059 reserve governance** — sealed from player AND admin,
  **sparse** (0–2 showmances, the L40 saturation guard holds), non-structural, and **organic
  reveal-as-event only**: it begins as proximity/recognition, deepens over weeks, and becomes visible
  to the house **only once it has earned it**. **Never week-one instant, never pushed.** A
  closeted/private partner's orientation stays Vault-sealed until a pathway surfaces it — the
  showmance's becoming-visible IS one such pathway.
- **Player queer showmances are earned, never asserted** (0059 §4 / anti-sycophancy): if the player
  cultivates one, it develops; the engine never pushes the player into a romance or asserts the
  player's interest.
- **No orientation-gated determinism.** Orientation informs *who a showmance could be*, never a
  competition outcome, a vote, or a hard rule. It is texture and drama, never a mechanical edge.

## 5. Vault-Wall guarantees (the non-negotiables)

- **A private orientation never reaches the player OR the admin** until a modeled pathway surfaces it —
  sentinel-tested on the player surface, the admin/God-Mode surface, `npcVoice`, and the moment prompt
  (extends the 0001 canary, exactly as 0058/0059 do). Dependency-cruiser stays green (no outward
  `VaultStore`/`SoulProvider` import).
- **The player learns a private orientation only through an in-game pathway** (0002), and even then
  holds it as a *belief* with a source/confidence — suspicion ≠ knowledge.
- **A seeded queer showmance is sealed under 0059/0025** and surfaces only organically; its existence,
  partners, and stage never cross to player or admin until a pathway earns it.
- **Anti-sycophancy:** orientation and ethnicity never bend an outcome — the deterministic core +
  seeded randomness decide; the narrator only voices what is public or what a pathway has surfaced.

## 6. Authentic, never reductive (the dignity discipline)

- **Identity is a facet, not a label.** No surface ever reduces a houseguest to their ethnicity or
  orientation; both are woven into a full §3-depth profile (0058) — one true detail among many, read
  through the character's own framing (the L19/L28 anti-one-word discipline applied to identity).
- **No stereotyping.** The spread reads as real, country-reflecting people; the constants and any
  authoring guidance forbid caricature and tokenizing shorthand. Diversity is depth and dignity, not a
  checklist of types.
- **Tone guidance** (recommendation, §9): orientation is handled with the same restraint as any
  Vault-sealed secret — surfaced organically, never sensationalized; a queer showmance is *compelling
  television played straight*, not a spectacle. The narrator voices it as it would any genuine human
  connection.

## 7. Determinism & non-degradation

- **Floors hold across seeds**; orientation and the ethnicity facet are seeded ⇒ **same seed ⇒ same
  cast** regardless of who the player is (0004/E38; never mirrors the player's identity, per L28).
- **The public facets are byte-stable** (0007/0031 superset + byte-compare guard the new public
  identity facets, as the L28 facets already are). A **private orientation** persists in the Vault and
  never silently resets; a seeded showmance's stage only advances (0059 non-degradation).

## 8. Testability (structural where possible)

- **Floors hold across seeds:** over many seeds, the cast meets `MIN_BIPOC`, `MIN_QUEER`, the gender
  balance, and the age-band spread — asserted as property thresholds (like L28's caps and 0003's
  richness thresholds), never on named fixtures.
- **Floors + caps coexist:** the same cast satisfies the L28 maximums and the 0063 minimums together.
- **No-leak sentinel:** a planted sentinel in a private-orientation field never appears on any player
  **or** admin surface, in `npcVoice`, or in the moment prompt; it surfaces only after a pathway.
- **Pathway-only disclosure:** a sealed private orientation reaches the player's knowledge ONLY after a
  modeled pathway terminates at them; absent a pathway it stays Vault-only (player may suspect).
- **0059 queer showmance:** across seeds, the seeded-showmance layer can produce a queer showmance, and
  it surfaces only organically under the 0025/0059 governance (sparse, earned, never week-one).
- **Non-reductive:** no surface reduces a houseguest to a single identity word (the profile carries
  multi-facet depth — structural assertion paralleling L19/0058).
- **Seeded reproducibility:** same seed ⇒ byte-identical cast identity facets and orientation
  assignment; player-independent.

## 9. Open decisions for the owner

1. **The exact floor numbers.** Recommendation for a 15-NPC cast (the genesis design as the anchor):
   `MIN_BIPOC ≈ 5–6` (a third-plus of color), gender target **near-even** (e.g. `MIN_PER_GENDER ≈ 7`,
   an 8/7-style split), age bands **≥ 1–2 each** in 30s and 40s+ (so it isn't all 20s),
   `MIN_QUEER ≈ 1–2`. **Owner to set the precise numbers** — these are tunable constants and a single
   ruling fixes them.
2. **Ethnicity: full identity attribute vs. appearance-grounded only.** *Recommendation:*
   **appearance-grounded-plus** — extend 0058's `skinTone` into a richer **complexion/heritage cue**
   that's countable for the floor and feeds the portrait + narration, **without** minting a named
   "race" enum the engine reasons over (avoids a reductive label; keeps identity as lived depth in the
   profile, not a checkbox). The owner may instead want a fuller heritage attribute if the FE wants to
   reflect it explicitly.
3. **How strongly orientation ties into the 0059 showmance seeding.** *Recommendation:* orientation
   **informs eligibility** for a seeded showmance pairing (so a queer showmance is possible and
   plausible) but **never forces one** — the L40 sparseness/earned discipline dominates. The owner may
   want a stronger guarantee (e.g. "at least one season in N seeds carries a queer showmance") or to
   leave it purely emergent.
4. **Gender model granularity.** Binary balance target (the genesis "8/7") vs. a broader gender model
   (non-binary representation as its own floor axis). *Recommendation:* start with a balance target
   over the existing mixed-gender corpora; a broader model can be a follow-on if the owner wants it,
   to avoid over-reaching the corpora today.
5. **Sensitivity / tone guidance.** *Recommendation:* a short authoring-guidance note (consumed by the
   0058 profile authoring + the narrator framing) that forbids stereotyping/caricature, treats
   orientation disclosure as the character's own (organic, never sensationalized), and frames a queer
   showmance as a genuine human connection — *compelling television played straight*, per the legacy
   discipline. The owner confirms the exact wording.

## 10. Out of scope / relationships

- **Out:** portrait *generation* itself (0051/L29 consume the facet); the soul-evolution math (0041);
  the relationship math (0026); the showmance stage-advancement scheduler (0059 §5 deferred follow-on
  — 0063 makes it orientation-aware, it does not build it); any dating-sim UI or player-facing
  "relationship status."
- **Extends:** **L28** (variety-via-caps → adds the symmetric floors), **0058** (the
  `physicalCharacteristics` facet → the ethnicity-grounded identity axis), **0059** (seeded
  relationships → an orientation-aware queer showmance/pre-game tie).
- **Reuses:** **0002** (pathway-only surfacing, knowledge vs. suspicion), **0025** (reserve sealing +
  governance for private orientation & seeded showmance), **0001** (the wall), **0007/0030/0031**
  (byte-stable public facets + durable Vault persistence), **0004/E38** (seeded determinism).
