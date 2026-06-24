# 0081 — Narration-faithfulness gate (the overseer's second role: grounding & graceful recovery)

> **Status:** 📝 **SPEC** (drafted 2026-06-24). The **second overseer role** that
> [0079](./0079-runtime-overseer-and-diagnostic-log.feature) deliberately deferred ("the narration
> **faithfulness gate** … a *separate, future* role, deliberately not in this feature"). Where 0079/0080
> watch **pacing & gap-repair** (the model *under*-calls — a scene folds zero impact, the game freezes),
> this role watches **faithfulness** (the model *mis*-narrates — the prose contradicts the board, drifts
> persona, leaks machinery, or invents detail). It **folds into the existing overseer** as a second role:
> same `OverseerPort`, same 3-state mode (`off`/`shadow`/`active`), same `OVERSEER` log ring, same
> deterministic floor. Detection is **hybrid** (the deterministic 0065 guard flags claim-bearing turns;
> an **LLM faithfulness judge** runs only on those); correction is **clever and diegetic** — a caught
> slip is recovered so it reads as *intentional* storytelling, **split on [ADR 0005](../decisions/0005-split-authority-by-openness.md)**:
> an **open-set** slip is *adopted* as canonical (the claim becomes true), a **closed-set** slip is
> *reframed* in-fiction (the outcome is **never** bent). Scope is **full faithfulness everywhere** — the
> in-game narration loop **and** the casting / premiere / preview-decision junctions (this spec subsumes
> what was scoped as a separate 0082 junction-coverage feature).
> **Governed by** [ADR 0003](../decisions/0003-the-conversation-is-the-game.md) (steer the model, never
> author its content), [ADR 0005](../decisions/0005-split-authority-by-openness.md) (the open/closed
> split **is** the correction boundary), and mandates **#1** (behavioral fidelity — the GM never visibly
> errs), **#2** (the Vault Wall — the judge is Vault-free by construction), and **#3** (anti-sycophancy —
> a false closed-set claim is **never** made true to please).
> **Executable spec:** [`0081-narration-faithfulness-gate.feature`](./0081-narration-faithfulness-gate.feature)

## 1. Summary

The narration LLM has two distinct failure modes against engine truth, and 0079/0080 only addressed the
first:

- **Under-call (pacing/gap-repair, 0079/0080).** The model *skips* an engine call — won't `advanceGame`,
  won't `recordInteraction`. The board is right; the model just didn't move it. The overseer triggers the
  missed call.
- **Mis-narration (faithfulness, this feature).** The model *speaks past* the board — narrates a veto win
  that didn't happen, an HOH who isn't, a houseguest knowing a secret they were never told, a leaked
  `npc:<id>` token or operator aside, or an invented detail the engine never fixed. The board is right;
  the *prose* contradicts it.

Mis-narration is corrosive in a way an under-call is not: an under-call *stalls* (visible, recoverable),
but a mis-narration **lies to the player in the GM's own voice** — and once it has streamed, a blunt
"correction: actually you lost" **breaks immersion by admitting the GM erred**. Mandate #1 says the GM
should never *visibly* err. So this role does something subtler than catch-and-retract: when it catches a
slip, it **recovers it so the slip reads as intentional** — dramatic irony, a rumor just debunked, an
NPC's bluff, premature celebration, or (for invented *flavor* the engine never owned) simply **making the
claim true**. The player experiences seamless storytelling; the divergence is logged for the operator, not
shown to the player.

The load-bearing constraint — and the reason this is a *careful* feature — is **mandate #3**: making a
slip "feel intentional" must **never** mean bending an **outcome** to match a false claim. That is the
exact sycophancy the whole engine exists to prevent. The resolution is **ADR 0005**: the correction
boundary is the **open/closed split**. An *open-set* slip (texture/detail the engine never decided) can be
**adopted** — recorded as canonical, so the "error" becomes retroactively true; nothing in the closed set
moved, so it is not sycophancy, it is ADR 0005's "record the open set faithfully." A *closed-set* slip
(an outcome, the board, eligibility, a Vault fact) is **reframed in presentation only** — the engine truth
stands and the narration is steered to absorb the slip as in-fiction misbelief. **A closed-set field is
never adopted.** That single guard is the anti-sycophancy wall for this feature.

