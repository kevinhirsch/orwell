# 0005 — Split authority by openness (the engine records the open set, never normalizes it)

> **Status:** Principle **Accepted**; the generative-consequence mechanism **Accepted — BUILT**
> (PR #355, 2026-06-20). Originally drafted as Proposed (mirroring 0002's "Accepted (math
> Proposed)" split) and shipped end-to-end in the same PR — see the amended "Implementation
> status" below. The original "Proposed" framing is kept in the body for history.
> **Source:** human feedback (this session), worrying about sync work flattening the game:
> *"I just think about a creative player that speaks to the LLM in an edge-case-sorta way and
> drives the game in a really creative sense that we haven't 'coded' for, and I worry that the
> engine will normalize the game into something boring… the dynamicism of a human talking to an
> LLM requires a mapping of a neverending lexical book of words into a game engine. I just want
> to make sure that everything stays dynamic."*
> **Refines:** 0003 (the conversation is the game) and 0002 (the relationship model). Bounded by
> mandate #3 (anti-sycophancy) and the Vault Wall (mandate #2).

## Context

The rebuild adds a deterministic engine behind the narration LLM, and with it a growing layer of
**sync machinery** — version/idempotency guards, the beat-signature desync checkpoint
(`frontend/routes/chat_helpers.py`), the in-loop nudges and the `_auto_record_scene` / deal /
move back-fills (`frontend/src/agent_loop.py`). Every one of those exists to keep the LLM and the
engine agreeing on what is true.

There is a real hazard in that work. A human talking to an LLM occupies an **open, effectively
infinite** expressive space: the same word means different things in different heads, and a
creative player will drive the game in directions nobody "coded for." The engine, by contrast,
speaks a **small, closed** vocabulary — `recordInteraction`'s `kind` is one of seven values
(`alliance | gossip | conflict | bonding | strategy | showmance | betrayal`,
`EngineCommandsAdapter.ts:15`); deals are one of four kinds; pending decisions are a fixed enum.

If sync work is built carelessly, it forces the open thing through the closed thing's vocabulary
— a *symbolic* mapping (player utterance → nearest enum → table lookup) that **flattens** the
infinite into the finite and makes the game "boring." This record draws the line that keeps that
from happening, so the sync spine can get as strict as it likes about *facts* while leaving the
*play* untouched.

### What the code already does (the good news, so this record is grounded)

Trace a recorded scene through `recordInteraction` (`EngineCommandsAdapter.ts:86`) and
`foldHiddenImpact` (`src/engine/consequence.ts:49`):

```
infinite player utterance
  → recordInteraction(content: <full free-text prose>)   LOSSLESS — content stored verbatim (evt record)
  → kind ∈ {7 values}                                    the ONLY lossy step
  → rel.applyDirected(other, initiator, kind, rng)       a HIDDEN, engine-owned, seeded, GRADED nudge
  → soulMemo(witness, content)                           LOSSLESS — full prose indexed into semantic recall
  → later: knows[] / recall surface the full prose        LOSSLESS
  → narration reads back the prose                        infinite again
```

The expressive channel is already **infinite → infinite, lossless end to end**. The single lossy
step is the seven-way `kind` tag — and all it does is choose *how a hidden number moves*, which
the player never sees and which only *biases* (never dictates) future behavior. The code already
states the split it depends on: *"The ENGINE owns the magnitude (anti-sycophancy); a caller may
PROPOSE the interaction's nature (`kind`)"* (`consequence.ts:22`). The FE desync guard, likewise,
already fires only on **closed-set board claims** — a phantom eviction, an early winner, a
mis-narrated tally, an unchanged HOH (`chat_helpers.py:_narration_claims_outcome`); it has no
opinion about social or creative prose.

So the architecture is *already* most of the way here. This record names the principle so it
**stays** true as the sync spine grows.

## Decision

**Split authority by *openness*, not by *layer*.** Every thing the system handles belongs to one
of two sets, and authority is assigned by which set it is in — never by which component touched it.

### The closed set — finite, deterministic; the engine is dictator

Things that must be exact and have **no creative content to lose**: competition outcomes,
eligibility/legality, who is HOH / nominated / evicted / what week it is, vote tallies, win
conditions, persistence integrity, and the Vault Wall. Nobody's creativity is expressed in *"I'd
like the vote to be 5–2."* The engine owns these absolutely (this is also mandate #3,
anti-sycophancy, and #2, the Vault Wall). **All sync machinery operates here.**

### The open set — infinite, generative; the engine is a *faithful recorder*, never a *normalizer*

