# 0043 — Emergent multi-party bloc behavior

> **Status:** **Built** (B32, green 2026-06-10). **PO amendment 2026-07-13:** the artificial five-person
> size cap (`BLOC.maxSize`) was **removed** — the clique requirement (every member mutually bonded with every
> other) is now the *only* limiter, so a genuine majority alliance forms when the trust supports it. Calibration-
> safe: `juryReach` re-confirmed in band (large all-trust cliques are rare enough not to move the seeded
> distribution). _Big Brother_ is **bloc politics** — three- and four-person alliances coordinate
> nominations and votes and shatter on betrayal. Today the engine has **no multi-party construct at all**:
> relationships are **pairwise** edges (`relationships.ts`), and `allianceActive(a, b)` is just a *bilateral*
> threshold read — so NPCs never move *together*. This feature adds an **emergent bloc read**: transient
> blocs **computed from the relationship graph at decision time** (with a derived shared target), driving
> coordinated bloc behavior and fracture — **never stored as an ally/enemy label**, honoring decision
> **0002** (alliances are organic, emergent, unstored). The right way to close the "alliance model" gap
> without reversing an accepted ADR.
> **Executable spec:** [`0043-emergent-bloc-behavior.feature`](./0043-emergent-bloc-behavior.feature)

## 1. Summary

Decision 0002 deliberately forbids a stored alliance object (no roster, no ally/enemy flag). But the audit
gap is real: because everything is pairwise, the engine cannot represent that A, B, and C vote as a unit,
share a target, and collapse when A betrays C. 0043 resolves this **within** 0002: it **detects** blocs by
clustering the relationship graph **on demand** (mutual bonds), reads a bloc's **shared target**, lets bloc
membership **shift NPC decisions**, and lets a betrayal **fracture** the bloc — all **computed every read,
persisted never**. The bloc is an emergent property of the edges, not a thing the game stores.

## 2. What exists today (the gap this closes)

- **Pairwise only.** `relationships.ts` edges are directed bilateral signals; `allianceActive(a,b)` returns a
  bilateral boolean from mutual bond ≥ `allianceThreshold`. There is **no 3+-person cluster, no shared
  target, no bloc**.
- **Decisions read pairwise.** `chooseNominations`/`npcChoice` rank by a *single* `rel.edge(...).threat` —
  nothing represents "vote with my people" or "the alliance's target."
- **0002 (the constraint):** "An 'alliance' is not stored." So the fix must be **derive, don't store**.

## 3. Scope

**In:** an **emergent bloc detector** `detectBlocs(rel, active)` that clusters houseguests by **mutual bond
crossing a threshold** at decision time (bounded only by the clique requirement — no artificial size cap, so a genuine majority alliance can form when the trust supports it; PO ruling 2026-07-13), returning **transient** blocs
each carrying derived `{ members, sharedTarget (top aggregate threat outside the bloc), cohesion,
loyaltyStrength }`; a per-character **loyalty read** (dispositional, from the static `CHARACTER`, modulated
by the evolving soul — 0041) whose member-wise aggregate is the bloc's **loyalty strength** (§4); a **bloc
term** added to NPC decision leanings (vote with bloc-mates, shield bloc-mates from nomination, target the
shared enemy) **scaled by loyalty strength**; automatic **fracture** (a betrayal / large trust drop simply
yields a smaller/split bloc on the **next** detection — nothing to update), with **per-member defection
susceptibility** read from that member's own loyalty; all **read through each holder's own framing** and
**recomputed every time**.

**Out:** any **stored** alliance/bloc object or ally/enemy label (forbidden — 0002; the serialized soul must
contain **no** bloc); a formal "join alliance" player action; persisting membership; the pairwise relationship
math itself (reused — 0017/0026).

## 4. Design

