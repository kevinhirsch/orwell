# 2026-06-21 — Casting-interview agentic loop: the forced-finalize that can never fire

**Lane A — casting finalize.** READ-ONLY diagnosis of the prod loop in
`docs/audits/2026-06-21-casting-loop-evidence.md` (bundle `…-bundle.json`, prod v4.95). Game
`phase=setup` (CASTING). The model loops the same name-acknowledgment ("Kevin." → "Kevin. Alright."
→ "Kevin. Alright. Works.") across rounds 1→6 and into fresh turns; the FE escalates
`casting finalize nudge L0 → L4`; the model calls `updateCasting` once (round 3) but **never**
`createCharacter`. Casting never completes.

All citations are against current `main`. (The bundle is v4.95; the prod build differs slightly —
e.g. the `auto-recorded casting fields=['playerName']` log line is not on `main` — but the
control flow that produces the loop is the same on `main`, cited below.)

---

## 1. The finalize-nudge ladder (where it lives, what each rung does)

The casting branch of the streaming agent loop:
`frontend/src/agent_loop.py:3987` (`elif game_mode == "casting":`) → the finalize fallback,
`agent_loop.py:3988-4047`.

Constants — `agent_loop.py:1487-1500`:

- `_CASTING_NUDGES` (`agent_loop.py:1488-1495`): **two** text rungs.
  - **L0** (`1489-1492`): *"Casting is COMPLETE — every required answer is on file and the player
    just signalled they're ready. … your very next action is the createCharacter function call …"*
  - **L1** (`1493-1494`): *"STOP interviewing. The player is ready and casting is on file … Call
    createCharacter NOW — nothing else."*
- `_CASTING_FORCE_LEVEL = len(_CASTING_NUDGES)` = **2** (`agent_loop.py:1496`) — the level *past
  the last text rung* at which the FE itself forces the finalize.
