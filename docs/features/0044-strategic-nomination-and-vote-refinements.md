# 0044 — Strategic nomination & vote refinements

> **Status:** Draft — an **enhancement**, not a new system. The NPC **nomination** and **vote** engines are
> already **built, live, and relationship-driven** (`season.ts` `chooseNominations`, `liveSeason.ts`
> `npcChoice`, `jury.ts` `castJuryVote`) — the engine decides, not the narrator. The audit found two real
> **thinnesses**: nominations key on **`threat` only** (so an HOH always names the two biggest threats — no
> pawns, no backdoors), and eviction votes **ignore the voter's emotional state, bloc, and any deal**. This
> feature enriches both decision functions with those dimensions — still fully **engine-decided** and seeded,
> a sibling to the 0026 relationship constants.
> **Executable spec:** [`0044-strategic-nomination-and-vote-refinements.feature`](./0044-strategic-nomination-and-vote-refinements.feature)

## 1. Summary

The base engines aren't broken — they're flat. A real HOH doesn't just nominate the two scariest people:
they put up a **pawn** beside a target, plan a **backdoor**, or **protect their bloc**. A real voter isn't a
pure threat calculator: a **rattled** houseguest votes self-protectively, a **bloc** votes together, a
**deal** is honored or broken. 0044 layers these strategic dimensions onto the existing `chooseNominations`
and `npcChoice` — gated by personality/disposition so different houseguests play differently — without
rebuilding the loop and without letting the narrator decide anything.

## 2. What exists today (the gap this closes)

- **Nominations = top-2 threat.** `season.ts` `chooseNominations` ranks `active` by `rel.edge(hoh, x).threat`
  and takes the two highest. Correct but one-dimensional — no pawn, backdoor, or bloc protection.
- **Votes = higher-threat nominee.** `liveSeason.ts` `npcChoice` votes for the scarier nominee (HOH tiebreak).
  The voter's **emotional state isn't an input** (it feeds competitions, not votes); **bloc** (0043) and
  **deal status** (0039) aren't factored.
- The jury vote (`castJuryVote`) is already richer (lean + manner + appeal) — left as-is.

## 3. Scope

**In:** a **nomination strategy** layered on `chooseNominations` — a blended score (threat primary) plus
**pawn-beside-target**, **backdoor** (nominate to bait the veto, then target on the replacement), and
**bloc protection** (0043) patterns, **gated by the HOH's personality/disposition** (a strategic archetype
backdoors; a loyal one shields their bloc; an emotional one targets erratically — read from `CHARACTER`/soul);
and a **vote model** layered on `npcChoice` blending **threat + bloc alignment (0043) + emotional state
(0041) + deal honor/break (0039) + jury-management awareness**. Both stay **engine-decided**, **bounded**,
**seeded**, and **tunable from one constants module** (sibling to 0026/0028).

**Out:** rebuilding the weekly loop (0011) or the jury (0014); the relationship math (0026 — reused as the
substrate); the *binding-decision seam* (0034); turning this into a new system (it's a refinement). The new
inputs depend on **0039/0041/0043** — the **threat/trust/political-temperature** parts can ship first, the
**bloc/mood/deal** terms as those features land.

## 4. Design

- **Nomination strategy.** `nominationStrategy(hoh, active, rel, blocs, week)` produces two legal noms (0005)
  from a blended read: threat (primary) + the **week's political temperature** (the house-wide threat
  distribution — is there a runaway threat? a quiet week?) + **bloc protection** (don't nominate bloc-mates) +
  **archetype-gated tactics** (pawn / backdoor / direct). The *which-tactic* choice is gated by the HOH's
  disposition, so HOHs feel distinct. The favorite target still usually goes up — but not always *both*
  biggest threats, and sometimes via a backdoor.
- **Vote model.** `voteChoice(voter, finalNominees, rel, blocs, mood, deals)` blends threat + **bloc alignment**
  (vote with your bloc, 0043) + **emotional state** (0041 — a rattled/distressed voter weights self-protection
  and is more erratic; a confident one steadier) + **deal status** (0039 — honor a vote deal, or break it with
  the betrayal consequence) + light jury-management awareness. Bounded; the HOH still breaks ties.
- **Engine-decided (anti-sycophancy).** Every nomination and vote is computed from these signals + seeded
  temperature — **never** parsed from or decided by narration. Personality/disposition come from the static
  `CHARACTER` + evolving soul; the magnitudes live in **one tunable constants module**.
- **Vault Wall.** All signals are hidden; the player sees only the resulting noms/votes and infers the
  strategy. No score/number on any player surface (sentinel-clean).

## 5. Contracts (stack-agnostic)

```
nominationStrategy(hoh, active, rel, blocs, week): [nomA, nomB]   // legal (0005); threat-primary + pawn/backdoor/bloc, archetype-gated
voteChoice(voter, finalNominees, rel, blocs, mood, deals): nominee // threat + bloc(0043) + mood(0041) + deal(0039) + jury-mgmt
constants: ONE tunable module (sibling to 0026/0028) — no magnitude hard-coded outside it
invariants: engine-decided + seeded; bounded; never overrides 0005; player sees no number
```

## 6. Definition of Done

- [ ] **Strategic nominations:** noms reflect more than raw threat — **pawns, backdoors, and bloc protection
      appear**, gated by HOH disposition — while threat still dominates the target choice; the two biggest
      threats are **not always both** nominated.
- [ ] **Richer votes:** an eviction vote folds **bloc + emotional state + deal status** — a rattled, or
      bloc-aligned, or deal-bound voter votes **measurably differently** than the bare threat model.
- [ ] **Engine-decided (anti-sycophancy):** every nomination and vote is computed from the signals + seeded
      temperature — never narration; the favorite outcome holds in aggregate with strategic variation.
- [ ] **Tunable + bounded + deterministic:** magnitudes live in **one module**; emotion/bloc/deal terms never
      override hard rules (0005); same seed ⇒ same decisions.
- [ ] **Vault-free:** no score/number on any player surface (extend the 0001 canary); name-agnostic; added to
      `cucumber.cjs`; `npm test` green.

## 7. Dependencies & traceability

Enriches the **built** `chooseNominations`/`npcChoice` (0011/0014) on the **0017/0026** relationship substrate,
adding the **0043** bloc, **0041** emotional-state, and **0039** deal signals, all **engine-decided** under
**0001** (Vault Wall) and seeded. Honors the user's two highest-priority asks (NPC nomination & vote engines)
the right way: the systems exist — this gives them the strategic dimensions that keep the game from feeling
one-note, without ever letting the storyteller decide.