The meaning, texture, and **consequence** of social and creative play — the entire "neverending
lexical book." Here the engine's only jobs are to **record faithfully**, **apply a hidden, graded,
bounded consequence**, **persist without degradation**, and **recall in full**. It may **never**
collapse an open-ended utterance into a closed bucket *in a way that changes what the model may
narrate or what later play can express.*

### Principles (these bind all sync and consequence work)

1. **No sync mechanism may resolve an ambiguity by collapsing the open set onto the closed set.**
   The desync guard's jurisdiction is *hard factual (closed-set) claims only*. It must never
   suppress, "correct," or rail-back a creative thread merely because the thread is novel. When in
   doubt, record and let it run. (Today this largely holds — `_narration_claims_outcome` is
   already scoped to board outcomes; this principle ratifies it so it cannot drift.)
2. **The open set is recorded losslessly.** The free-text `content` of a scene is stored and
   recalled verbatim. No normalization, truncation, or canonicalization of the player's words.
   The coarse tag (`kind`) rides *alongside* the prose; it never *replaces* it.
3. **Interpretation is open; magnitude is closed.** Reading *what kind of thing a player did, to
   whom, in what direction* is open-set work and may be as rich as the scene — the LLM is the
   right interpreter of an uncoded move. Deciding *how far a hidden number moves* is closed-set
   work and stays engine-owned, bounded, and seeded (so it can never be inflated to please the
   player — mandate #3). Widening what the LLM may *propose* must never widen what it may
   *magnitude*.
4. **A novel move must never evaporate.** A creative action that fits no existing lever is a
   recording gap, not a non-event. It is recorded (full prose), consequenced (a nonzero hidden
   fold where one is warranted), and recalled — never silently dropped because no enum matched.
5. **Closed-set strictness is encouraged.** *Because* the open set is constitutionally protected,
   the sync spine may be as rigorous as it wants about versioning, idempotency, and outcome truth.
   Rigor about facts is not a threat to dynamism; it is what lets the model be freely dynamic
   without the harness interrupting good scenes to fix bookkeeping.

### The generative-consequence path (Proposed — the recommended mechanism)

Today the lossy step is a **seven-way symbolic classifier** driving the hidden magnitude. To move
from *symbolic* mapping toward *generative* mapping without breaking anti-sycophancy:

- **Widen what the LLM may propose** beyond the seven `kind` values — toward a richer, scene-
  grounded descriptor of the consequence *shape*: which directed edges move, in which direction,
  with what *relative* emphasis, and *why* (anchored in the specific utterance). This is the LLM
  doing reading-comprehension of the player's own action — open-set work.
- **Keep magnitude, bounds, seeding, hiddenness, and persistence engine-owned.** The LLM proposes
  *direction and relative shape*; the engine sets the *amount* within bounded, seeded deltas it
  already owns (`rel.applyDirected` / `relationshipConstants`), so a proposal can never pump an
  edge to flatter the player. The existing per-call (`MAX_FOLDS_PER_INTERACTION`) and per-beat-
  per-edge (`MAX_FOLDS_PER_PAIR_PER_BEAT`) budgets stay.
- **Cost/risk knobs left open** (why this is Proposed, not Accepted): whether interpretation rides
  the existing `_auto_record_scene` extraction call or a new one (latency), how a free-form
  descriptor maps onto the directed-edge signal set without re-introducing a closed enum by the
  back door, and the exact guard that keeps proposed *shape* from leaking into proposed *amount*.

The `kind` field stays valid and is the floor; the generative descriptor is a superset, so this is
additive and backward-compatible.

### Testability — the expressive-non-collapse gate

Dynamism becomes a **regression gate**, the way richness already is (`richnessConfig.ts`) and the
Vault Wall is (the sentinel). A corpus of deliberately weird, **uncoded** player utterances (roles
only, no names — testing rule), asserting:

1. **Lossless record** — the full `content` lands in the event store byte-equal; no truncation or
   normalization of the player's words.
2. **Consequenced, not dropped** — a warranted scene folds a *nonzero* hidden delta; an
   un-warranted one is still *recorded* (never silently discarded for want of a matching enum).
3. **Recalled in full** — the prose is retrievable later via semantic recall / `knows[]`, not just
   its tag.
4. **Distinguishable downstream** — two *different* creative scenes that both map to the same
   `kind` remain distinguishable later (different content recalled): proof the tag is not the only
   thing that survives.
5. **No rail-correction of creativity** (FE-side, pytest) — a creative narration that asserts *no*
   closed-set outcome must return no re-ground from `_narration_claims_outcome`; only hard board
   claims may ever be corrected.

(1)–(4) are engine-side Vitest; (5) is FE-side pytest — mirroring the existing engine/FE test
split. None may rely on a prose eval alone; each has a structural assertion underneath.

### Litmus test for any future sync or consequence change

> Does this change keep the **open set** recordable, consequenceable, recallable, and narratable
> in its full richness, while only ever constraining the **closed set** (facts, outcomes,
> bookkeeping)? If it makes the engine *interpret* an open-ended utterance into a fixed bucket in a
> way that changes what can be *said* or *played* next — or lets the desync guard touch creative
> prose — it is the wrong shape, even if it "works."

## Consequences

- **The sync spine is unblocked.** Versioning, idempotency, and outcome-truth guards (the
  `0005`-companion plumbing) may proceed rigorously, because this record fences them out of the
  open set. Strictness about facts is *protective* of dynamism, not opposed to it.
- **The desync guard's scope is now a constraint, not a coincidence.** It may fire only on
  closed-set board claims; touching creative narration is a defect. The expressive-non-collapse
  test (5) pins this.
- **`recordInteraction` gains a generative path (when built).** The seven-way `kind` becomes the
  floor; the LLM may propose a richer, scene-grounded consequence *shape* while the engine keeps
  the *magnitude*. Until built, `kind` remains valid and nothing regresses.
- **A new structural gate joins richness and the Vault sentinel.** Expressive non-collapse becomes
  a permanent regression test, so the day a sync patch starts flattening play, CI says so.
- **This refines, it does not contradict, 0003 and the four mandates.** "The conversation is the
  game" already says *hand the model facts to voice, never scripts to recite*; this record says
  *how* the consequence layer honors that under a growing sync spine — by drawing authority along
  openness, and by making non-collapse testable.

## Implementation status (BUILT — PR #355, 2026-06-20)

The principle and the generative-consequence mechanism shipped together, end to end — the
"(when built)" / "(Proposed)" qualifiers above are now satisfied. The descriptor is Vault-free
and proposes *shape* only; the engine still owns the bounded, seeded *magnitude*, so a caller can
never inflate how much the house likes the player (mandate #3). With no descriptor, the fold is
**byte-identical to before** — `kind` remains the floor and default.

- **The port + engine** — `recordInteraction` / the 0023 `ConsequenceEngine` accept an optional,
  Vault-free `consequence` descriptor: per-edge `{ toward, direction, emphasis? }` + `rationale`.
  `direction` selects an engine-owned base impact; `emphasis` is a clamped multiplier
  (`CONSEQUENCE_EMPHASIS`, `slight`/`notable`/`strong` → 0.6 / 1.0 / 1.4) over the engine's own
  bounded deltas; the open-set *interpretation* rides the free-text `content` + `rationale`. The
  per-call (`MAX_FOLDS_PER_INTERACTION`) and per-beat-per-edge (`MAX_FOLDS_PER_PAIR_PER_BEAT`)
  budgets are unchanged. (`src/ports/EngineCommands.ts`, `src/engine/consequence.ts`,
  `src/engine/relationshipConstants.ts`, `src/adapters/engine/EngineCommandsAdapter.ts`.)
- **The MCP boundary** shape-guards the descriptor — a malformed `consequence` is a clean 400
  naming the field, not a 500 deep in the fold (the E31/D10/R6 edge-hardening pattern;
  `src/adapters/mcp/McpServer.ts`, cases in `tests/integration/edgeHardening.test.ts`).
- **The model reaches it end to end.** `frontend/src/tool_schemas.py` exposes the optional
  `consequence` object; `orwell_engine` / `tool_implementations` forward it; the 0055
  `_auto_record_scene` back-fill can now *propose* one — validated against the living roster + the
  direction/emphasis enums, falling back to kind-only when nothing valid remains, and forbidden
  from proposing any number (magnitude stays engine-owned).
- **The expressive-non-collapse gate is live** — the regression analog of the richness thresholds
  + the Vault sentinel: `tests/unit/expressiveNonCollapse.test.ts` (engine, the lossless-record /
  consequenced-not-dropped / recalled-in-full / distinguishable-downstream assertions) +
  `frontend/tests/test_expressive_non_collapse.py` (the FE no-rail-correction corpus, roles-only).
  The desync guard's WINNER / NEW-HOH branches were scoped to their committed-outcome phase so a
  creative claim cannot trip a board-outcome rail-correction (principle #1).