## 2. What exists today (the gap this closes)

| Capability | Where | Limit this feature addresses |
|---|---|---|
| Pre-emission outcome guard (closed-set board claims) | `chat_helpers.py` (0065) | **deterministic / regex** — catches the phrasings it patterns-match *before* stream; blind to **semantic** contradiction, persona drift, leaks, omission, invented detail |
| Reasoning scrub (operator-aside / raw `npc:<id>`) | `markdown.js` `processWithThinking` (game build) | **lexical** scrub of known leak tokens; not a semantic "does this prose assert something the player can't know" check |
| Reasoning/body channel split | `chat.js` (reasoning never reaches the public bubble) | keeps *reasoning tokens* out by construction — does not check the *body's* faithfulness to the board |
| `expressiveNonCollapse` gates | TS + FE | protect open-set **richness** from being flattened — the dual concern; nothing checks open-set **invention** for adoptability vs. contradiction |
| Pacing/gap-repair overseer (0079/0080) | `agent_loop.py` + `OverseerPort` | the **under-call** half: triggers a *missed* call; has **no** faithfulness role (0079 §3 deferred it explicitly) |
| A judge that reads narration vs. engine truth and recovers a slip diegetically | — | ⛔ **does not exist** |

Net today: closed-set board claims are guarded *lexically and pre-stream*; **semantic** contradiction,
persona drift, semantic leaks, omission, and invented detail all pass — and when something *does* slip,
there is no graceful, immersion-preserving recovery, only the blunt pre-emission rewrite (which can't fire
post-stream anyway).

## 3. Scope

**In:** the **faithfulness role on the existing `OverseerPort`** (an `assessFaithfulness` path beside the
0079 `assess`); the **deterministic claim-detector** that gates the judge (extends the 0065 pre-emission
guard — "is this turn claim-bearing?"); the **LLM faithfulness judge** (Vault-free inputs, runs **only on
claim-bearing turns**) across **four dimensions** — board contradiction, persona / in-bounds, machinery /
Vault leak, omission; the **ADR-0005-split correction** — `adopt` (open-set → canonical), `reframe`
(closed-set → diegetic re-presentation), backend re-ground (`reinject-delta`) for un-reframable slips;
**the same gate at the casting / premiere / preview-decision junctions** (the former 0082 scope, folded
in); reuse of the **3-state mode**, the **`OVERSEER` log ring** (every attempt logged with context), and
the **deterministic floor**.

