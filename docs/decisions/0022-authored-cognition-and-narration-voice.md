# 0022 — Authored cognition and narration voice ("fan out cognition, funnel narration")

> **Status:** Principle **Accepted** (owner directive, 2026-07-21). The **unified design record**
> for the Sonder-hybridization cluster — GitHub issues **#1736** (per-NPC authored cognition,
> salience-gated), **#1738** (narration voice architecture), and **#1739** (full live per-NPC
> cognition). It folds the three into one decision spine so the "why" of *authored cognition* and
> *one narration voice* survives in a single place.
> **Source:** the Sonder-Engine design discussion + the BB-Nerd Sonder scoreboard
> ("Orwell's engine already models what Sonder's per-character-agent architecture promises; the
> narration seam just fails to deliver it").
> **Refines / builds on:** ADR **0003** (the conversation is the game — one fluent voice), ADR
> **0005** (split authority by openness — the model proposes shape, the engine keeps seeded
> magnitude), and ADR **0019** (context is not knowledge — per-NPC knowledge scoping at the
> narration seam). **Bounded by** mandate #2 (the Vault Wall) and mandate #3 (anti-sycophancy).
> **Companion records (the depth this ADR delegates to):** ADR **0021** is the standalone,
> already-accepted voice-architecture record for #1738 (this ADR carries the same decision as its
> voice arm and does **not** supersede it); feature **0131** is the salience-gated cognition spec
> for #1736 (sub-designs S1/S2/S3); feature **0132** is the full-fidelity spec for #1739. This ADR
> is the umbrella; those three hold the implementer detail.

## Context

Sonder decomposes **prose** — Perception → per-character writing agents → narrator — so many
models touch the text. Orwell's engine, by contrast, already **models** what that architecture only
performs: per-NPC intent (`SoulState.currentGoals` / `motivations`), organic asymmetric
relationships (ADR 0002), and NPC→NPC gossip drift. The BB-Nerd audit scoreboard makes the point
sharply: **the modeling is there; the narration seam just doesn't deliver it.** The live narrator
gets the deterministic floor — facts, public personas, relationship state — and an NPC's *why*
rarely lands in prose, so the house can read as reactive to the player rather than as a social
system of NPCs each pursuing their own unfolding wants.

Two questions fall out of the Sonder comparison, and they must be answered together:

