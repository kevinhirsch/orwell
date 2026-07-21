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
would cost fluency and Vault security). Its two layers get security from **two different**
mechanisms, and it is important not to conflate them: **narration** is monolithic, so the Vault
Wall is enforced at exactly **one** player-facing prose seam; **cognition** fans out to N calls, so
its security is *not* "one seam" — it is that each of the N calls is **individually
knowledge-scoped** (gated on engine presence, ADR 0019), **emits structured data, never
player-facing prose**, and is covered by **aggregate leak testing across the N requests** (the
union of all N cognition calls must leak nothing outside each NPC's legitimate knowledge). Together
that is still strictly *more* Vault-secure than Sonder, whose N per-character *writing* agents each
add a fresh player-facing prose seam; Orwell adds no prose seam beyond the one narrator.

### A. One funnel voice, not N narrators (the #1738 arm)

**Choose one fluent narrator over N per-character writing agents**, for three reasons:

1. **ADR 0003 — fluent prose, not committee seams.** One voice fluent in the whole cast and its
   relationships writes better, more readable prose than N per-NPC narrators stitched together.
   Committee prose (multiple models, lines produced in isolation that must fit together) reads with
   visible seams, register shifts, and false consistency breaks. ADR 0003 governs: don't trade
   fluent prose for a control panel of per-NPC agents.
2. **Security — one player-facing prose seam.** The Vault Wall on *narration* (mandate #2) is
   enforced at exactly *one* place: the single completion that writes player-facing text. One
   narrator = one place to lock down knowledge-scoped voice (ADR 0019). N per-character *writing*
   agents = N player-facing prose surfaces, each needing the ADR 0019 scoping enforced
   independently — N× harder to audit, and exactly the failure class ADR 0019 names (one shared
   context, one model, many NPCs reaching into it; the casting-interview and "recalled something
   they weren't privy to" leaks). One prose seam is defensible; N are not. *(This is the narration
   argument only; cognition also fans out to N calls, but those emit **data, never prose**, and are
   secured differently — see the Decision preamble and invariants 3 & 5.)*
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
`recordInteraction` `consequence` descriptor (PR #355). The **actual** contract (`ConsequenceDescriptor`
in `src/ports/EngineCommands.ts`, cite it exactly — a wrong shape produces a no-op write) is
`{ edges?: Array<{ toward, direction, emphasis? }>, aboutEdges?, rationale? }`, where `direction` is a
member of the **closed** `ConsequenceDirection` set (`warmer`/`cooler`/`more-trust`/`less-trust`/
`more-threatened`/`less-threatened`/`more-aligned`/`less-aligned`) and `emphasis` is a **relative**
weight only (`slight`/`notable`/`strong`) — never a magnitude. The `kind` is **not** part of the
descriptor: it is a **separate request-level field** on `RecordInteractionReq` (`kind?: string`) that
seeds the engine's base magnitude and is the **floor + default** (no `consequence` descriptor ⇒ the
fold is byte-identical to the legacy `kind`-only path). So the model proposes *which* edges move, *in
which* closed direction, with *what relative* emphasis, and *why* (`rationale`, recorded losslessly,
never scored); the engine keeps the bounded, seeded amount. "Model proposes, engine disposes."
Authored cognition is a **bounded weighted input** to engine resolution, never the resolution.

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
  "counselor vibe") killed for the one high-risk case: when a **present** NPC's knowledge sharply
  diverges from the shared transcript, a per-NPC scoped call returns **structured residual/intent
  data** — the specific knowledge-divergent point + the NPC's intent for the beat — and the **one
  narrator** writes the prose from that data. S3 is **not** a per-NPC prose completion: even when the
  beat needs an NPC-specific line, it is still the sole narrator writing it from S3's structured
  data. This keeps "fan out cognition (data), funnel narration (one voice)" with no exception.
  Knowledge-divergence-gated; bounded to that NPC, that beat.

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

Arms A–D are one rule at two layers, each **secured differently**. **Cognition fans out** (many
cheap, scoped, data-only calls, each authoring open-set shape) so the house feels alive and
independent — its security is per-call knowledge-scoping (invariant 3) + data-only outputs
(invariant 5) + aggregate leak testing across the N calls, **not** a single seam. **Narration
funnels** (one fluent voice) so the prose stays coherent and the Vault Wall on player-facing text
stays enforceable **at one prose seam**. **Neither arm ever moves closed-set authority to the
model** — outcomes, state, knowledge, and persistence remain engine-owned and seeded, at gated
*and* full fidelity.

