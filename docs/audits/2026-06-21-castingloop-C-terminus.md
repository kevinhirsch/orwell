# 2026-06-21 — Casting-loop "C" terminus + background-authoring reasoning burn

**Scope:** READ-ONLY investigation of the prod debug bundle
(`2026-06-21-casting-loop-evidence.md` + `2026-06-21-casting-loop-bundle.json`,
prod v4.95, DeepSeek V4 Pro, phase=setup/casting). Two linked questions: the
agent-loop terminus ("stuck in an agentic loop for EVERYTHING"), and the
~$0.07 background-authoring reasoning burn during casting. Findings + fix
recommendations + test specs below. No code edited.

Roles only throughout (player, producer/NPC interviewer, houseguest).

---

## Question 1 — Is there a guaranteed terminus, and why does it feel infinite?

### 1.1 The per-TURN bound IS guaranteed (and tight enough)

A single agent turn is hard-bounded:

- `MAX_AGENT_ROUNDS = 50` — `frontend/src/agent_tools.py:25`.
- The loop counter: `for round_num in range(1, max_rounds + 1)` —
  `frontend/src/agent_loop.py:3066`, with `max_rounds: int = MAX_AGENT_ROUNDS`
  defaulted per call at `agent_loop.py:2582`.
- On exhaustion it emits a terminal `rounds_exhausted` event and returns —
  `agent_loop.py:4444-4456`.

So no single turn runs forever. In the bundle each turn terminates: rounds 1→6
then the loop *returns*, and a NEW `stream_agent_loop` is entered (the second
`round=1` line). The "infinite" feel is **not** a runaway within one turn.

> Note: the bundle shows each turn ending at round ~6, not 50. That is the
> *normal* casting cadence (a couple of narration rounds + one or two nudge
> rounds). The defect is not the in-turn cap; it is that **consecutive turns
> keep restarting the same nudge cascade**.

### 1.2 There is NO per-SESSION or per-PHASE bound — the cascade is purely per-turn, persisted across turns

The casting finalize cascade (`agent_loop.py:3987-4048`) escalates via a
**per-user persisted counter** `_CASTING_STALL_LEVEL` (`agent_loop.py:1487`),
exactly mirroring the live-play `_ADVANCE_STALL_LEVEL` (`agent_loop.py:2334`)
and `_TURNS_SINCE_PROGRESS` (`agent_loop.py:2338`). Every finishing turn that is
a lull re-enters the block and **increments** the level (`agent_loop.py:4022-4023`):

```python
if _ready:
    _clv = _CASTING_STALL_LEVEL.get(owner, 0)
    _CASTING_STALL_LEVEL[owner] = _clv + 1
    if _finalizable and (_clv >= _CASTING_FORCE_LEVEL or _explicit_ready):
        ... do_create_character ...           # the ONLY terminus
    _cn = _CASTING_NUDGES[min(_clv, len(_CASTING_NUDGES) - 1)]   # text caps, force does NOT
    ... append nudge, yield agent_step, continue
```

**The defect:** the forced-finalize terminus is gated on `_finalizable`
(`agent_loop.py:4013`, `:4024`). The text-nudge index *saturates* at
`len(_CASTING_NUDGES)-1 == 1` (`agent_loop.py:4041`), so once the level passes 1
the player just gets the **same final nudge text forever**. If the engine never
reports `finalizable` (a name is on file → `ready=True`, but the interview is too
thin to mint a real character → `finalizable=False`), then:

- `_ready` is True every turn → the cascade fires every turn,
- `_finalizable` is False → the forced `do_create_character` terminus **never
  arms**,
- the text nudge is pinned to its last rung,

…and the system nudges the model to "finalize NOW" **on every lull turn,
indefinitely**, with no per-session attempt cap and no phase-level escape hatch.
That is the precise hole: **a per-turn cascade with a conditional terminus and
no unconditional fallback bound.**

The bundle confirms this exact state:
- `gameState: started=True phase=setup week=0` (interview never left setup).
- Only `auto-recorded casting fields=['playerName']` ever lands
  (evidence lines 39/44/48; bundle lines 450/534/570) — name only, so
  `ready=True` / `finalizable=False`.