**Out (hard line):** any **closed-set authority** — `adopt` is **open-set only**; an outcome, the board,
eligibility, or a Vault fact is **never** rewritten to match narration (mandate #3, the central guard).
**Authoring content** — `reframe` *steers the model's framing* (irony/rumor/misbelief), the **model still
writes the prose** (ADR 0003); the overseer never composes narration. **Reading the Vault** — the judge's
entire input diet is the Vault-free known-projection; a "leak" is detected as *an assertion the player has
no pathway to*, **never** by comparing against Vault contents (mandate #2). **Pre-stream blocking** — the
judge runs **post-emission** and corrects **next turn** (the deterministic 0065 guard remains the only
pre-stream line; an inline LLM judge would tax every claim-bearing turn's latency, §9). **Replacing** the
0065 guard or the `expressiveNonCollapse` gates — this rides *on top* of both.

## 4. Design

### 4.1 Hybrid detection — deterministic trigger, semantic judge

Two layers, matching the answered design (deterministic + LLM, judge **only on claim-bearing turns**):

- **Deterministic trigger (the *when*, cheap, every turn).** The 0065 pre-emission outcome guard already
  scans narration for closed-set board claims pre-stream. Extend it with a side output:
  `isClaimBearing(narration, board) → boolean` — *does this beat assert anything checkable* (a board/power
  claim, a houseguest-knowledge claim, a named-detail claim)? A pure-mood/transition beat asserts nothing
  → the judge **never wakes** (no model call, no log line). This is the cadence: **claim-bearing turns
  only**, mirroring 0079's sparse symptom-gate (breadth ≠ frequency).
- **Semantic judge (the *what*, on a claim-bearing turn).** The **LLM faithfulness judge** reads the
  narration against the **Vault-free known-projection** and returns a verdict across four dimensions. It
  is the value a *reasoning* layer adds: the deterministic guard catches the phrasings it patterns-match;
  the judge catches the **meaning** — a paraphrased board contradiction, an NPC speaking knowledge it has
  no pathway to, an asserted hidden fact, a dropped beat, an invented detail.

The deterministic guard stays the **only pre-stream** corrector (closed-set, regex-able, can block before
the player sees it). The judge is **post-emission** — it informs the **next** turn's recovery. So a
closed-set claim the regex catches is fixed *before* stream (0065, unchanged); everything semantic that
slips past is caught *after* stream and recovered next turn (this feature).

### 4.2 The judge is Vault-free by construction (how a "leak" is caught without reading the Vault)

The judge's inputs are exactly the diet the FE always holds (mandate #2 — "cannot leak what it never
receives"):

```
FaithfulnessClaim (Vault-free BY CONSTRUCTION):
    { narration, knownProjection, personaFacts, board, junction }
      knownProjection — what the player legitimately knows: the visible/Journal projection + every fact
                        surfaced to them via an in-game pathway (an NPC told them, they overheard…). The
                        player's own known-set is Vault-free (it IS their knowledge).
      personaFacts    — the stable public CHARACTER facets (0058 public projection), never the hidden soul.
      board           — the Vault-free closed-set projection (HOH, noms, veto, phase, beatSeq).
```

A **leak** is therefore detected **structurally**, not by Vault comparison: a claim grounded in
`knownProjection` is faithful; a claim **outside** it is either an *open-set invention* (adoptable, §4.4)
or an *ungrounded assertion of a hidden/closed fact* — flagged **without the judge ever holding the Vault
value**. (An NPC legitimately telling the player a secret *is* grounded — the pathway is the surfacing
event already in `knownProjection`.) This is the event/visibility model doing the work: faithfulness is
"is this prose grounded in what the player can legitimately know," and that set is Vault-free.

### 4.3 The four faithfulness dimensions (full scope)

| Dimension | The slip | Example (roles only) |
|---|---|---|
| **Board contradiction** | prose disagrees with the closed-set truth | narrates the nominee as "safe," names the wrong HOH, claims a veto win that didn't resolve |
| **Persona / in-bounds** | an NPC asserts knowledge/behavior it has no pathway to, or breaks its stable public persona | an NPC "knows" a vote it never witnessed; a houseguest acts wildly off their established public self |
| **Machinery / Vault leak** | prose asserts a hidden fact, or leaks a machinery token / operator aside | states a confessional the player never heard; a raw `npc:<id>` or system aside survives into the body |
| **Omission** | prose **drops** a beat the engine emitted (the dual of contradiction) | a ceremony/eviction the board recorded goes unnarrated, desyncing what the player believes |

The deterministic 0065 guard covers the **regex-able board** subset pre-stream; the judge covers the
**semantic** remainder of all four post-stream.

### 4.4 Correction — clever, diegetic, split on ADR 0005 (the centerpiece)

When the judge flags a slip (already streamed), `active` mode recovers it so it reads as **intentional**.
**The boundary is the open/closed split** (the answered design):

| Class | Lever | What happens | Boundary held |
|---|---|---|---|
| **open-set** (flavor/detail the engine never fixed) | **`adopt`** | the model's invented detail is **recorded as canonical** via `recordInteraction` — the claim **becomes true**; nothing downstream contradicts it because it is now the record | **open-set only**; no closed-set field is touched, so **no outcome bent** — this is ADR 0005's "record the open set faithfully," not sycophancy |
| **closed-set, reframable** | **`reframe`** | the **next** turn is steered to absorb the slip diegetically — the false claim becomes an in-fiction **misbelief** (dramatic irony, a rumor just debunked, an NPC's bluff, premature celebration); the player reads intentional storytelling | **presentation only**; the engine truth is **never** changed — the model is steered on *how to frame*, it still **authors** the prose (ADR 0003) |
| **closed-set, un-reframable** (no plausible in-fiction reframe) | **`reinject-delta`** (backend re-ground) **+ log; no visible retraction** | the corrected closed-set `stateDelta` is re-injected so the false claim **dies at the source** and never propagates; the violation is logged with full context; the engine truth simply **stands** going forward | fixes the model's **input**, never the output; **no clumsy player-facing retraction** is emitted — the model is corrected, not the player *(my reading of "set in backend as stated above"; §10 O1)* |
| **leak / persona** | **`reframe`** (or **`escalate`** if structural) | a hidden-fact leak is reframed as suspicion/rumor (presentation only); a structural token leak (`npc:<id>`/aside) is surfaced to God-Mode health and the scrub tightened | never confirms the hidden fact; a structural leak **surfaces**, never silently rides |
| **faithful** | **`hold`** | nothing — logged as an `observation` | — |

**Why this is mandate-safe, restated as one rule:** *a closed-set field is never adopted.* `adopt` carries
a guard — if the flagged claim touches **any** closed-set field (outcome / board / eligibility / Vault), it
**cannot** route to `adopt`; it falls through to `reframe` (reframable) or backend re-ground (not). So the
only thing ever "made true" is open-set texture the engine never owned. The anti-sycophancy wall is this
one fall-through, and §8 makes it the load-bearing test gate.

**`reframe` steers, it does not author (ADR 0003).** Like the 0079 stall-nudge chooses *whether* to nudge
but not the wording, `reframe` chooses the recovery **strategy** (which in-fiction frame: irony / rumor /
bluff / premature-celebration) and hands it to the model as a directive; **the model writes the scene.**
The overseer never composes narration.

### 4.5 The junctions (the folded-in 0082 scope)

The same gate wraps narration **everywhere it makes claims**, not just the weekly loop — these seams have
their own faithfulness risks and the same hybrid-detect / ADR-0005-split-correct machinery applies:

| Junction | Claim source / risk | Notes |
|---|---|---|
| **Casting interview (0050)** | narration asserts a houseguest trait/backstory that contradicts the generated profile, or implies the headshot/profile isn't on file | persona dimension against `personaFacts`; ties to the casting framing guardrails (`apply_game_framing`) |
| **Premiere / meet-everyone (#380)** | narration claims the player has met an NPC they haven't, or misstates who's present | board/persona dimension against the `markHouseguestMet` belt's known-set |
| **Preview-decision beats** | the framing of a pending decision misstates the board (the nominees, the veto state, eligibility) | board dimension against the closed-set projection before the player commits |

These reuse the judge, the levers, and the log unchanged; only the **claim source** differs per junction.
A junction beat that asserts nothing checkable is not claim-bearing → the judge doesn't wake there either.

### 4.6 Folding into the overseer — modes, port, log (reuse, not rebuild)

- **3-state mode, shared.** The faithfulness role rides the **same** `off`/`shadow`/`active` mode 0080
  introduced. `off` — judge never runs. `shadow` — judge runs on claim-bearing turns and **logs**
  violations (no correction). `active` — judge runs, **corrects** (adopt/reframe/re-ground), and logs
  every attempt. *(An optional per-role override — pacing `active` while faithfulness `shadow` — is a
  small future knob, §10 O2; the default is one mode governs both roles.)*
- **Port, extended.** `OverseerPort` gains `assessFaithfulness(claim) → FaithfulnessVerdict` beside the
  0079 `assess`. `DeterministicOverseer` returns **`faithful` / `hold` always** (no model ⇒ no judging ⇒
  the floor stands; seeded lanes byte-identical). The 0079 `verdict_from_reply` contract guard extends to
  reject an out-of-contract faithfulness lever to the floor (load-bearing — the lever set stays fixed).
- **Log, reused.** Every attempt writes to the **`OVERSEER` ring** (0079 §4.4) with the faithfulness
  context — Vault-free and sentinel-clean by the same field coercion. New `kind`s distinguish the role;
  `level` reuses `observation` (held/faithful) / `action` (corrected) / `anomaly` (repeated slip) /
  `escalation` (structural leak). The entry carries `{ dimension, class, claim, truth, lever, ok }` so the
  operator sees *what was claimed, what was true, how it was recovered, and whether it applied.*

### 4.7 Determinism & fail-soft (identical to 0079/0080)

`active` faithfulness is a **LIVE-only** behavior. In seeded/deterministic mode (every automated gate, no
real model) `DeterministicOverseer` returns `faithful`/`hold` and **never calls a judge**, so the seeded
UAT/BDD/calibration lanes are **byte-identical** and need **no** re-baseline. With the judge unavailable /
erroring / timing out / `off`, the existing 0065 deterministic guard + the reasoning scrub + the
`expressiveNonCollapse` gates behave **exactly as today** — the deterministic floor simply stands. The
judge path is exercised only with a real model wired (the `CLAUDE.md` live-LLM manual path) and by unit
tests that inject a fake verdict at the dispatch seam.

## 5. Contracts (stack-agnostic)

```
OverseerPort (extended):
    assess(signals): Verdict                              // 0079 — pacing / gap-repair (unchanged)
    assessFaithfulness(claim): FaithfulnessVerdict        // 0081 — claim + verdict Vault-free BY CONSTRUCTION

    FaithfulnessClaim:   { narration, knownProjection, personaFacts, board, junction? }
    FaithfulnessVerdict: { faithful, dimension, class, lever, correction? }
      dimension ∈ { board, persona, leak, omission }
      class     ∈ { open-set, closed-set-reframable, closed-set-unreframable, faithful }
      lever     ∈ { hold, adopt, reframe, reinject-delta, escalate }
      // INVARIANT: lever == adopt  ⇒  class == open-set   (the anti-sycophancy guard, §4.4)

Deterministic trigger (cheap, every turn — the cadence gate):
    isClaimBearing(narration, board): boolean             // extends the 0065 pre-emission guard

DeterministicOverseer (stub adapter):                     // seeded lanes; returns faithful/hold, no model call

Correction dispatch (active; each routes an EXISTING action path):
    adopt          → recordInteraction (canonicalize the open-set claim; 0055/0023)
    reframe        → next-turn diegetic steering injection (the stall-nudge injection path; model authors prose)
    reinject-delta → re-inject the 0065 stateDelta (backend re-ground; no visible retraction)
    escalate       → God-Mode health fault + back off (0016)
    hold           → nothing (logged observation)

Diagnostic log (G1b, FE — 0079 ring reused):
    record_overseer(level, kind, …, dimension, class, claim, truth, lever, ok)   // Vault-free; sentinel-clean
```

## 6. Definition of Done

- [ ] **Claim-bearing cadence:** a pure-mood/transition beat (asserts nothing checkable) does **not** wake
      the judge — no model call, no log line; a claim-bearing beat does. (Breadth ≠ frequency.)
- [ ] **Hybrid detection:** the deterministic 0065 guard still corrects regex-able closed-set board claims
      **pre-stream**; the LLM judge catches the **semantic** remainder across all four dimensions
      **post-stream**, on seeded fixtures (roles only).
- [ ] **Open-set adopt:** an invented open-set detail is recorded canonical via `recordInteraction` — the
      claim becomes true and nothing downstream contradicts it.
- [ ] **Closed-set reframe:** a closed-set contradiction is recovered next turn as in-fiction misbelief;
      the engine outcome/board is **unchanged** (asserted against the board before and after).
- [ ] **Anti-sycophancy guard (load-bearing):** a unit test proves a flagged **closed-set** claim can
      **never** route to `adopt` — it falls through to `reframe` / backend re-ground; **no closed-set field
      is ever rewritten to match narration** (`lever == adopt ⇒ class == open-set`).
- [ ] **Un-reframable → backend re-ground:** a closed-set slip with no plausible reframe re-injects the
      corrected delta + logs with full context and emits **no visible player-facing retraction**.
- [ ] **Vault-free judge:** the judge holds **no `VaultStore`** handle; a "leak" is caught as an
      assertion outside `knownProjection`, not by Vault comparison; `npm run test:arch` stays green; the
      log is sentinel-clean on the player **and** admin canaries (0001).
- [ ] **Junction coverage:** the gate fires at the casting / premiere / preview-decision junctions with
      the same detect-and-correct behavior (the folded-in 0082 scope).
- [ ] **Folds into the overseer:** rides the shared 3-state mode (`shadow` = log-only, `active` =
      correct+log); every attempt lands in the `OVERSEER` ring with `{dimension, class, claim, truth,
      lever, ok}`; `reframe` **steers**, never authors (the model writes the prose — ADR 0003).
- [ ] **Fail-soft / determinism:** judge unavailable/`off` ⇒ the 0065 guard + reasoning scrub +
      `expressiveNonCollapse` behave exactly as today; seeded UAT/BDD/calibration lanes **byte-identical**
      via `DeterministicOverseer`; **no** re-baseline.
- [ ] Name-agnostic tests (roles only); `npm test` + the FE pytest gate green; live-LLM manual run
      recorded (the active path is live-only — the gates can't see it).

## 7. Anti-sycophancy & the mandate boundary (explicit — read before approving)

This role puts an **LLM judging the LLM**, and (in `active`) lets a caught slip change what is canonical.
It stays inside the mandate **iff every one of these holds** (each a §6/§8 gate):

1. **Adopt is open-set only.** `lever == adopt ⇒ class == open-set`. A closed-set field (outcome / board /
   eligibility / Vault) is **never** made true to match narration. This single guard **is** the
   anti-sycophancy wall — it is the whole reason "make it feel intentional" does not become "bend the
   result to please." (Mandate #3.)
2. **Reframe steers, never authors.** The overseer hands the model a recovery *strategy*; the **model**
   writes the prose. No narration is engine-composed. (ADR 0003.)
3. **The judge is Vault-free.** Inputs are the Vault-free `knownProjection` / `personaFacts` / `board`; a
   leak is caught structurally (ungrounded assertion), never by reading the Vault. (Mandate #2.)
4. **The floor always stands.** Judge unavailable / error / timeout / `off` ⇒ the 0065 guard + scrub +
   `expressiveNonCollapse` resume with **zero** change; reversible by flipping the mode. Seeded lanes
   byte-identical.
5. **Detection, not authorship of truth.** The judge decides *whether prose is faithful and how to
   recover the presentation* — it never decides an **outcome**. `runCompetition` stays the single
   authority.

**The honest new risk (§9):** an open-set/closed-set **misclassification** is the dangerous failure — if
the judge mislabels a *closed-set* slip as open-set, guard #1 still refuses the adopt (the classifier
can't override the closed-set field check), so the worst case degrades to a *reframe of something that
should have re-grounded* — recoverable, never an outcome-bend. The classifier err-toward-closed default
(ambiguous ⇒ treat as closed-set ⇒ reframe, never adopt) makes the safe direction the cheap one.

## 8. Test gates (the proofs)

- **`faithfulnessGuard` (unit, load-bearing):** for every closed-set field, a flagged claim on it
  **cannot** produce `lever == adopt`; it routes to `reframe` / `reinject-delta`. The engine board is
  **byte-identical** before and after a closed-set reframe. *(This is the anti-sycophancy gate.)*
- **`faithfulnessAdopt` (unit):** an open-set invented detail routes to `adopt` → a `recordInteraction`
  fires with the model-proposed content; the detail is canonical thereafter.
- **`faithfulnessCadence` (unit):** `isClaimBearing` false ⇒ no judge call, no log line; true ⇒ exactly
  one judge call.
- **`faithfulnessVaultFree` (arch + unit):** the judge adapter imports no `VaultStore`/`VectorIndex`
  (dependency-cruiser); the `OVERSEER` log is sentinel-clean on player + admin canaries; a leak fixture is
  caught with **only** `knownProjection` in scope (no Vault handle present).
- **`faithfulnessFloor` (seeded lanes):** `DeterministicOverseer` ⇒ UAT/BDD/calibration byte-identical;
  `juryReach` + the gradient band unchanged; **no** re-baseline.
- **BDD (`0081-…feature`):** shadow-logs-without-correcting; active adopt / reframe / backend re-ground;
  closed-set-never-adopted; junction coverage; every-attempt-logged-with-context.

## 9. Cost & risk (explicit)

- **One judge call per claim-bearing turn (live only).** Sparse (mood/transition beats skip it) and
  **post-emission** (off the player's critical path — it informs the *next* turn, never blocks the current
  stream), so unlike 0080's inline pacing call the player **never waits on the judge**. Bounded by a
  timeout → fall back to the deterministic floor.
- **Classifier risk (§7).** Open/closed misclassification is the real hazard; mitigated by guard #1
  (adopt can't touch a closed-set field regardless of the label) + the err-toward-closed default.
- **Reframe quality is the model's.** A clumsy reframe is *worse* than a clean re-ground; the
  un-reframable→backend-re-ground path (O1) is the escape hatch when no good frame exists, and `shadow`
  mode lets the operator watch the judge's proposed recoveries before trusting `active`.
- **Testing gap.** The `active` judge path is **live-only**; the automated suite covers the dispatch seam
  with injected verdicts, the rest is the live-LLM manual path (same as 0080).
- **Bounded blast radius.** Opt-in + reversible + deterministic floor + adopt-is-open-set-only +
  Vault-free ⇒ a bad judge call is recoverable (the floor resumes) and can **never** leak or bend an
  outcome.

## 10. Open decisions (owner rulings needed)

| # | Decision | Recommendation |
|---|---|---|
| **O1** | Un-reframable closed-set slip behavior — my reading of *"set in backend as stated above"* is **backend re-ground (`reinject-delta`) + log, no visible player-facing retraction**. Confirm? (Alt: a minimal visible re-ground; or silent log-only.) | **backend re-ground + log, no visible retraction** — corrects the model, not the player; truth stands |
| **O2** | Mode shape — one shared 3-state mode governs **both** overseer roles, or a per-role override (pacing `active` while faithfulness `shadow`)? | **shared mode** for the MVP; per-role override as a later knob if operators want to trust pacing before faithfulness |
| **O3** | Adopt durability — does an `adopt` need a distinct `OVERSEER`/ledger marker (vs. a normal model-driven `recordInteraction`) so canonicalized-from-a-slip detail is auditable? | **yes, a marker** — cheap, and it keeps "what became canon via recovery" inspectable |
| **O4** | Junction depth — ship all three junctions (casting / premiere / preview) in the first cut, or land the in-game loop first and layer junctions? | **all three** (you chose "one combined spec") — but implement loop-first, junctions as the second increment within this feature |

## 11. Dependencies & traceability

Folds into **0079** (the `OverseerPort` / `DeterministicOverseer` / `verdict_from_reply` / the `OVERSEER`
ring — all reused) and **0080** (the 3-state mode + the active dispatch seam — extended with the
faithfulness levers). Rides on **0065** (the pre-emission guard → the claim-detector trigger; `stateDelta`
→ the `reinject-delta` lever; the divergence ledger), **0055/0023** (`recordInteraction` → the `adopt`
lever; the engine still owns magnitude — ADR 0005), **0058** (the public-persona projection → the persona
dimension), **0050** + the premiere/`markHouseguestMet` + preview-decision seams (the §4.5 junctions, the
folded-in 0082 scope), the **reasoning scrub** (`markdown.js`) + the **`expressiveNonCollapse`** gates (the
floor this rides on top of), and **0016** (God-Mode health — the `escalate` target), under **0001** (the
Vault sentinel — the judge + log are Vault-free) and **0027** (the port+stub pattern). **Governed by ADR
0003** (steer the model's framing, never author its content), **ADR 0005** (the open/closed split **is**
the correction boundary — adopt the open set, never bend the closed set), and mandates **#1** (the GM
never visibly errs — graceful recovery), **#2** (Vault-free judge), **#3** (anti-sycophancy — adopt is
open-set only). Answers *"a gate that makes the narration faithful to the engine — and recovers a slip so
the player never sees the GM err, without ever bending the result to please."*