1. **How much of an NPC's cognition may the model author, and where does engine authority stop?**
   Enriching per-NPC intent re-opens the "how much does the model decide" question that ADR 0005
   deliberately bounded. Get this wrong and you re-open the sycophancy door (mandate #3).
2. **Do we split the narrator too?** Sonder pays for N per-character writing agents. If Orwell
   copies that, it multiplies the one thing mandate #2 depends on — the number of seams where facts
   leave the engine.

This ADR records one answer to both, because they are the same principle applied to two layers.

## Decision

**Fan out the cognition; funnel the narration.** Decompose *cognition* into many cheap, scoped,
**data-only** calls (per-NPC intent, subjective memory, paraphrase-residual); keep *narration*
**monolithic** — one completion writes every NPC's words. This is the Orwell inversion of Sonder:
adopt the cognitive decomposition (which enriches play) and reject the prose decomposition (which
would cost fluency and Vault security). It is also strictly *more* Vault-secure than Sonder — one
enforcement seam, not N.

### A. One funnel voice, not N narrators (the #1738 arm)

**Choose one fluent narrator over N per-character writing agents**, for three reasons:

1. **ADR 0003 — fluent prose, not committee seams.** One voice fluent in the whole cast and its
   relationships writes better, more readable prose than N per-NPC narrators stitched together.
   Committee prose (multiple models, lines produced in isolation that must fit together) reads with
   visible seams, register shifts, and false consistency breaks. ADR 0003 governs: don't trade
   fluent prose for a control panel of per-NPC agents.
2. **Security — one Vault-enforcement seam.** The Vault Wall (mandate #2) is enforced at *one* seam:
   the point where facts leave the engine. One narrator = one place to lock down knowledge-scoped
   voice (ADR 0019). N narrators = N leak surfaces, each needing the ADR 0019 scoping enforced
   independently — N× harder to audit, and exactly the failure class ADR 0019 names (one shared
   context, one model, many NPCs reaching into it; the casting-interview and "recalled something
   they weren't privy to" leaks). One seam is defensible; N are not.
3. **Cost and latency.** One completion is cheaper and lower-latency than N parallel prose calls,
   each with its own LLM overhead. Real-time play can't afford N narrators per beat.

**Rejected alternative — per-character writing agents.** Each NPC completes its own prose, stitched
by the FE. Rejected for all three reasons above: prose seams (ADR 0003), leak-surface
multiplication (N× the ADR 0019 enforcement burden), and latency/cost. Sonder pays these costs; we
chose not to. *(ADR 0021 is the standalone record of this decision and its full reasoning; this arm
restates it so the umbrella is self-contained.)*

### B. What the model may author (the closed/open authority split — the #1736 arm)

Authored cognition lives entirely in the **open set** (ADR 0005). The model proposes the *shape* of
an NPC's cognition; the engine keeps the *magnitude* and owns every outcome. Concretely, per beat:

| Row | Owner | Notes |
|---|---|---|
| **want** (what the NPC is trying to get this beat) | **model may author** (open set) | Structured intent, not prose. |
| **attempt** (the move they make toward it) | **model may author** (open set) | Structured intent, not prose. |
| **read** (their subjective belief/memory of a scene) | **model may author** (open set) | Persisted as soul state (0131-S2), never chat-remembered. |
| **resolve** (who wins, what happens) | **engine only** (closed set) | Seeded `resolveCompetition` / the deterministic resolver. Never the model. |
| **state** (relationship magnitudes, board, persistence, the Vault) | **engine only** (closed set) | The model never sees or sets a number. |

The magnitude/shape split of ADR 0005 is **preserved exactly** and reuses the existing seam: the
`recordInteraction` `consequence` descriptor (PR #355) — the model proposes `{kind, target,
emphasis}` (which edge moves, which direction, relative emphasis), the engine keeps the bounded,
seeded magnitude; **no descriptor ⇒ byte-identical fold** to the deterministic floor. "Model
proposes, engine disposes." Authored intent is a **bounded weighted input** to engine resolution,
never the resolution.

The three sub-designs that deliver this are specced in **feature 0131**:
- **S1 — per-NPC authored intent (salience-gated).** A scoped sub-call authors `want/attempt` for
  the 1–2 NPCs whose situation measurably moved this turn; the engine's resolver still owns the
  outcome. Cost controls: **salience-gated** (only the moved NPCs), **present-set-bounded**,
  **lull-timed + cached** as soul state, **cheap-tier** (utility/Qwen-flash class), **fail-soft**
  over the deterministic floor.
- **S2 — subjective divergent memory.** Per-NPC *distorted* memory of a witnessed scene, persisted
  as soul state (store recalled, not chat remembered) — beyond today's NPC→NPC gossip drift. Cached
  per scene; fail-soft.
- **S3 — paraphrase-residual scoped call.** ADR 0019's *accepted residual* (vague paraphrase, e.g.
  "counselor vibe") killed for the one high-risk case: voice a **present** NPC's secret-adjacent
  line from a per-NPC scoped completion **only** when their knowledge sharply diverges from the
  shared transcript. Knowledge-divergence-gated; bounded to that NPC, that beat.

### C. Full-fidelity mode — every awake NPC, every turn (the #1739 arm)

The owner opted **in** to the maximal version of S1: instead of salience-gating to 1–2 NPCs,
**re-simulate every active houseguest's cognition live each turn** — each NPC's `want/read/attempt`
refreshed from a per-NPC scoped call before the beat is narrated. This is an **extension of the
gated mode, not a new authority model**: it keeps all of arm B's authority split and degrades back
to S1 under pressure. The cost engineering that makes "every NPC every turn" viable — the spec's
real work — is specced in **feature 0132**; its five cost controls are:

1. **Concurrency + cheap tier.** All N per-NPC cognition calls run the utility model
   (Qwen-flash class), fired **in parallel**, fail-soft over the deterministic floor (a
   timeout/garbage ⇒ that NPC runs the floor this turn; the turn never blocks).
2. **Present/awake-set bound.** "Every NPC" in practice = the **awake set** (feature 0066 — the
   sleep economy shrinks the active cast late-night). NPCs off-screen asleep tick deterministically.
3. **Delta-driven prompts.** Each call is fed only a `beatSeq` `stateDelta` ("what changed for you
   since your last sim," feature 0065), not the full context — per-call tokens stay tiny.
4. **Budget guard + graceful degradation.** A per-turn token/latency ceiling; when pressure exceeds
   it, **degrade gracefully to salience-gated mode (0131-S1)** this turn and re-expand when budget
   permits. The mode is a **flag** so full-vs-gated can be A/B'd.
5. **Failure-surface containment.** N structured-JSON calls = N malformed-output chances; each is
   validated + fail-soft (never a load-bearing call). Telemetry follows the **belt-fire
   success-gated contract** — a belt fire counts only an **applied** correction (a call that
   produced a real, folded intent), never a mere attempt or a no-op.

A **cost model** (expected tokens/latency per turn at cast size N on the utility tier) and the
budget ceiling that flips to gated mode are documented in 0132 §4; a **flagged, measurable A/B
feel-vs-cost evaluation plan** (does live-every-NPC produce materially richer/more-independent play
than salience-gated, enough to justify the cost?) is in 0132 §3.

### D. Recovering voice distinctiveness without N narrators (the #1738 upside)

One voice trades away the potential for N sharper-but-seamed voices. Recover distinctiveness
**inside the single completion**, with **content-neutral** mechanisms (they shape *how* a line
reads, never *what* the NPC knows/wants/achieves):

1. **Per-NPC voice fingerprints in the terminal constraints block.** Bake each character's cadence,
   register, verbal tics, and do/don't-say rules into the structured constraints that ride the
   prompt (ties to the A4/#1735 terminal HARD-CONSTRAINTS block).
2. **Cast `voiceSignature` cues.** The cast `CHARACTER` already carries authored voice descriptors
   (#1733, **coherence-gated** so no garbled fingerprints reach the prompt); fold them into the
   constraints / scene preamble as an explicit per-NPC signal.
3. **Optional style-only per-NPC micro-pass (speculative — likely rejected).** A surface-rewrite of
   an already-completed, already-validated line to use one NPC's tics, never touching
   knowledge/outcome/meaning. **Evaluated and likely rejected at design time:** rewriting prose
   *after* the narrator completes it risks reintroducing the very seams and coherence loss that arm
   A rejects. The boundary is worth spec'ing precisely so a future implementer doesn't cross it by
   accident.

Distinctiveness is **measurable without reintroducing seams** — see the attribution test in
Testability.

### The unifying principle

Arms A–D are one rule at two layers. **Cognition fans out** (many cheap, scoped, data-only calls,
each authoring open-set shape) so the house feels alive and independent. **Narration funnels**
(one fluent voice, one Vault seam) so the prose stays coherent and the wall stays enforceable.
**Neither arm ever moves closed-set authority to the model** — outcomes, state, knowledge, and
persistence remain engine-owned and seeded, at gated *and* full fidelity.

## Integrity invariants (expressed as testable gates)

Every mechanism in this ADR MUST hold these. They are the acceptance surface for the feature issues
that split off, and they reuse the existing proofs — no new authority model, no new wall.

1. **Cognition-only (never outcome).** A cognition call may author `want/attempt/read` only; the
   deterministic resolver owns `resolve/state`. *Proof:* `expressiveNonCollapse.test.ts` +
   `frontend/tests/test_expressive_non_collapse.py` stay green — with **no descriptor the fold is
   byte-identical** to the floor, so authored shape can never change a seeded magnitude.
2. **Bounded-input-to-resolution.** Authored intent enters resolution only as a structured
   `{kind, target, emphasis}` descriptor (the #355 pattern) with a bounded, seeded magnitude; no
   raw number and no free text crosses into the closed set. *Proof:* the descriptor-shape test on
   the resolver path; a planted intent cannot move an outcome beyond the seeded bound.
3. **Knowledge-scoped (on ENGINE presence).** Every per-NPC call is scoped to what the engine says
   that NPC knows, gated on **engine** presence (#1726 / A2), never on what the narrator happens to
   hold in context (ADR 0019). *Proof:* the ADR 0019 per-NPC sentinel — plant a token into a scene
   witnessed only by NPC B, assert it is absent from A's scoped call input; plant a producer-only
   token, assert it is globally absent. N parallel calls do not re-open the leak N times.
4. **Soul-anchored.** Each call *continues* the persisted character (stable public persona, "people
   make sense," 0041); it never re-rolls the character. Outcomes fold back via `evolveFromBeat`.
   *Proof:* `CHARACTER` byte-stable across a cognition beat; the authored read persists to soul, not
   chat.
5. **Funnel-narration (single seam).** Cognition calls emit **data/intent only, never prose**; one
   completion writes every NPC's words. *Proof:* the Vault-Wall structural sentinels
   (dependency-cruiser: no outward module imports `VaultStore`; `liveSentinel.property.test.ts`;
   `test_knowledge_wall.py`) remain the wall — there is exactly one narration seam to guard.
6. **Voice content-neutrality.** A distinctiveness mechanism may shape *how* a line reads, never
   *what* the NPC knows/wants/achieves. *Proof:* if a rewrite changes a line's knowledge, intent, or
   outcome, it fails; the Vault/knowledge sentinels are untouched by voice-sharpening.
7. **Voice distinctiveness (measurable).** In a multi-NPC scene, unlabeled lines are attributable to
   the right NPC **above chance** (e.g. a reader study or trained classifier over a sample of lines),
   **while** scene flow/coherence stays high (no felt register shifts). *Proof:* the attribution
   test passes *and* a seam check finds no discontinuities — distinctiveness up, seams flat.
8. **Full-fidelity cost containment (mode C).** The awake-set bound, per-turn budget guard, and
   graceful degradation to gated mode hold under load; belt-fire telemetry counts only applied
   folds. *Proof:* 0132's cost-ledger + graceful-degrade tests; a busy turn degrades to S1 without a
   stall, and the integrity invariants 1–6 hold identically at full fidelity.

**No closed-set authority moves to the model at any fidelity.** `expressiveNonCollapse` and the
Vault-Wall sentinels remain the standing proof for arms B and C alike.

## Consequences

- The social-deduction floor gets **real** enrichment: NPCs pursue authored wants and hold divergent
  memories, so the house reads as an independent social system, not a mirror of the player — without
  paying Sonder's sycophancy, N-stochastic-call, latency, or committee-prose costs.
- The Vault Wall stays a **single seam** even as cognition fans out to N calls — the enforcement
  burden does not multiply, which is the security argument for one narrator made concrete.
- Voice distinctiveness becomes a **tunable, content-neutral** property of one completion, measured
  by attribution rather than bought with N narrators.
- The work is **flag-gated and A/B-able** end to end: gated mode (0131-S1) is the safe fallback, full
  fidelity (0132) is opt-in behind a budget guard that degrades to gated under pressure.
- This is a **design record only**. The sub-designs and the full-fidelity mode split into feature
  issues with their own DoR/DoD/AC (per each source issue's DoD) — already drafted as **feature
  0131** (F-fwd-1/2/3 = S1/S2/S3) and **feature 0132** (full-fidelity). Build begins only after the
  faithful-seam cluster (Theme A/B — #1726 engine-presence gating, #1735 terminal constraints) has
  landed or is in flight; there is no point enriching cognition a broken seam won't honor.

## Relationship to the other records in this cluster

This ADR is the **umbrella** for the Sonder-hybridization cluster and is deliberately
non-duplicative of the records PR #1747 already landed:

- **ADR 0021 (narration voice architecture)** — the standalone deep record of arm A (the #1738
  decision). This ADR restates the decision for self-containment and does **not** supersede 0021;
  0021 remains the authoritative voice-arm detail.
- **Feature 0131 (per-NPC authored cognition)** — the implementer spec for arm B (#1736), holding
  S1/S2/S3 seams, cost/cache policy, and per-sub-design gates.
- **Feature 0132 (full live per-NPC cognition)** — the implementer spec for arm C (#1739), holding
  the parallel-cheap-tier architecture, cost model, budget guard, and A/B plan.
- **ADR 0020 (split-authority logging)** — the sibling from the same backlog wave (#1737), on the
  render-log tier; orthogonal to this ADR (that one is *where the transcript log lives*; this one is
  *how much cognition the model authors and how narration funnels*).

---

*Provenance: multi-audit backlog 2026-07-20/21 — the Sonder design thread + BB-Nerd audit
scoreboard, folded into one ADR-adjacent design record per owner request. Design record for
issues #1736 / #1738 / #1739.*