- The casting nudge climbs `L0 → L1 → L2 → L3 → L4` across the turns
  (evidence lines 45/49/57/60/66) — i.e. `_CASTING_STALL_LEVEL` kept
  incrementing and never hit a forced finalize.
- The model's own `reasoning` (bundle line 775) literally says: *"The player is
  frustrated — they feel like we're stuck in a loop, asking the same thing over
  and over."* The model is re-narrating the same beat (re-asking the life
  question, never deepening the record), and the FE keeps nudging "finalize" for
  a finalize that can't happen.

### 1.3 Why the loop-breaker and ADR 0011 do NOT catch this

- **Loop-breaker (`agent_loop.py:4050-4079`).** `_stuck_rounds` increments only
  when a round **repeats a recent call signature AND writes no real text**
  (`agent_loop.py:4061-4075`). The casting cascade emits **fresh narration text
  every turn** (different re-phrasings of the question) and rides across
  *separate turns* anyway, so it is wholly outside the "same call, no text"
  envelope. The runaway backstop needs 15 *identical* calls. Neither fires.

- **ADR 0011 (`docs/decisions/0011-…`).** Its fix is **beat-aware peer-advance
  detection** for the **CONCURRENT two-tab** case — it teaches the *advance*
  cascade to tell "I failed to advance" from "a *peer* advanced" via the
  `(week, phase, moment)` beat key (`_peer_advanced_since_framing`,
  `agent_loop.py:1544`). It is scoped to live-play progression and to a *peer*
  writer. It does **not** touch the **single-session casting** cascade at all
  (`game_mode == "casting"` is a different branch, `agent_loop.py:3987`), and
  there is no peer here. **ADR 0011 explicitly defers the general bound** — its
  *Open / to confirm* §1: *"A guardrail-cascade total cap / loop-breaker
  enhancement (follow-up) … a general per-turn cap on total guardrail
  re-prompts … not forced here (roadmap R3)."* That deferred item is exactly
  this bug, generalized.

### 1.4 "It loops for EVERYTHING" — same mechanism, generalized (assessed)

**Plausible and structurally confirmed.** The casting cascade is one instance of
a *family* of per-user, persisted, lull-gated nudge cascades that all share the
same shape — "the model under-calls a terminal tool, so re-prompt every lull
turn until it calls it":

| Cascade | Counter | Terminus | Terminus gated on |
|---|---|---|---|
| Casting finalize | `_CASTING_STALL_LEVEL` (`:1487`) | forced `do_create_character` (`:4024-4035`) | `_finalizable` — **can stall open** |
| Live advance | `_ADVANCE_STALL_LEVEL` (`:2334`) / `_TURNS_SINCE_PROGRESS` (`:2338`) | L39b forced `advanceGame` (`:1470`, fired `~:3814`) | a *progressable* beat / no pending player decision |
| Blank-turn guard | `_turn_narrate_nudges` (`:3976`) | capped at 1/turn | self-limited |
| Re-approach / postseason off-topic | `_REAPPROACH_LEVEL` / `_POSTSEASON_OFFTOPIC_TURNS` (`:3797-3798`) | varies | varies |

The live `advanceGame` cascade has a real terminus (L39b forces the engine lever
the model skipped). But its terminus is *also* conditional — it will not force
when a **player decision is pending** or the beat is not independently
progressable. In any state where the terminal tool's precondition is never
satisfied while the lull/ready gate stays true, the **same indefinite re-prompt**
appears in live play too. So the operator's "loops for everything" is the
**generalized signature of a conditional-terminus nudge cascade with no
unconditional per-session bound** — casting is just the most reliably-reproduced
instance (a name-only intake pins `ready && !finalizable` forever).

**Caveat / not-yet-proven:** the bundle only captures the casting instance
directly. The live-play generalization is inferred from the shared mechanism, not
from a second captured trace. The recommended fix (§3.1) is mechanism-level, so it
hardens all of them at once regardless.

---

## Question 2 — The background-authoring reasoning burn

### 2.1 What fires the 15+ `background-authoring` calls

They are the **deep-profile cast authoring fan-out**, not a loop:

