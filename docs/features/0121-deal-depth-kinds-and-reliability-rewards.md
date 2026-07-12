# 0121 — Deal depth: active-obligation kinds + reliability rewards

> **Status:** **Part 1 built** (the active-obligation kinds — engine adjudication + flag + BDD). **Part 2
> to follow (same branch):** the live-loop reconciliation that auto-triggers the new kinds (a `compete`
> action after a comp, a `veto-use` action after the veto ceremony), the three reliability rewards, and the
> FE deal-extraction of the new kinds. The flag `ORWELL_DEAL_DEPTH` is **not yet in the deploy** — it opts in
> once Part 2 lands (so the new kinds can never be half-wired in production: off ⇒ they can't be made).
> **PO expansion of the 0039 review** (2026-07-12). 0039 made deals
> first-class and engine-adjudicated, but (a) every kind is a *defensive* "don't move against me" promise,
> and (b) keeping a deal is under-rewarded relative to breaking it (a modest trust/reliability build vs. a
> large, multi-channel betrayal hit). This feature adds the *active* promises and makes reliability a
> **felt positive**.
> **Calibration-safe by construction:** all new behavior is gated behind a dedicated flag `ORWELL_DEAL_DEPTH`
> (default OFF); off ⇒ 0039/0109 behavior exactly (byte-identical seeded spine). Enabled in the live deploy.
> **Executable spec:** [`0121-deal-depth-kinds-and-reliability-rewards.feature`](./0121-deal-depth-kinds-and-reliability-rewards.feature)

## 1. Two dials

### A. Two new ACTIVE-obligation deal kinds

Today's four kinds (`safety`/`vote`/`final-two`/`target-other`) are all *negative* obligations — a break is
"a bound promisor moves adversely against the protected party." The other half of _BB_ dealmaking is
*positive* obligations — promising to **do** something for someone — where a break is a **failure to act**:

- **`comp-throw`** — "I'll throw this competition for you." The promisor pledges NOT to try to win the next
  competition they play. **Broken** when they compete/win it anyway; **kept** when they throw it. Adjudicated
  from the competitor's own comp behavior (`compete`/`throw`/`play-safe` intent, 0006b) — never prose.
- **`veto-save`** — "If I win the veto and you're on the block, I'll use it on you." **Broken** when the
  promisor holds the veto, the promisee is a nominee, and they do NOT save them; **kept** when they pull
  them down. Adjudicated from the veto-use decision — never prose.

Both are **one-way** (the promisor is bound; the protected party is `parties[1]`), week-scoped (they resolve
at that comp / that veto ceremony), and reuse the whole 0039 consequence machinery on break (betrayal-shock
+ jury demerit + witnessed reveal).

### B. Reliability as a felt reward (a mix of all three)

Keeping a deal already builds a hidden, non-decaying **reliability** signal (evidence, not sentiment) that
feeds the jury (weight 0.4) and the nomination-safety read — but it is subtle and back-loaded. This makes it
a positive you can play toward, three ways (all hidden, engine-computed, **no number ever shown**):

1. **Reputation that spreads (the positive mirror of the betrayal rumor).** A kept deal seeds a hidden
   *"keeps their word"* reputation belief that **diffuses NPC→NPC** (0038 gossip). A houseguest who has
   heard it reads the reliable player as a **safer, more-appealing deal partner** — reliability buys future
   opportunity (the honest-player path).
2. **A reliable ally protects you.** A partner whose deals you have kept weights you **lower as a nomination
   target** and **higher as someone to protect** — the existing reliability→bond link, strengthened and
   surfaced as real protective behavior (they spare you, keep their own deals with you).
3. **Loyalty streaks compound.** Consecutive kept deals with the SAME partner apply an **escalating** honored
   fold (a "we've never broken faith" bonus, bounded) — a rock-solid alliance builds faster the longer you
   both hold the line.

## 2. The mechanic — additive, pure, gated

- **Domain (`src/domain/deal.ts`):** extend `DealKind` with `comp-throw`/`veto-save`; extend `BindingAction`
  with a `compete` kind (+ `outcome: "threw"|"competed"|"won"`) and a `veto-use` `saved`/`nominees` payload;
  add positive-obligation branches to `actionBreaks`/`actionHonors`/`conditionFor`/`horizonOf`. The existing
  negative-kind logic is **untouched** (new branches fire only for the new kinds/actions) ⇒ byte-identical
  for every existing deal.
- **Engine (`src/engine/deals.ts` + `relationshipConstants.ts`):** reconcile handles the new actions; the
  honored fold gains the streak bonus; a kept deal emits a *reputation* seed; the reliability build is
  strengthened. `src/engine/gossip.ts` diffuses the reputation belief. NPC deal/nomination reads consult
  the reliability reputation.
- **Live wiring (`liveSeason.ts` / `GameSessionAdapter.ts`):** after a comp resolves, reconcile each
  competitor's `compete` action; after a veto is used, reconcile the `veto-use` action. `makeDeal` accepts
  the new kinds.
- **FE:** the deal-extraction belt learns the two new kinds so a player striking one in chat gets it tracked.
- **The gate:** every fold/gossip/NPC-read change and the making/reconciling of the new kinds is behind
  `ORWELL_DEAL_DEPTH` (default OFF). Off ⇒ no new kind is made, the honored/broken folds are exactly 0039/0109,
  no reputation is seeded ⇒ **byte-identical** (juryReach/gradient/UAT unmoved). Enabled in the deploy.

## 3. Scope

**In:** the two new kinds + their adjudication + live reconciliation; the three reliability rewards; the
flag; the FE extraction of the new kinds; tests.

**Out:** a general contract DSL (still only concrete BB promises); multi-party (3+) deals; changing the
existing four kinds' behavior; any player-facing number (the reward is always felt as behavior).

## 4. Contracts (stack-agnostic)

```
DealKind += "comp-throw" | "veto-save"                       // active-obligation promises
BindingAction.kind += "compete"; BindingAction.outcome?, .saved?, .nominees?
actionBreaks/actionHonors: positive-obligation branch — a FAILURE TO ACT breaks comp-throw/veto-save
DealLedger.reconcile(compete|veto-use action): kept/broken from the outcome — never prose
honored fold: + bounded loyalty-STREAK bonus (consecutive kept deals, same pair)
kept deal: seeds a hidden "reliable" reputation that diffuses (gossip) + raises NPC deal-willingness
ORWELL_DEAL_DEPTH (default OFF): gates ALL of the above ⇒ byte-identical when off
```

## 5. Definition of Done

- [x] **[Part 1] New kinds adjudicated (engine, not prose):** a `comp-throw` breaks when the promisor
      competes/wins and keeps when they throw; a `veto-save` breaks when the veto-holder leaves the promisee
      on the block, keeps when they pull them down, and carries **no duty** when the promisee wasn't
      nominated — decided from the structured action, identical under different prose. *(`dealDepth.test.ts`;
      BDD 0121.)*
- [x] **[Part 1] Break reuses the 0039 fallout:** a broken new-kind deal folds betrayal-shock + a jury
      demerit + a witnessed reveal, exactly like the existing kinds (via the shared `reconcile`/`applyBreak`).
- [x] **[Part 1] Byte-identical when off:** with `ORWELL_DEAL_DEPTH` unset the new kinds can't be made
      (`makeDeal` refuses them) and every existing fold is exactly 0039/0109; the domain change is additive
      (new branches fire only for the new kinds) — 0039/0109 unit suites unchanged, juryReach band unchanged.
- [x] **[Part 1] Name-agnostic tests** (roles only); BDD-gated in `cucumber.cjs`; `test:arch` green.
- [x] **[Part 2a] veto-save live wiring:** the veto ceremony emits a `veto-use` binding action (actor =
      veto-holder, `saved` = who was pulled down, `nominees` = who was originally on the block, replacement
      excluded), so a `veto-save` promise auto-resolves in a real game — gated on the flag (`bindingActionsFor`).
- [x] **[Part 2a] Loyalty streak (reward 3):** consecutive kept deals with the same partner compound the
      honored fold (bounded `DEAL_STREAK`); a break resets the streak; off ⇒ the plain honored fold
      (byte-identical). *(`dealDepth.test.ts`.)*
- [ ] **[Part 2b] comp-throw live wiring:** a resolved comp emits a `compete` action per competitor (needs
      the transient comp-intent threaded to the crown beat).
- [ ] **[Part 2b] Reputation that spreads (reward 1) + reliable-ally protection (reward 2):** a kept deal
      seeds a diffusing "keeps their word" reputation (gossip) that raises NPC deal-willingness; a proven
      partner protects the player — all hidden, no number.
- [ ] **[Part 2b] FE extraction** of the new kinds; deploy opt-in (`ORWELL_DEAL_DEPTH=1`) wired; `npm test` green.

## 6. Dependencies & traceability

Extends **0039** (the deal ledger + adjudication) and **0109** (deal duration), reuses **0026**
(betrayal-shock), **0014** (jury manner/reliability), **0006b** (comp intent — the `comp-throw` signal),
**0038/0002** (gossip — the reputation diffusion), gated like **0120/0087/0085** behind a dedicated flag so
the seeded spine stays byte-identical when off. PO expansion approved in the 0039 review (2026-07-12): more
deal kinds + a real reward for keeping your word.