## Integrity invariants (expressed as testable gates)

Every mechanism in this ADR MUST hold these. They are the acceptance surface for the feature issues
that split off. **The existing `expressiveNonCollapse` + Vault-Wall sentinels are reused only for
what they actually cover** — the current social-consequence *descriptor* path (open-set
non-collapse; no closed-set authority movement through `recordInteraction`). They do **not** exercise
the NEW per-NPC cognition calls, their access to resolution/state, or the parallel fan-out — so the
gates marked **(NEW gate — build with the feature)** below must be written alongside the
implementation. An implementation could route authored cognition into a closed-set resolver and
still pass the existing sentinels; that is exactly why the new gates are required.

1. **Cognition-only (never outcome). (NEW gate — build with the feature.)** A per-NPC cognition call
   may author `want/attempt/read` only; the deterministic resolver owns `resolve/state`. *Proof:* a
   **new dedicated acceptance test** asserting a cognition-call response **cannot write** `resolve`
   or `state` — the authored cognition is a **bounded INPUT** to the seeded resolver, never the
   resolution (drive a call whose response tries to set an outcome/magnitude; assert the engine
   ignores it and the seeded result stands). The existing `expressiveNonCollapse.test.ts` +
   `frontend/tests/test_expressive_non_collapse.py` remain the proof **only** for the descriptor
   path they cover (no descriptor ⇒ byte-identical fold), not for the cognition boundary.
