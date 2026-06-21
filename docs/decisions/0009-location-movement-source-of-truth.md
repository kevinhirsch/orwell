# 0009 — Location & movement: one source of truth, recorded movement, narration grounding

> **Status:** **Proposed — direction ratified by PO (2026-06-21)**; mechanism to be built
> BDD/TDD-first. Captures the refactor target for player + NPC room-location tracking. **PO rulings:**
> (1) the model **narrates the open texture** (who moves where) and the engine **records** it — the
> engine keeps only the seeded baseline for calibration; the acceptance test is simply *consistent and
> dynamic*. (2) Enforcement is **fold-first**: a legal narrated move is recorded into `presence`
> immediately; **re-ground** only the impossible (an evicted houseguest, a non-existent/unreachable
> room, two-places-at-once).
> **Source:** The 2026-06-21 live-walkthrough audit symptom — *the chat-narrated location of the
> player & NPCs is inconsistent with the sidebar location gadget* — plus a three-lane investigation
> (engine model · FE surfaces · root-cause repro against the live game).
> **Builds on:** 0049 (house presence & lingering — the room/adjacency model), 0006 (in-game time,
> sleep & the presence economy — the awake filter), 0003 (the conversation is the game), 0005 (split
> authority by openness — the closed calibration set vs the open social texture).
> **Inherits / bounded by:** the Vault Wall (mandate #2), anti-sycophancy (mandate #3), and
> non-degradation (mandate #4).

## Context

The house has a **room/adjacency floor plan** in the pure core (`src/domain/house.ts` — 9 rooms,
static symmetric adjacency, diary-room isolated). Live occupancy lives in the adapter
(`src/adapters/engine/GameSessionAdapter.ts`) as **`this.presence: Map<EntityId, Room>`**
(player-facing, personality-weighted), alongside `presenceBase` (calibration-neutral, feeds seeded
society pairing) and `presenceTenure` (lingering counter). NPCs are repositioned by a **seeded**
`presenceTick()` (`:1561`) once per player turn (`orchestrator.ts:503`/`:338`); the **player** moves
only via the explicit `moveTo` tool → `movePlayer()` (`:1626`). Both the chat and the gadget read the
**same** Vault-free `whereabouts()` projection (`:1723`) off `this.presence`.

**The data layer is NOT the problem.** The root-cause lane confirmed *live* that the three reads are
byte-identical right now: the gadget endpoint (`/api/orwell/whereabouts`,
`frontend/routes/orwell_routes.py:490`), the engine `whereabouts` tool, and the moment prompt's
"WHERE YOU ARE" block the LLM receives (`src/engine/momentPrompts.ts:748-820`) all returned the same
room + occupants. There is genuinely **one source of truth for the data** and one read path. The
divergence the player sees is **the narration disagreeing with the data, and narrated movement never
reaching the data** — not two stores drifting.

### Root causes (ranked; from the investigation)

1. **Location narration is grounded by prompt text only — never enforced.** The "WHERE YOU ARE"
   block is forceful ("voice THIS room and THESE people EXACTLY; NEVER invent positions") but nothing
   reconciles the prose against `whereabouts` after the fact. The *only* location-class enforcement,
   `_pending_barrier_directive` (`frontend/routes/chat_helpers.py:310`), grounds **only** the
   `comp-round` still-in set (the LW9 fix) — it does nothing for room occupancy. This is the exact
   LW9 pattern (`docs/audits/2026-06-10-full-product-audit.md`: *"the model overrode it with
   memory… prompt-grounding, not a guarantee"*). Per this codebase's own documented behavior the LLM
   under-calls/ignores tools and improvises, so it narrates people into/out of rooms (or "a room to
   themselves") contrary to the faithful gadget. *(The prompt's anti-"empty room" wording exists
   because this already happened.)*
2. **Narrated NPC movement is never recorded; only the player's move folds back.** `moveTo` is
   **player-only** (`_MOVE_TOOLS = {"moveTo"}`), backed by the `_auto_move_player` belt
   (`frontend/src/agent_loop.py:1724`). **There is no NPC-movement tool and no belt.** When the model
   narrates "Carson heads to the kitchen," nothing mutates `this.presence` for Carson → the next
   gadget poll still shows him where the seeded tick last put him → a direct contradiction with the
   prose. This is the "narrated but never recorded" failure class (CLAUDE.md calls it a failure
   state) — with **no remediation path at all for NPCs**.
3. **Player and NPCs move by different, unsynchronized authorities over one shared map.** NPCs:
   seeded `presenceTick` (once/turn, decoupled from narration). Player: explicit `moveTo`. Two movers
   over one map means the prose (narrated moment-to-moment) and the board (last tick + last `moveTo`)
   drift even when each is internally "correct."
4. **Prompt-vs-poll temporal skew (conditional).** The moment prompt is fetched at the **start** of
   the turn (`chat_helpers.py:1085`); `presenceTick` re-seats NPCs on the **commit at the end** of
   the turn; the gadget polls every 25s (`frontend/static/js/orwellPresence.js`) but also refreshes
   on `orwell:gamechanged`. So the gadget's post-turn poll can reflect a **newer** occupancy than the
   prose the player just read — the room "rearranges" as the message lands. With the wall-clock
   watcher enabled, `awakeNow()` (`:1670`) dropping asleep NPCs adds another skew window. (Watcher is
   off by default.)
5. **Ruled out — non-deterministic recompute.** `whereabouts()` is a pure read of persisted
   `this.presence`; `awakeNow()` keys off the discrete persisted `timeOfDay` phase, not `Date.now()`.
   Two reads in the same beat are identical.

## Decision (proposed)

Keep `this.presence` as the single source of truth, and **make both narration and mutation bind to
it** by closing the two leaks (unenforced narration; unrecorded NPC movement) and removing the
snapshot skew:

- **D1 — One occupancy snapshot per turn.** Re-seat NPCs (`presenceTick`) **before** building the
  moment prompt, and have the turn response carry the post-tick `whereabouts` the gadget renders, so
  the model's grounding and the gadget reflect the **same** snapshot. Freeze occupancy for the turn so
  it never rearranges as the message lands.
- **D2 — Record movement for everyone.** Add an NPC-relocation path mirroring the player's
  `moveTo` + `_auto_move_player`: a Vault-free engine command (or a structured "move" the model
  emits) that mutates `this.presence`, **plus an FE auto-belt** that folds a narrated NPC relocation
  the model failed to record — so "Carson heads to the kitchen" actually moves Carson and the gadget
  agrees. Mutation is on the **open set** (`presence`) only; the seeded `presenceBase` calibration
  stream is untouched (see Risks).
- **D3 — Reconcile narration to the board, FOLD-FIRST (PO ruling 2026-06-21).** When prose places or
  moves people contrary to `whereabouts`, **hard-fold** the narrated move into `presence` (the D2
  path) so the engine immediately agrees with the story — the model authors the open texture, the
  engine records it. Fall back to **re-ground** (correct the model next turn; mirror the
  beat-signature checkpoint + surface `whereabouts` as an enforceable per-turn fact like the
  `comp-round` clamp in `_pending_barrier_directive`) **only** for narration that cannot be folded
  into a legal state: an evicted houseguest, a non-existent/unreachable room, or someone in two
  places at once. A legal move always folds; only the impossible is re-grounded.
- **D4 — Pin the dual-map contract (ADR 0005).** Make explicit that `presence` is the **open**,
  player-facing/narratable occupancy (the gadget + narration + the D2 fold bind here) and
  `presenceBase` is the **closed**, calibration-neutral occupancy (seeded society pairing binds here).
  Collapse to one map only if calibration isolation can be preserved another way.

## Consequences

- **The chat and the gadget always agree** — same per-turn snapshot (D1), recorded moves (D2),
  enforced narration (D3). The "people make sense / one place at a time" invariant (CLAUDE.md) holds
  in the UI, not just the engine.
- **Narrated NPC relocation becomes real** (persisted), so location is consequential social texture,
  not flavor — consistent with "lingering is play" (0049) and "the conversation is the game" (0003).
- **Risk — calibration:** the D2 fold must not perturb seeded outcomes. Bounding mutation to the
  open `presence` map (D4) keeps `presenceBase` / society pairing / seeded comps byte-identical;
  guard with byte-identity tests in the `stagedTrajectoryNeutral` spirit.
- **Risk — surface area:** a new NPC-move command/beat + an FE belt + a location checkpoint. Mitigated
  by reusing the established `moveTo` / `_auto_move_player` / `_pending_barrier_directive` /
  beat-signature patterns rather than inventing new ones.

## Alternatives considered

- **Prompt-only grounding (status quo).** Rejected — LW9 proves forceful prompt text gets overridden
  by model memory; no enforcement, no recorded moves.
- **Align the gadget poll cadence only.** Rejected — fixes the ≤25s lag (#4) but not the primary
  causes (#1 narration contradictions, #2 unrecorded NPC moves).
- **FE parses the chat prose for location.** Rejected — fragile NLP and inverts the engine-as-SoT
  model.
- **Let the model be the SoT (gadget follows the prose).** Rejected — violates anti-sycophancy
  (mandate #3) and the Vault/engine-authority model.

## Testability (BDD/TDD-first)

- **Location grounding** — extend `frontend/tests/test_pending_barrier.py`-style coverage: the
  per-turn framing surfaces the engine `whereabouts` as an enforceable fact (rooms + occupants), and a
  post-turn reconciliation fires on a contradiction.
- **Recorded movement** — a narrated NPC relocation folds into `presence` (engine reflects it; the
  gadget projection updates), with an under-call belt test mirroring `_auto_move_player`.
- **Snapshot consistency** — for a single turn, the moment-prompt whereabouts block == the gadget's
  `/api/orwell/whereabouts` (same snapshot; no start-vs-end skew).
- **Calibration neutrality** — the D2 fold leaves seeded outcomes byte-identical (society pairing,
  comps, votes), in the `stagedTrajectoryNeutral.test.ts` spirit.

## Owner rulings (resolved 2026-06-21)

1. **Who decides NPC movement?** → **The model narrates the open texture** (who wanders where); the
   **engine records it** and keeps only the seeded baseline for calibration. The acceptance test is
   simply *consistent and dynamic* (PO: *"ultimately doesn't matter as long as it's consistent and
   dynamic"*). Confirms the ADR-0003/0005 lean.
2. **Enforcement strength (D3)?** → **Fold-first.** A legal narrated move is recorded into `presence`
   immediately (the engine concedes to plausible prose); **re-ground** only the impossible (an
   evicted houseguest, a non-existent/unreachable room, two-places-at-once) — there is nothing legal
   to fold.

## Key files

`src/domain/house.ts` (floor plan) · `src/adapters/engine/GameSessionAdapter.ts`
(`whereabouts()`:1723, `movePlayer()`:1626, `presenceTick()`:1561, `awakeNow()`:1670) ·
`src/engine/presence.ts:82` (`assignRooms`) · `src/composition/orchestrator.ts:503`/`:338` (tick
timing) · `src/engine/momentPrompts.ts:748-820` (LLM grounding block) ·
`frontend/static/js/orwellPresence.js` (gadget) · `frontend/routes/orwell_routes.py:490` (gadget
endpoint) · `frontend/routes/chat_helpers.py:310`/`:1085` (moment-prompt fetch + the comp-round-only
barrier) · `frontend/src/agent_loop.py:1724`/`:3414-3488` (`_auto_move_player`, player-only belt).