- **Detection.** `detectBlocs(rel, active)` builds an undirected "mutual-bond" graph (edge iff both
  directions' bond ≥ threshold) and greedily forms clusters bounded **only by the clique requirement**
  (every member mutually bonded with every other) — **no artificial size cap** (PO ruling 2026-07-13): a bloc
  is exactly as large as the mutual trust supports, so a real majority alliance forms when the whole group
  genuinely trusts each other. Each bloc
  derives a **shared target** = the highest **aggregate threat** the members hold toward someone outside the
  bloc, and a **cohesion** = the weakest internal bond. Pure, seeded, **stateless** — same edges ⇒ same blocs.
- **Loyalty (the ethereal↔static dial — product feedback 2026-06-10).** Without a loyalty dimension every
  bloc is equally sticky: either all blocs dissolve on any edge wobble (too ethereal) or all hold until a
  formal betrayal (too static). Each houseguest carries an independent **loyalty read** — derived from their
  static `CHARACTER` disposition (a loyalist vs. a free agent, the 0026 disposition-factor family) and
  modulated by their **current soul state** (0041 — a freshly-betrayed loyalist's effective loyalty dips).
  A bloc's **`loyaltyStrength`** is the member-wise aggregate (weakest-member-weighted: a bloc is only as
  loyal as its flightiest member matters more than its average). Loyalty strength **scales the bloc term**:
  a high-loyalty bloc votes together near-deterministically and shields hard; a low-loyalty bloc is a loose
  read that individual incentives (a better outside bond, self-preservation on the block) override easily.
  **Per-member defection** is read the same way — a low-loyalty member with a tempting outside bond peels
  off first, *before* any formal betrayal event. Like everything else here it is **derived per read, never
  stored** (0002): loyalty lives in `CHARACTER`/soul (already persisted), the bloc's strength is recomputed
  from it every detection.
- **Behavior.** NPC decision leanings (nominations/eviction votes/initiative, 0011/0014) gain a **bloc term**:
  an NPC nudges toward **voting with** bloc-mates, **not nominating** bloc-mates, and **targeting the bloc's
  shared enemy** — bounded, layered on the existing threat/trust read (never overriding hard rules 0005). The
  player, in a bloc with NPCs, is shielded/targeted accordingly — earned by their own relationship history,
  not scripted.
- **Fracture.** Because blocs are recomputed, a betrayal (0026/0039) that drops an edge **automatically**
  splits or shrinks the bloc on the next decision — no stored membership to reconcile. A collapsed bloc simply
  stops being detected.
- **0002 + Vault Wall.** Nothing is stored: the serialized soul/save holds **no bloc/label** (cross-check
  0007). Blocs are **hidden** (a derived read of hidden edges); the player **infers** alliances from behavior
  and is **never shown a roster** (sentinel-clean). Anti-sycophancy: bloc behavior is **computed from the
  relationship truth**, never narrated into being.

## 5. Contracts (stack-agnostic)

```
detectBlocs(rel, active): Bloc[]        // Bloc = { members[], sharedTarget, cohesion, loyaltyStrength }; PURE, stateless, seeded
loyaltyOf(member): number               // derived: CHARACTER disposition × current soul state (0041); never stored per-bloc
loyaltyStrength = aggregate(loyaltyOf(members), weakest-weighted)   // the bloc is as loyal as its flightiest member
decisionLeaning(npc, ctx) += blocTerm × loyaltyStrength             // vote-with / shield / target sharedTarget (bounded; layered)
defection: a low-loyalty member with a stronger outside bond peels off BEFORE any formal betrayal
fracture: implicit — a dropped edge (betrayal) yields a smaller/split bloc on the NEXT detectBlocs (nothing stored)
invariants: NO bloc/label persisted (0002/0007); blocs hidden; player sees behavior only; never overrides 0005
```

## 6. Definition of Done

- [ ] **Emergent, not stored:** blocs are **detected from the graph** at decision time; the serialized
      soul/save contains **no** bloc or ally/enemy label (cross-check 0007/0002).
- [ ] **Shared target:** a detected bloc derives a **shared target** from the members' aggregate threat.
- [ ] **Coordination:** bloc-mates **vote together** and **shield each other** from nominations measurably more
      than chance, and **target the shared enemy** — over the existing pairwise read.
- [ ] **Fracture:** a betrayal that drops a bond **fractures** the bloc on recomputation (a smaller/split bloc,
      or none) — no stored state.
- [ ] **Loyalty spreads the feel:** a high-loyalty bloc holds together **measurably** longer/tighter than a
      low-loyalty bloc under the same pressure (seeded assertion); a low-loyalty member **defects** to a
      stronger outside bond without a formal betrayal event; the same bloc's strength **shifts** when a
      member's soul state shifts (0041) — neither ethereal nor static.
- [ ] **Vault-free + deterministic:** no bloc roster on any player surface (extend the 0001 canary); same
      edges/seed ⇒ same blocs; name-agnostic; added to `cucumber.cjs`; `npm test` + `npm run test:arch` green.

## 7. Dependencies & traceability

Honors **0002** (organic, unstored alliances — the crux) by **deriving** blocs from the **0017/0026**
relationship edges; the bloc read feeds **0011/0014** (nominations/votes) and fractures via **0023/0039**
(betrayal); under **0001** (Vault Wall) and **0007** (nothing stored), isolated per **0021**. Gives the house
real bloc politics — coordinated targeting and dramatic collapses — without a single stored label.

## 8. Implementer-ready (Definition of Ready)

**Touch points (exact):**
- **New** `src/engine/blocs.ts` — `detectBlocs(rel, active): Bloc[]`, PURE + stateless. Build the
  mutual-bond graph from `RelationshipModel.edge(a,b)` (`relationships.ts` L81; `EdgeSignals
  {trust,affinity,threat}`) — an undirected edge iff both directions' bond `(trust+affinity)/2` ≥ the
  `allianceThreshold` (already a model field, L63; reuse it). Greedy-cluster with **no size cap** — the
  clique requirement is the only limiter (PO ruling 2026-07-13). Each `Bloc`
  derives `{ members, sharedTarget (max aggregate threat outside the bloc), cohesion (weakest internal bond),
  loyaltyStrength (weakest-weighted aggregate of the members' derived loyalty — CHARACTER disposition ×
  soul state, §4) }`. Loyalty + defection constants live as named constants in `blocs.ts` alongside the
  bloc-size bound.
- Wire a **bloc term** into the decision reads: `season.ts` `chooseNominations` (L72) and `liveSeason.ts`
  `npcChoice` (~L169) — shield bloc-mates, target the shared enemy. (0044 enriches further; 0043 lands the
  basic term so blocs *do something*.)

**Build order / deps:** none to build `detectBlocs` (it reads existing edges). It's the input 0044's
nomination/vote strategy consumes — land `detectBlocs` + a basic decision term here; 0044 deepens it.

**Test targets:** `tests/unit/blocs.test.ts` + `docs/features/0043-*.feature` → add to `cucumber.cjs`.
Assert §6: blocs **derived not stored** (serialize `SessionSnapshot` — `sessionSnapshot.ts` — and confirm
**no bloc/label**, cross-check 0007), a shared target, bloc-mates coordinate > chance, **fracture on
betrayal** (drop a bond via `applyDirected(...,"betrayal")`, recompute → smaller/split bloc), **loyalty
spread** (high- vs low-loyalty bloc under the same pressure; a low-loyalty member defects to a stronger
outside bond pre-betrayal), Vault-free (no roster on any player surface — extend the 0001 canary),
seed-deterministic.

**No open decisions.** Crux is **ADR 0002**: never store an alliance/ally/enemy label — `detectBlocs` runs
every read and persists nothing. Bloc-size bound + thresholds live as named constants in `blocs.ts`.