- `orwell_cast_authoring.run_authoring` runs **one LLM call per NPC**, fanned out
  with `asyncio.gather(*[_author_one(npc) for npc in cast])`
  (`frontend/src/orwell_cast_authoring.py:247`). 15 NPCs ⇒ ~15 calls — exactly the
  bundle's count. Each call is tagged `call_class="background-authoring"` and
  emits one token-ledger line (`orwell_cast_authoring.py:319-324`).
- It is kicked by the **cast pre-warm** the instant a model is selectable at
  casting open: `POST /api/orwell/prewarm-cast`
  (`frontend/routes/orwell_routes.py:634-642`) → `orwell_prewarm.prewarm_cast`
  (`frontend/src/orwell_prewarm.py:122`) → `authoring.kickoff_authoring(...)`
  (`orwell_prewarm.py:174`). That is why they appear *during* casting
  (game_active=False), interleaved with round-1 narration in the bundle.
- A second, later path exists at game start: `do_create_character`
  (`frontend/src/tool_implementations.py:4724-4752`) runs the same authoring as a
  *fallback* — **only when pre-warm did NOT already run** (`prewarmed` gate,
  `tool_implementations.py:4711-4724`). So authoring runs **once per season**, not
  twice. (`orwell_tagline.py:89` is a separate, single background-authoring call —
  the season tagline — not part of the cast fan-out.)

### 2.2 Once-each, fail-soft, non-blocking — NOT a contributor to the stuck feeling

- **Once-each.** `prewarm_cast` is **idempotent per `(user, seed)`**: the
  `st.author_started and st.seed == seed` guard returns early
  (`orwell_prewarm.py:145-146`), and a new season's new seed self-resets it
  (`:147-149`). So the 15 calls are one fan-out, fired once. They are **not**
  looping and are unrelated to the Q1 turn cascade.
- **Fail-soft / non-blocking.** `kickoff_authoring` schedules a detached task
  (`loop.create_task(_runner())`, `orwell_cast_authoring.py:400`); `_resolve_llm_fn`
  returns `None` (silent no-op) when no model resolves
  (`orwell_cast_authoring.py:255-267`); every write-back is best-effort and
  swallowed. Game start never blocks on it (`tool_implementations.py:4753-4754`
  comment + `try/except pass`).
- **Conclusion:** background-authoring is **not** causing the stuck feeling. It is
  a real but separable **cost** problem: ~15 calls × ~2000 reasoning tokens each ≈
  the ~$0.07 the operator saw, burned on JSON the reasoning does not improve.

### 2.3 The reasoning is wasted spend on this call class

