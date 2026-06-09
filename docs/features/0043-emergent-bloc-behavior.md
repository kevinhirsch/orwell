# 0043 — Emergent multi-party bloc behavior

> **Status:** Draft. _Big Brother_ is **bloc politics** — three- and four-person alliances coordinate
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
crossing a threshold** at decision time (bounded to plausible BB bloc sizes), returning **transient** blocs
each carrying derived `{ members, sharedTarget (top aggregate threat outside the bloc), cohesion }`; a **bloc
term** added to NPC decision leanings (vote with bloc-mates, shield bloc-mates from nomination, target the
shared enemy); automatic **fracture** (a betrayal / large trust drop simply yields a smaller/split bloc on
the **next** detection — nothing to update); all **read through each holder's own framing** and **recomputed
every time**.

**Out:** any **stored** alliance/bloc object or ally/enemy label (forbidden — 0002; the serialized soul must
contain **no** bloc); a formal "join alliance" player action; persisting membership; the pairwise relationship
math itself (reused — 0017/0026).

## 4. Design

- **Detection.** `detectBlocs(rel, active)` builds an undirected "mutual-bond" graph (edge iff both
  directions' bond ≥ threshold) and greedily forms clusters bounded to size ~2–5 (BB-plausible). Each bloc
  derives a **shared target** = the highest **aggregate threat** the members hold toward someone outside the
  bloc, and a **cohesion** = the weakest internal bond. Pure, seeded, **stateless** — same edges ⇒ same blocs.
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
detectBlocs(rel, active): Bloc[]        // Bloc = { members[], sharedTarget, cohesion }; PURE, stateless, seeded
decisionLeaning(npc, ctx) += blocTerm   // vote-with / shield bloc-mates; target sharedTarget (bounded; layered)
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
- [ ] **Vault-free + deterministic:** no bloc roster on any player surface (extend the 0001 canary); same
      edges/seed ⇒ same blocs; name-agnostic; added to `cucumber.cjs`; `npm test` + `npm run test:arch` green.

## 7. Dependencies & traceability

Honors **0002** (organic, unstored alliances — the crux) by **deriving** blocs from the **0017/0026**
relationship edges; the bloc read feeds **0011/0014** (nominations/votes) and fractures via **0023/0039**
(betrayal); under **0001** (Vault Wall) and **0007** (nothing stored), isolated per **0021**. Gives the house
real bloc politics — coordinated targeting and dramatic collapses — without a single stored label.