2. **Bounded-input-to-resolution.** Authored cognition enters resolution only through the
   `ConsequenceDescriptor` shape (`src/ports/EngineCommands.ts`, the #355 pattern) —
   `{ edges?: [{ toward, direction, emphasis? }], aboutEdges?, rationale? }`, with `direction` from
   the **closed** `ConsequenceDirection` set and `emphasis` a **relative** weight
   (`slight`/`notable`/`strong`), never a magnitude; `kind` is the **separate request-level field**
   on `RecordInteractionReq` that seeds the engine's base. No raw number and no free text crosses
   into the closed set. *Proof:* the descriptor-shape guard on the resolver path (the `McpServer`
   arg-guard already refuses malformed `consequence.edges[]`); a planted intent cannot move an
   outcome beyond the engine's bounded, seeded amount.
3. **Knowledge-scoped (on ENGINE presence). (NEW gate — build with the feature.)** Every per-NPC
   call is scoped to what the engine says that NPC knows, gated on **engine** presence (#1726 / A2),
   never on what the narrator happens to hold in context (ADR 0019). *Proof:* **two new tests**
   modeled on the ADR 0019 per-NPC sentinel — **(a) a per-call knowledge-scope test:** plant a token
   into a scene witnessed only by NPC B, assert it is absent from A's scoped call input, and a
   producer-only token is globally absent from every call's input; **(b) an aggregate-leak test
   across the parallel fan-out:** the **union** of all N cognition-call inputs on a turn leaks
   nothing outside each NPC's legitimate knowledge. The existing narrator-seam sentinels do not
   exercise the cognition-call inputs, so these gates are new. N parallel calls must not re-open the
   leak N times.
4. **Soul-anchored.** Each call *continues* the persisted character (stable public persona, "people
   make sense," 0041); it never re-rolls the character. Outcomes fold back via `evolveFromBeat`.
   *Proof:* `CHARACTER` byte-stable across a cognition beat; the authored read persists to soul, not
   chat.
5. **Funnel-narration (one prose seam). (NEW gate — build with the feature.)** Cognition calls emit
   **structured data/intent only, never prose**; exactly one completion writes every NPC's words
   (including S3's NPC-specific lines, produced by the sole narrator from S3's structured data).
   *Proof:* a **new funnel-only test** asserting no per-NPC prose is emitted by any cognition call
   (their outputs validate against the structured-data schema, contain no narration) and that the
   scene's player-facing text comes from a single narration completion. The existing Vault-Wall
   structural sentinels (dependency-cruiser: no outward module imports `VaultStore`;
   `liveSentinel.property.test.ts`; `test_knowledge_wall.py`) remain the wall on that **one**
   narration seam — but they do not by themselves prove the cognition calls stay prose-free, hence
   the new gate.
6. **Voice content-neutrality.** A distinctiveness mechanism may shape *how* a line reads, never
   *what* the NPC knows/wants/achieves. *Proof:* if a rewrite changes a line's knowledge, intent, or
   outcome, it fails; the Vault/knowledge sentinels are untouched by voice-sharpening.
7. **Voice distinctiveness (measurable — reproducible protocol). (NEW gate — build with the
   feature.)** "Above chance" is only a gate if the protocol is fixed. Define it so repeated runs and
   the A/B flag modes are comparable:
   - **Corpus:** a fixed sample of **N = 200 unlabeled lines** drawn from **M = 8 distinct NPCs**
     over **K = 10 scenes** (seed-fixed so the same corpus regenerates).
   - **Chance baseline:** random guessing among the M candidates = **1/M = 12.5%** attribution.
   - **Attributor:** a held-out reader panel *or* a trained classifier scores each unlabeled line →
     one of the M NPCs.
   - **Acceptance threshold:** mean attribution accuracy **≥ 40%** (a **≥ 27.5-point** absolute
     improvement over the 12.5% baseline), significant at **p < 0.05** (binomial vs. chance; report
     the 95% CI).
   - **Coherence/seam rubric (fixed, scored 1–5):** register consistency, absence of felt
     interruptions/topic-jumps, and pronoun/tense stability across a scene; **acceptance = mean ≥ 4.0
     with no scene below 3.** A distinctiveness gain that drops the coherence score **fails** (that
     is the "N voices with seams" regression).
   - **Reproducibility:** the **same** protocol (corpus seed, thresholds, rubric) runs on every
     evaluation and across **both A/B flag modes** (full-fidelity vs. salience-gated), so the numbers
     are directly comparable run-to-run.
   *Proof:* the attribution test clears the ≥ 40% / p < 0.05 bar **and** the coherence rubric clears
   ≥ 4.0 — distinctiveness up, seams flat, on a fixed reproducible corpus.
8. **Full-fidelity cost containment (mode C).** The awake-set bound, per-turn budget guard, and
   graceful degradation to gated mode hold under load; belt-fire telemetry counts only applied
   folds. *Proof:* 0132's cost-ledger + graceful-degrade tests; a busy turn degrades to S1 without a
   stall, and the integrity invariants 1–6 hold identically at full fidelity.

**No closed-set authority moves to the model at any fidelity — but this is proved by the NEW gates
above, not by the existing sentinels alone.** `expressiveNonCollapse` + the Vault-Wall sentinels
remain the standing proof for **what they cover**: open-set non-collapse and no closed-set authority
movement on the *existing descriptor path*. They do **not** exercise arms B and C's new paths —
scoped per-NPC cognition calls, the parallel fan-out, the budget-fallback, and funnel-only outputs —
so each new arm ships with its **own** acceptance gate: **(a)** a per-call knowledge-scope test (no
NPC receives out-of-scope Vault knowledge, invariant 3a), **(b)** an aggregate-leak test across the
parallel fan-out (invariant 3b), **(c)** a cognition-response-cannot-cross-into-closed-set-authority
test (invariant 1), and **(d)** a funnel-only test (no per-NPC prose emitted; one narrator writes,
invariant 5). Presenting the existing sentinels as sufficient proof for the new arms would be a gap;
the new gates close it.

## Consequences

- The social-deduction floor gets **real** enrichment: NPCs pursue authored wants and hold divergent
  memories, so the house reads as an independent social system, not a mirror of the player — without
  paying Sonder's sycophancy, N-stochastic-call, latency, or committee-prose costs.
- The Vault Wall on **player-facing prose** stays a **single seam** (one narrator), while **cognition
  fans out to N calls** secured by per-call knowledge-scoping + data-only outputs + aggregate leak
  testing — two distinct mechanisms, neither claiming the other's guarantee. Orwell adds **no** prose
  seam beyond the one narrator, which is the concrete security win over Sonder's N writing agents.
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