- `_CASTING_FORCED_NOTE` (`1497-1500`): the post-force in-character note ("casting finalized, read
  the card, walk them in").
- `_CASTING_STALL_LEVEL: Dict[str,int]` (`agent_loop.py:1487`): the per-user persisted rung counter.

The escalation, per player turn that reaches the casting branch — `agent_loop.py:3999-4047`:

1. Guard the turn (`3999-4000`): only proceed if the model did **not** call `createCharacter`
   this turn (`_created_this_turn`, `3993-3994`), the turn was **not** cancelled
   (`_turn_was_cancelled = not _emitted_visible`, `3998`), and the player's last message reads as a
   **lull** (`_player_turn_is_lull(messages)`, `4000`; def at `agent_loop.py:1528-1541`).
2. Read engine casting state (`4001-4009`): `_ready = casting.ready and not started`.
3. Read **`_finalizable = bool(_casting and _casting.get("finalizable"))`** (`agent_loop.py:4013`).
4. `if _ready:` (`4021`) → bump the rung (`_clv`, `4022-4023`), then:
   - **The forced terminal** (`4024`):
     `if _finalizable and (_clv >= _CASTING_FORCE_LEVEL or _explicit_ready):` →
     call `do_create_character("{}", owner)` (`4026-4027`); on success clear the rung, append
     `_CASTING_FORCED_NOTE`, `continue` (`4028-4035`).
   - Otherwise (`4041-4045`): emit `_CASTING_NUDGES[min(_clv, …)]`, log
     `casting finalize nudge (L{_clv})`, `continue`.
5. `elif owner is not None:` (`4046-4047`) → not ready / not asking ⇒ reset the rung.

Note the rung counter `_clv` keeps incrementing past `len(_CASTING_NUDGES)` and the nudge text
clamps at the last rung (`min(_clv, len-1)`) — that is why the log shows **L2, L3, L4** even though
only two nudge strings exist. Each of those was a *nudge*, never a force.

## 2. The `createCharacter` finalize fallback — its exact precondition, and why it never fired

The fallback is the forced terminal at `agent_loop.py:4024`. Its precondition is
**double-gated**:

```
_finalizable AND (_clv >= _CASTING_FORCE_LEVEL  OR  _explicit_ready)
```

- `_explicit_ready` (`agent_loop.py:4020`) = the player message matched `_LULL_READY_RE`
  (`agent_loop.py:1506-1512` — "I'm ready", "let's go", "put me in", …).
- The **hard outer gate** is `_finalizable` (`agent_loop.py:4013`), read straight off the engine's
  casting view.

**What `finalizable` requires** (engine truth) — `src/engine/castingIntake.ts:193-198`,
`castingFinalizable()`:

- `CASTING_FINALIZE_FLOOR` (`castingIntake.ts:175-179`): **`playerName` AND `backstory` AND
  `motivation`** must all be captured, **AND**
- `CASTING_FINALIZE_ANY_OF` (`castingIntake.ts:182-186`): **at least one** of
  `personaArchetype` / `personaStrategyStyle` / `privateStrategy`.
- `castPhoto` does **not** count (`castingIntake.ts:173`).

`ready` is a *much* weaker gate — just a name: `castingStatusOf` sets
`ready: captured(intake, "playerName")` (`castingIntake.ts:156`). The engine deliberately splits
the two: `ready` (name-only) permits an *explicit, model-driven* finalize, but the **automated
forced finalize must require `finalizable`** so it never mints the default-archetype "floater with
no stats" (`castingIntake.ts:168-173`).

**Why it didn't fire in the trace:** only `playerName` was ever captured
(`auto-recorded casting fields=['playerName']`, evidence lines 39/44/48; the lone `updateCasting`
at round 3 added nothing that reached `finalizable`). So **`ready=True`, `finalizable=False`** for
the entire loop. The `_ready` branch (`4021`) ran every lull turn — incrementing the rung and
emitting a nudge — but the forced terminal at `4024` was held off by `_finalizable=False` on every
single iteration, **including** at L2/L3/L4 where `_clv >= _CASTING_FORCE_LEVEL` was already true.
The nudge ladder topped out and looped; the force was structurally unreachable.

The engine independently refuses the same shape even if the FE *did* call it: `createCharacter`
with an empty-args, name-only intake returns `{ …view, createRefused: "casting-incomplete" }`
(`src/adapters/engine/GameSessionAdapter.ts:2032-2045`) — the same `finalizable` logic mirrored as
a server-side backstop. So forcing on a non-finalizable intake would be a no-op anyway. **Forcing
is not the missing piece — getting to `finalizable` is.**

## 3. Compare to the advance loop (the working analog) — the real asymmetry

The advance loop's forced terminal **L39b** is at `agent_loop.py:3877-3917`:
`if _level >= _ADVANCE_FORCE_LEVEL …:` → re-read the beat (double-advance guard, `3895-3910`) →
`_commit_advance_silently("forced stall L…")` (`3911`) → append `_FORCED_ADVANCE_NUDGE`,
`continue`. The key: `advanceGame` is **always a legal terminal** — the engine can *always* take
the next beat. So once the rungs exhaust, the FE pulls the lever and the loop ends, every time.

The casting loop **does** have a structurally-equivalent forced terminal (`4024-4035`) — so the
asymmetry is **not** "nudge-only vs. forced." The asymmetry is the **precondition**:

| | advance | casting |
|---|---|---|
| forced terminal exists | yes (`3885`) | yes (`4024`) |
| terminal action always legal? | **yes** — `advanceGame` always advances | **no** — `createCharacter` is refused unless `finalizable` |
| what blocks the terminal | nothing structural (beat-moved guard only) | **`_finalizable`**, which a looping model never satisfies |

So the advance loop's terminal is a true escape hatch; the casting loop's terminal is gated behind
a condition (`finalizable`) that the **very failure mode it's meant to break** (a model that won't
do the interview) prevents from ever becoming true. The forced finalize is *correctly* withheld —
you must not mint a floater — but **nothing else fires to break the loop**, so the model thrashes
on the same name acknowledgment forever.

There is a second, contributing defect: the nudge text itself is **false** when only a name is on
file. L0 asserts *"Casting is COMPLETE — every required answer is on file"* (`1489-1490`) and L1
*"casting is on file … Call createCharacter NOW"* (`1493-1494`). With `finalizable=False` the model
is being ordered to finalize an interview that genuinely isn't done; the engine can't, so the model
has no coherent action and falls back to re-acknowledging the name. The nudge is steering **toward**
the wrong terminal instead of toward the missing interview substance.

