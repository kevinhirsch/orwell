# 0002 — Relationship model (re-architecting ALLIES / BEST_FRIEND)

> **Status:** Accepted in direction (drop the binary flags; build a calculated model);
> the **signal set and math are Proposed** — tunable, to refine.
> **Supersedes:** the binary `ALLIES` / `BEST_FRIEND` idea in
> [decision 0001](./0001-competition-stats-souls-and-veto-choice.md) §3.
> **Source:** human feedback (this session): *"who you confide in and who your enemies are"*
> should be **the most calculated and nuanced** part of the sim — not a black-and-white state.

## Context

The first draft stored persistent binary `ALLIES` / `BEST_FRIEND` flags in the soul. That is
too coarse for the single most important social signal in *Big Brother*: trust and threat are
graded, **asymmetric**, uncertain, and constantly shifting. A flag can't express "I'd take a
bullet for them but I'm not sure they would for me," or a friendship cooling two degrees after
an off-hand comment. So: **no binary relationship states anywhere.**

## Decision

Relationships are **directed, continuous, evolving beliefs** held per houseguest in the
dynamic `Soul`, **computed from the accumulated event history** (what was actually witnessed,
said, and done) plus the holder's `Character` disposition and the temperature roll — never
hand-set flags.

### Each directed edge `A → B` carries graded signals

(continuous, e.g. 0..1 or signed; the exact set is tunable)

| Signal | Drives |
|---|---|
| **trust** | who A will confide in / share secret information with |
| **affinity** | warmth / closeness / liking (bonds, showmances) |
| **threat** | how dangerous A thinks B is to A's game (targeting, nominations) |
| **alignment** | overlap of strategic interest *this week* (shifts fast) |
| **reliability** | track record — has B actually had A's back? (computed from past votes/actions) |
| **confidence** | how much interaction data backs this read — **grows** as data accrues (uncertainty shrinks); a read only counts as *knowledge* **above** the confidence threshold, below it it is *suspicion* |

### Properties

- **Directed & asymmetric.** `A→B` ≠ `B→A`. One-sided showmances, misread loyalty, and the
  player's signature **paranoia** all live in the gap between the two directions.
- **Computed, not stored as labels.** A relationship-inference function folds the event
  history (recency-weighted, with **shocks** from betrayals and **decay** when neglected) into
  the signals above. Vector recall (the engine-only `VectorIndex`) can surface relevant past
  interactions to inform the read.
- **Uncertain.** Low `confidence` early — a houseguest can *lean* or *suspect* about a
  relationship long before they can act on it, mirroring the knowledge/suspicion rule (0002
  event-visibility).
- **Labels are organic — not a fixed taxonomy.** The engine stores **no** enum of
  `{ally, enemy, best friend}` and never persists a label. A label is a **soft, momentary
  description** read off the graded signals *through the holder's own `Character` framing* —
  so the same edge surfaces as "ride-or-die," "useful for now," or "a threat I'm keeping
  close" depending on who is doing the reading. Thresholds are **dispositional**: a paranoid
  archetype tips an edge to "enemy" far sooner than a trusting one. Labels therefore **emerge
  from character and history, not a global rulebook**, and they drift as the signals move.
  *Illustratively (not canonically):* a *closest confidant* might surface as
  `argmax(trust · affinity · confidence)`; an alliance "forms" when an edge crosses that
  houseguest's bar and "fractures" when it falls back — the alliance-churn feature 0003
  measures. Only the graded signals and the history are stored; every label is derived on the
  spot.

### Consumers

- **Veto "Houseguest's Choice"** (decision 0001 §4): an NPC holder picks their strongest,
  most-trusted **available** bond as scored here — with temperature variance, not a fixed flag.
- **Confiding / scheming**: gated by `trust`. **Nominations / targeting**: driven by `threat`.
- **Jury management** (endgame): the relationship trajectory *at eviction* (did A blindside or
  respect B?) feeds B's later jury lean.

## Rationale

Emergent, computed, uncertain, asymmetric relationships are where *Big Brother*'s social drama
actually comes from — misreads, slow drift, sudden betrayal, one-sided trust. Modeling them as
beliefs over real history (rather than flags) serves behavioral fidelity (the #1 mandate) and
anti-sycophancy (the read is grounded in what happened, not narrative convenience), and it
gives the player's paranoia something real to chew on.

## Consequences

- **0001 §3** — `Soul` holds *relationship beliefs* (this record), not `ALLIES`/`BEST_FRIEND`.
- **0004** (`SoulProvider`) and **0005** (Houseguest's Choice) — reworded to read this model.
- **0003** (behavioral fidelity) — "alliances form and fracture" = edge signals crossing
  thresholds; the model is what makes that measurable.
- `README.md` / `CLAUDE.md` canonical mechanics — updated.

## Open / to confirm

- The **signal set** (the six above are a starting point) and their **math** — update rule,
  recency/decay, betrayal-shock size, thresholds — are tunable config to design alongside the
  temperature constants (0006).
- Whether NPC→player edges are tracked the same way (they should be — the engine reads how
  NPCs feel about the player), while the player's *own* reads stay human-driven.
- A dedicated feature spec can follow once the math firms up; today this is the architecture.

## Traceability

`docs/bb-sim-spec.md` §11 (Relationship / edge: type, strength, known-by set), §6 (knowledge
vs suspicion); `docs/features/0003-behavioral-fidelity.md` (alliance churn);
`docs/decisions/0001-…` §3–§4; human feedback (this session).