`background-authoring` resolves effort **"low"** today
(`frontend/src/token_policy.py:38`; `DEFAULT_SETTINGS.reasoning_budget`,
`frontend/src/settings.py:141`). On DeepSeek V4 Pro "low" still emits
~936–2964 reasoning tokens/call (bundle evidence lines 20–34) — the dominant cost
of each call. The work is **constrained JSON synthesis of an NPC profile** from
seeded facets: structured, schema-bounded authoring, the same shape as
utility-extraction, which was **already moved to "off"** for exactly this reason
(`token_policy.py:35-37` — *"the prompts forbid thinking and the 2026-06-21 I/O
trace showed it wasted"*).

The live infra to make "off" a *genuine* disable already exists and is proven:
`_apply_reasoning_budget` actively sends `reasoning: {"enabled": false}` to
OpenRouter for a reasoner when the class resolves to off
(`frontend/src/llm_core.py:610-614`; verified by
`test_adr0010_reasoning_budget.py::test_reasoning_off_is_a_genuine_disable_on_openrouter`).
The context note confirms `reasoning:{enabled:false}` → 0 reasoning tokens with
**output unaffected** for extraction/authoring-style JSON.

**Recommendation: default `background-authoring` to `"off"`.** Authoring quality on
this call class is schema-bounded JSON synthesis where chain-of-thought adds no
measurable fidelity (same class of work as utility-extraction, already off) while
~2000 reasoning tokens/call is pure burn × ~15 calls/season + the tagline call.
"off" is admin-overridable back to "low"/"medium" per-class at runtime via the
Token Economy card for anyone who wants richer authoring, so the floor is a safe,
reversible default — not a hard removal. Keep `narration` and `casting` at
`medium` (player-facing, quality-sensitive) unchanged.

> Quality hedge: if a later A/B shows authored profiles measurably thinner at
> "off", the per-class admin override makes "low" a one-setting restore — the
> change is reversible by design, so defaulting off is low-risk.

---

## Recommendations

### 3.1 Q1 — a per-session/per-phase casting-attempt bound (the missing unconditional terminus)

The clean, minimal fix that also generalizes:

1. **Bound the casting cascade unconditionally.** Add a hard per-user attempt cap
   `_CASTING_MAX_ATTEMPTS` (e.g. 6). When `_CASTING_STALL_LEVEL[owner]` exceeds it
   **and** `_finalizable` is still False, **stop nudging** and hand the turn back
   to the player with a single in-character producer line inviting one more
   substantive answer (no more "finalize NOW" re-prompts the engine can't honor).
   This removes the indefinite cascade for the `ready && !finalizable` state — the
   exact hole. It does **not** force a floater (the existing `_finalizable` gate on
   the forced finalize stays — ruling: never mint a default-archetype character).
2. **Generalize as a guardrail-cascade total cap** (ADR 0011 *Open* §1 / roadmap
   R3). A per-turn-cap is insufficient (the cascade is cross-turn); the right shape
   is a **per-session, per-cascade re-prompt budget** that suppresses *any* nudge
   family (casting, advance, re-approach) once it has fired N times for the same
   unmoved beat/phase without its terminus arming — independent of `_stuck_rounds`'s
   "same call, no text" condition. This is the systemic hardening the operator's
   "loops for everything" actually needs; casting's bound (1) is the urgent subset.

Both are FE-only, mirror the existing `_ADVANCE_STALL_LEVEL` machinery, and leave
the model-driven terminus first (model-driven `createCharacter`/`advanceGame`
still short-circuits — `agent_loop.py:3993-3994`).

> Note: audit "A"'s forced-finalize (the L39b-style `do_create_character`) is the
> right terminus **when `_finalizable` is true**. It does **not** cover the
> `ready && !finalizable` state — that is the residual hole this bound closes.

### 3.2 Q2 — default background-authoring reasoning to "off"

Two source edits, both pure-default changes (admin override path unchanged):

- `frontend/src/token_policy.py:38` — `_DEFAULT_EFFORT["background-authoring"]`:
  `"low"` → `"off"`.
- `frontend/src/settings.py:141` — `DEFAULT_SETTINGS["reasoning_budget"]
  ["background-authoring"]`: `"low"` → `"off"`.

No call-site change is needed: `orwell_cast_authoring._resolve_llm_fn` already
threads the resolved policy (`orwell_cast_authoring.py:275`), and
`_apply_reasoning_budget` already turns `reasoning is None` into
`reasoning:{enabled:false}` for OpenRouter (`llm_core.py:610-614`).

Existing tests that MUST be updated in lockstep (they pin the old "low" default):
- `frontend/tests/test_adr0010_token_policy.py:48-51`
  (`test_background_authoring_defaults_low_effort`) → assert `reasoning is None`.
- `frontend/tests/test_adr0010_settings_ui.py:58-61`
  (`test_keys_present_in_default_settings`) → `"background-authoring": "off"`.

---

## Test specs (≥2 per recommendation)

### For 3.1 — casting-cascade terminus (file: `frontend/tests/test_casting_loop_terminus.py`, new)

**T1 — `ready && !finalizable` stops nudging after the attempt cap.**
Drive the casting finish-block (`game_mode="casting"`, owner set, a lull player
message) repeatedly with an engine casting state stub `{ready:True,
finalizable:False, started:False}`. Assert: `_CASTING_STALL_LEVEL[owner]` rises to
`_CASTING_MAX_ATTEMPTS`, the `casting finalize nudge` is emitted on early turns,
and once the cap is exceeded **no further finalize nudge is appended** and the turn
ends (a `break`, no `agent_step`/`continue`). Assert `do_create_character` is
**never** called (no floater minted). Roles only.

**T2 — `finalizable` still finalizes before/under the cap (no regression).**
Same harness with `{ready:True, finalizable:True}` and either `_clv >=
_CASTING_FORCE_LEVEL` or an explicit-ready player line. Assert `do_create_character`
**is** called and `_CASTING_STALL_LEVEL[owner]` is cleared
(`agent_loop.py:4030`) — the genuine terminus is unaffected by the new cap.

**T3 — single-turn / non-casting byte-identity.** With `game_mode="game"` (not
casting) the new casting cap is inert: drive one live turn and assert the casting
counter is untouched and the existing advance cascade behaves identically (guards
the new bound is casting-scoped, not a global behavior change).

**T4 (generalization, if 3.1.2 is taken) — cascade total cap suppresses a stalled
family.** Simulate a live beat that never becomes progressable (engine returns the
same unmoved `(week, phase, moment)` with a pending the force won't auto-resolve)
across > N lull turns; assert the advance nudge stops re-firing after the
per-session re-prompt budget is spent, while a turn that *does* move the beat resets
the budget (proves it bounds only genuine stalls).

### For 3.2 — background-authoring "off" default

**T5 — token policy default flips to off** (extend
`frontend/tests/test_adr0010_token_policy.py`, replacing
`test_background_authoring_defaults_low_effort`):
```python
def test_background_authoring_defaults_off_effort():
    pol = resolve_token_policy("background-authoring")
    assert pol["reasoning"] is None          # off ⇒ reasoning omitted/disabled
    assert pol["max_tokens"] == 1200         # output cap unchanged
```

**T6 — settings default flips to off** (update
`frontend/tests/test_adr0010_settings_ui.py::test_keys_present_in_default_settings`):
assert `DEFAULT_SETTINGS["reasoning_budget"]["background-authoring"] == "off"`
(and the other three classes unchanged: narration/casting `"medium"`,
utility-extraction `"off"`).

**T7 — the off default reaches the wire as a genuine disable for authoring.**
Resolve `background-authoring` against `DEFAULT_SETTINGS` and feed the policy
through the `_apply_reasoning_budget` / `stream_llm` capture harness already in
`test_adr0010_reasoning_budget.py`; assert the OpenRouter payload carries
`reasoning == {"enabled": False}` (proves the default actually zeroes reasoning
tokens end-to-end, not just in the resolver).

**T8 — admin override still restores reasoning** (regression guard for the
reversibility hedge): `resolve_token_policy("background-authoring",
{"reasoning_budget": {"background-authoring": "low"}})["reasoning"] ==
{"effort": "low"}` — the floor is a default, not a removal.

---

## File:line index

- Per-turn cap: `frontend/src/agent_tools.py:25`; `frontend/src/agent_loop.py:2582, 3066, 4444-4456`.
- Casting cascade (the hole): `frontend/src/agent_loop.py:1487-1500` (constants),
  `3987-4048` (finish-block), terminus gate `4013`/`4024`, text saturation `4041`,
  clear `4030`/`4047`.
- Live-advance cascade (sibling family): `frontend/src/agent_loop.py:2334, 2338,
  1470-1475, 3600-3619, 3814-3851`; L39b forced advance fired `~3814`.
- ADR 0011 scope + deferred general cap: `docs/decisions/0011-…md` (Decision §1;
  Open §1); peer-advance helper `frontend/src/agent_loop.py:1544`.
- Background-authoring fan-out: `frontend/src/orwell_cast_authoring.py:247, 319-324`;
  policy resolve `255-275`; non-blocking kickoff `373-400`.
- Pre-warm trigger + idempotency: `frontend/routes/orwell_routes.py:634-642`;
  `frontend/src/orwell_prewarm.py:122-175` (idempotency `145-149`).
- Start-time fallback authoring (guarded by pre-warm): `frontend/src/tool_implementations.py:4711-4762`.
- Effort defaults to change: `frontend/src/token_policy.py:38`;
  `frontend/src/settings.py:141`.
- "off" → genuine disable infra: `frontend/src/llm_core.py:585-614`.
- Tests to update: `frontend/tests/test_adr0010_token_policy.py:48-51`;
  `frontend/tests/test_adr0010_settings_ui.py:58-61`.