## 4. The engine readiness truth (what the FE sees, what's missing)

The FE reads casting state from `get_game_state` → the pre-game view
(`GameSessionAdapter.ts:4226-4235`): `casting: castingStatusOf(this.intake)`. That view carries
(`castingIntake.ts:138-161`): `known` (captured fields), `missing` (engine-ordered coverage still
to get), `next` (the next ask), `ready` (name on file), `finalizable` (the §2 gate).

The casting **moment prompt** the model is framed with already surfaces this honestly —
`renderGameContext` (`src/engine/momentPrompts.ts:650-675`) emits `CASTING STATUS — already on
file`, `NEXT STEP: <ask>`, and `READY/NOT READY`. The interview operating manual
(`momentPrompts.ts:351-438`) tells the model to record `backstory`/`motivation`/persona and to
"follow the CASTING STATUS, not your own memory." So the model *has* the information that the
interview is incomplete — it is simply not acting on it, and the FE's nudge ladder is actively
**contradicting** the engine status by telling it casting is complete.

The headshot is **not** the blocker: `castPhoto` is optional and explicitly excluded from
`finalizable` (`castingIntake.ts:173`); the framing even tells the model the photo is on file
(`CASTING_HEADSHOT_ON_FILE_NOTE`, `frontend/routes/chat_helpers.py:124-129, 1520-1530`). The single
missing thing is **interview substance** (`backstory` + `motivation` + one persona/strategy field).

**Latent shape bug (secondary, fix while here):** the forced-finalize success check at
`agent_loop.py:4028-4029` tests `_cres.get("createRefused")`, but `do_create_character` returns
`{"output": json.dumps(res), "exit_code": 0}` on success / `{"error": …}` on failure
(`frontend/src/tool_implementations.py:4765-4767`) — the engine's `createRefused` is **buried
inside the serialized `output` string**, never a top-level key. So a `createRefused:
"casting-incomplete"` response would currently be read as *success* (it has no top-level `error`
and no top-level `createRefused`), the rung would be cleared, and the loop would silently believe it
finalized while the season never started. This is masked today only because `_finalizable` keeps
the call from ever running; the fix in §5 makes the call reachable, so this check must be corrected
too.

---

## Root cause (one paragraph)

The casting loop never terminates because its forced-finalize terminal
(`agent_loop.py:4024`) is gated on the engine's `finalizable` flag, which requires a *genuine*
interview (name **+ backstory + motivation + a persona/strategy answer**;
`castingIntake.ts:175-198`) — but the failure mode itself is a model that won't conduct the
interview, capturing only `playerName`. With `ready=True` / `finalizable=False`, the `_ready`
branch fires every lull turn and only ever **nudges** (the force is unreachable), and the nudge
text falsely tells the model casting is *complete* and to finalize — an action the engine
correctly refuses (`createRefused: "casting-incomplete"`, `GameSessionAdapter.ts:2043-2044`) — so
the model, with no coherent legal action, re-acknowledges the name and loops. Unlike the advance
loop, whose forced terminal (`advanceGame`, L39b, `agent_loop.py:3885-3917`) is *always* a legal
action and so always breaks the stall, the casting terminal's action is conditionally illegal and
the loop has no escape that drives toward the missing interview substance.

---

## The fix (concrete, minimal)

Two changes, both in `frontend/src/agent_loop.py`, plus a one-line correctness fix.

### Fix A (primary) — a *substance* nudge ladder for `ready && !finalizable`

When casting is `ready` but **not** `finalizable`, the loop must stop ordering a finalize the
engine will refuse and instead **drive the model to ASK the missing questions** (then it can
record them and become finalizable on its own — the normal path). This is the casting analog of the
advance loop's "narrate the real next beat" nudge: error-correct the *omission* (the un-asked
interview), never engine-author content.

**Where:** `agent_loop.py`, the `if _ready:` block, `4021-4047`. Split the branch on
`_finalizable`:

- **`_ready and _finalizable`** → keep the existing nudge-then-force ladder unchanged
  (`_CASTING_NUDGES` + the `4024` force). This path is already correct.
- **`_ready and not _finalizable`** → a **new, separate ladder** that names the engine's
  `missing` / `next` coverage and tells the model to *ask and record it*. It must **not** order a
  finalize (the engine would refuse) and must **not** force `createCharacter`. Pull the concrete
  gap from the casting view already in hand (`_casting.get("missing")` / `_casting.get("next")`,
  `castingIntake.ts:148-149`) so the nudge is specific ("you still need their backstory — ask, then
  record it with updateCasting"). Use its own per-user counter so the two ladders don't share a
  rung, and reset both on a true finalize / a not-ready turn.

This keeps the loop **moving toward `finalizable`** every lull turn instead of dead-ending on an
impossible finalize. Once the model records `backstory` + `motivation` + a persona field, the view
flips to `finalizable=True`, the **existing** force terminal becomes reachable, and the L39b-style
escape hatch works as designed.

**Insertion point (precise):** replace the body of `if _ready:` at `agent_loop.py:4021` with a
`finalizable`-split:

```python
if _ready and _finalizable:
    # (existing nudge-then-force ladder — unchanged: _CASTING_STALL_LEVEL + the 4024 force)
    ...
elif _ready:  # ready (name on file) but the interview is NOT finalizable yet
    _slv = _CASTING_SUBSTANCE_LEVEL.get(owner, 0)
    _CASTING_SUBSTANCE_LEVEL[owner] = _slv + 1
    _gap = (_casting.get("next") or "")            # engine's next ask
    _missing = _casting.get("missing") or []       # remaining coverage (ordered)
    messages.append({"role": "system", "content": _casting_substance_nudge(_gap, _missing)})
    logger.info(f"[orwell] casting substance nudge (L{_slv}, missing={_missing}) "
                f"round {round_num} user={owner}")
    yield f'data: {json.dumps({"type": "agent_step", "round": round_num + 1})}\n\n'
    continue
elif owner is not None:
    _CASTING_STALL_LEVEL.pop(owner, None)
    _CASTING_SUBSTANCE_LEVEL.pop(owner, None)  # reset BOTH ladders when not ready/asking
```

New module-level constants near `agent_loop.py:1487`:

```python
_CASTING_SUBSTANCE_LEVEL: Dict[str, int] = {}

def _casting_substance_nudge(next_ask: str, missing: list) -> str:
    """Production note: the interview is NOT done (name only). Steer the model to the missing
    coverage and tell it to RECORD what lands — never to finalize (the engine refuses an empty
    interview). Names the engine's own next ask; no fabricated content."""
    gap = next_ask.strip() or "the rest of who they are and how they'll play"
    return ("(Production note, not for the player.) Casting is NOT finished — only their name is on "
            "file. Do NOT call createCharacter yet; the season cannot start until you've actually "
            "interviewed them. Your next move is to ASK the next thing on the producer's sheet: "
            f"{gap}. When they answer, file it immediately with updateCasting. Keep the interview "
            "moving — backstory, why they came, how they plan to play — until casting is complete.")
```

**Precondition guard (the rule):** the new ladder fires **only** when the engine says `ready` and
**not** `finalizable` — i.e. it never fabricates content and never forces a tool; it only re-prompts
the model toward the engine's own declared `missing` coverage. The existing forced
`createCharacter` stays gated on `finalizable` (never mints a floater), exactly as today. This
mirrors the existing patterns: it is the casting analog of the L39b *re-prompt* rungs (it nudges
toward the legal action), and the force half is the analog of the L39b *force* (legal only when the
engine says the action is available — here `finalizable`, there beat-not-moved).

### Fix B (correctness, do while here) — read `createRefused` off the engine result, not the wrapper

At `agent_loop.py:4028-4029`, the success test must inspect the **engine** result, not the FE
wrapper. `do_create_character` JSON-serializes the engine view into `output`
(`tool_implementations.py:4765`). Parse it (or have the forced path call
`orwell_engine.create_character(None, user=owner)` directly and check `res.get("createRefused")` /
`res.get("started")`). Concretely, the guard should treat the finalize as successful **only** when
the engine result has `started: True` and no `createRefused`; on `createRefused:
"casting-incomplete"` it must fall through to a nudge (and, post-Fix-A, to the substance ladder),
**never** clear the rung. This is latent today (the call is unreachable) but becomes live the moment
the substance path lets a genuinely-finalizable intake reach the force.

> Net behavior after the fix: a name-only stall **drives the interview forward** (substance ladder)
> instead of looping an impossible finalize; once the interview is genuinely complete the **existing**
> forced-finalize terminal fires and ends casting — restoring the advance-loop symmetry (a forced
> terminal that fires when, and only when, its action is legal).

---

## Test specs (≥3)

**Closest existing harness to copy:** `frontend/tests/test_fs4d_truncation.py` — it drives the
**real** `stream_agent_loop` with a `fake_stream` (a fake LLM that yields canned SSE deltas, ending
without ever calling the finalize tool) and asserts the parsed SSE events / observed engine calls
(`_drive_agent_loop`, lines 32-68). Mirror its structure exactly. Stub the engine seam the casting
branch reads — `orwell_engine.get_game_state` (returns the `{started:False, casting:{…}}` view) —
and patch `src.tool_implementations.do_create_character` to a spy so the test can assert whether the
forced finalize was called. The constants-present check already lives in
`test_premiere_and_casting_finalize.py:140-145` (extend it for the new substance ladder).
Roles only — use a non-name token like `"P"` / `"the player"` for `playerName`; never a game-entity
name.

Shared scaffolding (one fake LLM that **refuses to finalize** — it only ever narrates, never emits a
`createCharacter` tool call, like the v4-pro loop in the trace):

```python
def _drive_casting_loop(monkeypatch, *, casting_view, finalize_spy):
    """Drive the REAL stream_agent_loop in casting mode with a model that NEVER finalizes.
    `casting_view` is the engine's pre-game casting status dict. Returns parsed SSE events."""
    from src import agent_loop as al
    monkeypatch.setattr(al, "_player_turn_is_lull", lambda messages: True)  # force the lull branch
    import src.orwell_engine as oe
    async def fake_state(user=None):
        return {"started": False, "moment": "character-creation", "casting": casting_view}
    monkeypatch.setattr(oe, "get_game_state", fake_state)
    import src.tool_implementations as ti
    monkeypatch.setattr(ti, "do_create_character", finalize_spy)
    # a model that ONLY narrates the name acknowledgment, several rounds, NEVER a tool call:
    async def fake_stream(candidates, messages, **kwargs):
        yield 'data: {"delta": "\\"Kevin.\\" *She lets it hang a beat.*"}\n\n'
        yield "data: [DONE]\n\n"
    monkeypatch.setattr(al, "stream_llm_with_fallback", fake_stream)
    # ... run al.stream_agent_loop(..., game_mode="casting") to exhaustion, collect SSE events ...
```

### (a) After the rungs exhaust with the model never finalizing, the FE forces `createCharacter` — **only when finalizable**

```python
def test_casting_force_finalize_fires_when_finalizable_and_model_never_calls_it(monkeypatch):
    calls = []
    async def spy(content, owner=None):
        calls.append(content)
        return {"output": json.dumps({"started": True}), "exit_code": 0}
    finalizable_view = {"ready": True, "finalizable": True,
                        "known": {"playerName": "P", "backstory": "...", "motivation": "...",
                                  "personaArchetype": "..."},
                        "missing": [], "next": None}
    # Drive the loop across enough lull turns that _clv reaches _CASTING_FORCE_LEVEL.
    _drive_casting_loop(monkeypatch, casting_view=finalizable_view, finalize_spy=spy)
    assert calls, ("once casting is engine-`finalizable` and the model has been nudged through the "
                   "rungs without finalizing, the FE must force createCharacter itself.")
```

(Pin the rung exhaustion by seeding `agent_loop._CASTING_STALL_LEVEL[owner] =
agent_loop._CASTING_FORCE_LEVEL` before the drive, the way the advance tests pre-seed
`_ADVANCE_STALL_LEVEL`; or run `_CASTING_FORCE_LEVEL + 1` lull turns.)

### (b) It does **NOT** force when casting is not engine-`finalizable` (name only) — and drives the interview instead

```python
def test_casting_does_not_force_when_not_finalizable_and_emits_substance_nudge(monkeypatch):
    calls = []
    async def spy(content, owner=None):
        calls.append(content)
        return {"output": json.dumps({"started": True}), "exit_code": 0}
    name_only_view = {"ready": True, "finalizable": False,
                      "known": {"playerName": "P"},
                      "missing": ["backstory", "motivation"], "next": "their life outside the house"}
    events = _drive_casting_loop(monkeypatch, casting_view=name_only_view, finalize_spy=spy)
    assert not calls, ("a name-only (ready, NOT finalizable) intake must NEVER force createCharacter "
                       "— that would mint a floater / be refused by the engine.")
    # and the loop must STEER toward the missing interview substance, not order a finalize:
    sysmsgs = _captured_system_messages(monkeypatch)  # collect messages.append(role=system) bodies
    assert any("updateCasting" in m and "createCharacter" not in m.split("Do NOT call")[-1]
               for m in sysmsgs), "the substance ladder must push the missing questions, not a finalize"
    assert any("backstory" in m or "their life outside" in m for m in sysmsgs)
```

(Assert on the injected system-prompt rungs — capture `messages.append(...)` bodies, e.g. by
wrapping the messages list or asserting on the `_casting_substance_nudge` output. The hard assertion
is `not calls`: **no forced finalize on a non-finalizable intake**, the exact prod condition.)

### (c) A model that DOES finalize on its own is unaffected — no double-finalize

```python
def test_model_self_finalize_is_not_double_forced(monkeypatch):
    calls = []
    async def spy(content, owner=None):
        calls.append(content)
        return {"output": json.dumps({"started": True}), "exit_code": 0}
    finalizable_view = {"ready": True, "finalizable": True, "known": {...}, "missing": [], "next": None}
    # fake_stream this time EMITS a createCharacter tool call (the model finalizes itself):
    async def model_finalizes(candidates, messages, **kwargs):
        yield 'data: ' + json.dumps({"native_tool_call": {"name": "createCharacter", "arguments": "{}"}}) + '\n\n'
        yield "data: [DONE]\n\n"
    # ... drive with model_finalizes; the loop sets _created_this_turn=True (agent_loop.py:3993-3994) ...
    assert calls == [], ("when the model calls createCharacter itself, _created_this_turn short-circuits "
                         "the fallback (agent_loop.py:3999) — the FE must NOT force a second finalize.")
```

(The guard under test is `_created_this_turn` at `agent_loop.py:3993-3994, 3999`: a turn that itself
called `createCharacter` never enters the fallback. Model-driven recording always takes precedence —
the same invariant as `_auto_record_scene` / the L39b advance force.)

### (d) Bonus — constants wiring (extend `test_premiere_and_casting_finalize.py:140`)

```python
def test_casting_substance_ladder_constants_present():
    assert isinstance(agent_loop._CASTING_SUBSTANCE_LEVEL, dict)
    n = agent_loop._casting_substance_nudge("their backstory", ["backstory", "motivation"])
    assert "updateCasting" in n and "createCharacter" in n  # tells it NOT to finalize, TO record
    assert "Do NOT call createCharacter" in n
```

---

## Files cited

- `frontend/src/agent_loop.py:1487-1541` (constants, lull), `:3570-3629` (advance gating context),
  `:3877-3917` (L39b forced advance — the working analog), `:3987-4047` (the casting branch).
- `frontend/routes/chat_helpers.py:109-129` (pre-game / headshot framing), `:1335-1541`
  (`apply_game_framing`, casting branch `:1504-1540`).
- `frontend/src/tool_implementations.py:4619-4767` (`do_create_character`),
  `:4770-…` (`do_update_casting`).
- `src/engine/castingIntake.ts:138-198` (`castingStatusOf`, `finalizable`, the floor/any-of).
- `src/engine/momentPrompts.ts:351-438` (casting operating manual), `:650-675`
  (`renderGameContext` → CASTING STATUS / NEXT STEP / READY).
- `src/adapters/engine/GameSessionAdapter.ts:2010-2045` (`createCharacter` refusal backstop),
  `:3952-3961` (`getMomentPrompt`), `:4226-4235` (pre-game view → `casting`).
- Harness to copy: `frontend/tests/test_fs4d_truncation.py:32-90`. Constants test to extend:
  `frontend/tests/test_premiere_and_casting_finalize.py:140-145`.
