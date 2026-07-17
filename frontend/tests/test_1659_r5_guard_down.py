"""R5 (#1659) — guard-down fail-closed: the faithfulness judge fails CLOSED.

The bundle's failure seam 5 (the "phantom-HOH" window): the faithfulness judge TIMED OUT on a turn
(overseer seq 51), leaving that turn UNJUDGED — and the timed-out judge call was recorded ``ok: true``
(12001 ms, empty text) on the llm-io ring, a fail-soft INSIDE the failure telemetry (a #1599
violation). R5 makes the judge fail CLOSED:

  1. a judge timeout / failure records ``ok: FALSE`` on the llm-io ring (never ``ok: true`` on an
     empty/errored judge result) — the RED-eligible ``llm_trace.record_llm_call``;
  2. the judge-down turn is RED-recorded on the overseer ring with a clear guard-down label; and
  3. the turn is DEFERRED and RE-JUDGED on the next opportunity — never shipped PERMANENTLY unjudged.

Back-compat: a normal (judge-succeeds) turn is unaffected — no guard-down record, no defer, no retro.

Name-agnostic: ROLES only (HOH, houseguest, nominee). Async helpers are driven on a PRIVATE loop.
"""

import asyncio
import json
import pathlib

from src.agent_loop import _faith_check


def _run(coro):
    """Run a coroutine on a PRIVATE loop without mutating the global event-loop policy (mirrors the
    0081 shadow-hook lane)."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _isolate_settings(monkeypatch, tmp_path):
    from src import settings as _s
    monkeypatch.setattr(_s, "SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setattr(_s, "_settings_cache", None)


def _set_mode(monkeypatch, tmp_path, mode):
    from src.settings import save_settings
    _isolate_settings(monkeypatch, tmp_path)
    monkeypatch.delenv("ORWELL_FAITHFULNESS_MODE", raising=False)
    save_settings({"faithfulness_mode": mode})


async def _fake_state(*a, **k):
    return {"week": 2, "phase": "veto", "vetoHolder": "npc:1", "evicted": 3}


async def _fake_visible(*a, **k):
    return {"knows": ["the player witnessed a veto-comp win"]}


def _patch_engine_reads(monkeypatch):
    monkeypatch.setattr("src.orwell_engine.get_game_state", _fake_state)
    monkeypatch.setattr("src.orwell_engine.get_visible_state", _fake_visible)


def _isolate_queue(monkeypatch):
    """A fresh per-owner retro queue we can inspect (auto-reverted after the test)."""
    q = {}
    monkeypatch.setattr("src.agent_loop._DEFERRED_FAITH", q)
    return q


def _capture_overseer(monkeypatch):
    logged = []
    monkeypatch.setattr("src.log_rings.record_overseer", lambda *a, **k: logged.append((a, k)))
    return logged


def _capture_llmio(monkeypatch):
    io = []
    monkeypatch.setattr("src.llm_trace.record_llm_call", lambda **k: io.append(k))
    return io


def _patch_resolve(monkeypatch, llm_fn):
    async def _resolve(owner=None, **kwargs):
        return llm_fn
    monkeypatch.setattr("src.orwell_cast_authoring._resolve_llm_fn", _resolve)


def _timeout_llm(prompt):
    # a judge whose call raises TimeoutError — the exact bundle seam (the 12s bound tripping).
    raise TimeoutError("faithfulness judge timed out")


def _error_llm(prompt):
    raise ValueError("faithfulness judge 400 empty-messages")


# ── Part 1: a judge timeout / failure records ok:FALSE on the llm-io ring ────────────────────────

def test_judge_timeout_records_ok_false_in_llmio(monkeypatch, tmp_path):
    """The EXACT bundle bug: a timed-out judge call was logged ok:true / empty. R5 records the judge's
    own failed call ok:FALSE (fail_class=timeout) on the llm-io ring — never ok:true on an errored
    judge result."""
    _set_mode(monkeypatch, tmp_path, "shadow")
    _patch_engine_reads(monkeypatch)
    _isolate_queue(monkeypatch)
    _patch_resolve(monkeypatch, _timeout_llm)
    io = _capture_llmio(monkeypatch)

    _run(_faith_check("you talk strategy with a houseguest by the pool",
                      claim_bearing=False, engaged_scene=True, owner="u1"))

    judge_io = [k for k in io if k.get("kind") == "faithfulness-judge"]
    assert len(judge_io) == 1                          # the judge's failed call is recorded on llm-io…
    assert judge_io[0]["ok"] is False                  # …ok:FALSE (never ok:true on an errored judge)…
    assert judge_io[0]["fail_class"] == "timeout"      # …classed as a timeout (the 12001ms bundle case).


def test_judge_failure_records_error_class(monkeypatch, tmp_path):
    """A non-timeout judge failure (e.g. a 400) is also recorded ok:FALSE, class ``error``."""
    _set_mode(monkeypatch, tmp_path, "shadow")
    _patch_engine_reads(monkeypatch)
    _isolate_queue(monkeypatch)
    _patch_resolve(monkeypatch, _error_llm)
    io = _capture_llmio(monkeypatch)

    _run(_faith_check("you swap reads with a houseguest in the kitchen",
                      claim_bearing=False, engaged_scene=True, owner="u1"))

    judge_io = [k for k in io if k.get("kind") == "faithfulness-judge"]
    assert len(judge_io) == 1
    assert judge_io[0]["ok"] is False and judge_io[0]["fail_class"] == "error"


# ── Part 2: the judge-down turn is RED-recorded on a #1599 recorder with a clear label ───────────

def test_judge_down_turn_is_red_recorded(monkeypatch, tmp_path):
    """A judge-down turn is a state we must SEE — RED on /admin/status via the overseer ring
    (record_overseer, a #1599-recognized RED recorder), ok=False, labeled ``faith:call-failed``."""
    _set_mode(monkeypatch, tmp_path, "shadow")
    _patch_engine_reads(monkeypatch)
    _isolate_queue(monkeypatch)
    _patch_resolve(monkeypatch, _timeout_llm)
    _capture_llmio(monkeypatch)                        # swallow the llm-io record here
    logged = _capture_overseer(monkeypatch)

    _run(_faith_check("you catch up with a houseguest on the patio",
                      claim_bearing=False, engaged_scene=True, owner="u1"))

    downs = [(a, k) for (a, k) in logged if len(a) > 1 and a[1] == "faith:call-failed"]
    assert len(downs) == 1
    assert downs[0][0][0] == "anomaly"                 # an anomaly (RED severity)…
    assert downs[0][1].get("ok") is False              # …ok=False (a guard-down is not a clean turn)…
    assert downs[0][1].get("user") == "u1"             # …scoped to the owning user (#1599 rollup).


# ── Part 3: the judge-down turn is RE-JUDGED on the next opportunity ─────────────────────────────

def test_judge_down_turn_is_deferred_then_rejudged(monkeypatch, tmp_path):
    """Turn 1 the judge is down → the turn is DEFERRED (never silently unjudged). Turn 2 (a lull) the
    judge is back → the deferred turn is RE-JUDGED and its verdict surfaced (RED on a real slip), and
    the queue drains."""
    _set_mode(monkeypatch, tmp_path, "shadow")
    _patch_engine_reads(monkeypatch)
    q = _isolate_queue(monkeypatch)
    _capture_llmio(monkeypatch)
    logged = _capture_overseer(monkeypatch)

    # turn 1 — the judge times out; the turn is queued for a retro-judge.
    _patch_resolve(monkeypatch, _timeout_llm)
    _run(_faith_check("you plot the next vote with a houseguest",
                      claim_bearing=False, engaged_scene=True, owner="u1"))
    assert len(q.get("u1", [])) == 1                   # the guard-down turn is DEFERRED, not lost

    logged.clear()
    # turn 2 — a pure LULL (no claim, no scene): the current turn is NOT judged, but the judge is back
    # and the DEFERRED turn is re-judged on this next opportunity.
    slip = json.dumps({"dimension": "board", "classification": "closed", "lever": "reframe",
                       "rationale": "the narration contradicts the board"})
    _patch_resolve(monkeypatch, lambda prompt: slip)
    _run(_faith_check("the house is quiet for a moment",
                      claim_bearing=False, engaged_scene=False, owner="u1"))

    retro = [(a, k) for (a, k) in logged if len(a) > 1 and str(a[1]).startswith("faith:retro")]
    assert len(retro) == 1
    assert retro[0][0][1] == "faith:retro:board"       # the previously-unjudged turn is now judged…
    assert retro[0][1].get("ok") is False              # …a real slip surfaces RED…
    assert not q.get("u1")                             # …and the retro queue is drained.


def test_retro_still_down_requeues(monkeypatch, tmp_path):
    """If the judge is STILL down on the next opportunity, the deferred turn is re-queued (bounded,
    never lost) and the still-down state is RED-recorded — not a silent drop."""
    _set_mode(monkeypatch, tmp_path, "shadow")
    _patch_engine_reads(monkeypatch)
    q = _isolate_queue(monkeypatch)
    _capture_llmio(monkeypatch)
    logged = _capture_overseer(monkeypatch)

    _patch_resolve(monkeypatch, _timeout_llm)
    _run(_faith_check("you compare notes with a houseguest",
                      claim_bearing=False, engaged_scene=True, owner="u1"))
    assert len(q.get("u1", [])) == 1

    logged.clear()
    # turn 2 — the judge is STILL down (a lull, so only the retro drain runs).
    _run(_faith_check("the backyard sits empty",
                      claim_bearing=False, engaged_scene=False, owner="u1"))
    still = [(a, k) for (a, k) in logged if len(a) > 1 and a[1] == "faith:retro-still-down"]
    assert len(still) == 1 and still[0][1].get("ok") is False
    assert len(q.get("u1", [])) == 1                   # re-queued, never lost


def test_retro_queue_is_bounded_and_overflow_is_red(monkeypatch, tmp_path):
    """The retro queue is bounded per owner; an overflow drop (a permanently-unjudged turn) fires a
    RED-eligible health event — never a silent drop."""
    from src.agent_loop import _faith_defer_retro, _DEFERRED_FAITH_MAX
    _isolate_queue(monkeypatch)
    logged = _capture_overseer(monkeypatch)
    for i in range(_DEFERRED_FAITH_MAX + 2):
        _faith_defer_retro("u1", f"a guard-down turn {i}", {"board": {}}, i, "in-game")
    dropped = [(a, k) for (a, k) in logged if len(a) > 1 and a[1] == "faith:retro-dropped"]
    assert dropped and all(k.get("ok") is False for (_a, k) in dropped)


# ── Back-compat: a normal (judge-succeeds) turn is unaffected ────────────────────────────────────

def test_normal_judged_turn_is_unaffected(monkeypatch, tmp_path):
    """A healthy judged turn: no guard-down llm-io record, no defer, no retro (byte-identical to the
    pre-R5 shadow path — the RED + retro engage only on a judge failure)."""
    _set_mode(monkeypatch, tmp_path, "shadow")
    _patch_engine_reads(monkeypatch)
    q = _isolate_queue(monkeypatch)
    io = _capture_llmio(monkeypatch)
    logged = _capture_overseer(monkeypatch)
    _patch_resolve(monkeypatch, lambda prompt: json.dumps(
        {"dimension": "none", "classification": "none", "lever": "none", "rationale": ""}))

    _run(_faith_check("you and a houseguest talk strategy",
                      claim_bearing=False, engaged_scene=True, owner="u1"))

    assert [k for k in io if k.get("kind") == "faithfulness-judge"] == []   # no guard-down record
    assert not q.get("u1")                                                   # nothing deferred
    assert logged == []                                                      # a clean verdict surfaces nothing


# ── Adversarial-review hardening (#1695: CodeRabbit + Greptile) ──────────────────────────────────

def test_owner_none_is_admitted_and_rejudged(monkeypatch, tmp_path):
    """#1695 finding 1 — owner=None is a SUPPORTED auth-off case (CON-1); it must ENTER the retro queue
    and get re-judged, never be silently dropped (which would leave auth-off turns permanently
    unjudged)."""
    _set_mode(monkeypatch, tmp_path, "shadow")
    _patch_engine_reads(monkeypatch)
    q = _isolate_queue(monkeypatch)
    _capture_llmio(monkeypatch)
    logged = _capture_overseer(monkeypatch)

    # turn 1 — auth-off (owner=None); the judge times out → the turn is queued under the None key.
    _patch_resolve(monkeypatch, _timeout_llm)
    _run(_faith_check("you strategize with a houseguest", claim_bearing=False,
                      engaged_scene=True, owner=None))
    assert len(q.get(None, [])) == 1                   # owner=None ADMITTED (not dropped)

    logged.clear()
    # turn 2 (a lull) — the judge is back; the auth-off deferred turn is re-judged on this opportunity.
    slip = json.dumps({"dimension": "board", "classification": "closed", "lever": "reframe",
                       "rationale": "contradicts the board"})
    _patch_resolve(monkeypatch, lambda prompt: slip)
    _run(_faith_check("the house is quiet", claim_bearing=False, engaged_scene=False, owner=None))
    retro = [(a, k) for (a, k) in logged if len(a) > 1 and str(a[1]).startswith("faith:retro")]
    assert len(retro) == 1 and retro[0][0][1] == "faith:retro:board"
    assert not q.get(None)                             # drained


def test_overflow_drop_attributes_the_dropped_beat(monkeypatch):
    """#1695 finding 2 — an overflow must report the DROPPED (oldest) turn's beat, not the
    newly-appended one, so the permanently-unjudged turn is attributed correctly."""
    from src.agent_loop import _faith_defer_retro, _DEFERRED_FAITH_MAX
    _isolate_queue(monkeypatch)
    logged = _capture_overseer(monkeypatch)
    # append MAX+1 turns with DISTINCT beats; the first (beat 0) overflows out when the last is appended.
    for i in range(_DEFERRED_FAITH_MAX + 1):
        _faith_defer_retro("u1", f"turn {i}", {"board": {}}, i, "in-game")
    dropped = [(a, k) for (a, k) in logged if len(a) > 1 and a[1] == "faith:retro-dropped"]
    assert len(dropped) == 1
    assert dropped[0][1].get("beat_before") == 0       # the OLDEST (dropped) beat, not the appended one
    assert dropped[0][1].get("ok") is False


def test_retro_still_down_records_llmio_ok_false(monkeypatch, tmp_path):
    """#1695 finding 3 — a retro judge that is STILL down must record its own failed call ok:FALSE on
    the llm-io ring (part-1 consistency), not only surface the overseer faith:retro-still-down event."""
    _set_mode(monkeypatch, tmp_path, "shadow")
    _patch_engine_reads(monkeypatch)
    q = _isolate_queue(monkeypatch)
    io = _capture_llmio(monkeypatch)
    _capture_overseer(monkeypatch)

    _patch_resolve(monkeypatch, _timeout_llm)
    _run(_faith_check("you swap intel with a houseguest", claim_bearing=False,
                      engaged_scene=True, owner="u1"))
    io.clear()
    # turn 2 (a lull) — the judge is STILL down; the retro attempt itself fails.
    _run(_faith_check("the yard is empty", claim_bearing=False, engaged_scene=False, owner="u1"))

    judge_io = [k for k in io if k.get("kind") == "faithfulness-judge"]
    assert len(judge_io) == 1                           # the retro's OWN failed call is on the llm-io ring…
    assert judge_io[0]["ok"] is False                   # …ok:FALSE…
    assert judge_io[0]["fail_class"] == "timeout"       # …classed as the retro timeout.
    assert len(q.get("u1", [])) == 1                    # and it re-queues (never lost)


def test_resolve_failure_defer_pins_emit_time_projection(monkeypatch, tmp_path):
    """#1695 finding 4 — a RESOLVE-failure defer must PIN the emit-time projection, so the retro judges
    the turn against the board that existed when it was emitted — not a rebuilt next-turn board."""
    _set_mode(monkeypatch, tmp_path, "shadow")
    q = _isolate_queue(monkeypatch)
    _capture_llmio(monkeypatch)
    _capture_overseer(monkeypatch)

    # turn 1 — engine at state A; the judge model RESOLVE raises → the turn defers with the PINNED proj A.
    async def _state_a(*a, **k):
        return {"phase": "veto", "vetoHolder": "npc:1"}

    async def _visible(*a, **k):
        return {"knows": ["a"]}
    monkeypatch.setattr("src.orwell_engine.get_game_state", _state_a)
    monkeypatch.setattr("src.orwell_engine.get_visible_state", _visible)

    async def _resolve_raise(owner=None, **k):
        raise RuntimeError("resolve boom")
    monkeypatch.setattr("src.orwell_cast_authoring._resolve_llm_fn", _resolve_raise)
    _run(_faith_check("you count the votes with a houseguest", claim_bearing=False,
                      engaged_scene=True, owner="u1"))
    assert len(q.get("u1", [])) == 1

    # turn 2 (a lull) — engine has MOVED to state B; the judge is back and captures the prompt it judges.
    async def _state_b(*a, **k):
        return {"phase": "eviction", "vetoHolder": "npc:9"}
    monkeypatch.setattr("src.orwell_engine.get_game_state", _state_b)
    captured = {}

    def _cap_llm(prompt):
        captured["prompt"] = prompt
        return json.dumps({"dimension": "none", "classification": "none", "lever": "none", "rationale": ""})

    async def _resolve_ok(owner=None, **k):
        return _cap_llm
    monkeypatch.setattr("src.orwell_cast_authoring._resolve_llm_fn", _resolve_ok)
    _run(_faith_check("the house is quiet", claim_bearing=False, engaged_scene=False, owner="u1"))

    assert "npc:1" in captured["prompt"]                # judged against the PINNED emit-time board (A)…
    assert "npc:9" not in captured["prompt"]            # …NOT the rebuilt next-turn board (B).


def test_concurrent_defer_during_drain_is_preserved(monkeypatch, tmp_path):
    """#1695 finding 5 — a turn deferred BY ANOTHER _faith_check for the same owner WHILE the drain is
    awaiting must survive: the drain MERGES its requeue with the leftover instead of clobbering it."""
    _set_mode(monkeypatch, tmp_path, "shadow")
    q = _isolate_queue(monkeypatch)
    _capture_llmio(monkeypatch)
    _capture_overseer(monkeypatch)
    from src import agent_loop

    # one guard-down turn already queued; projection None so the drain awaits _faith_build_projection
    # (the await point where a concurrent defer lands).
    q["u1"] = [{"narration": "old turn", "projection": None, "beat_before": 0, "context": "in-game"}]

    async def _proj_then_concurrent_defer(owner):
        # simulate a CONCURRENT _faith_check→_faith_defer_retro landing at this await point.
        agent_loop._faith_defer_retro("u1", "new turn during drain", {"board": {}}, 5, "in-game")
        return {"board": {}, "visible": {}}
    monkeypatch.setattr("src.agent_loop._faith_build_projection", _proj_then_concurrent_defer)

    # the retro judge is STILL down → the old entry re-queues; the concurrent one must NOT be clobbered.
    _run(agent_loop._faith_drain_retro("u1", _timeout_llm))

    narrs = {e.get("narration") for e in q.get("u1", [])}
    assert "old turn" in narrs                          # the re-queued (still-down) turn survives…
    assert "new turn during drain" in narrs             # …AND the concurrently-deferred turn is preserved.


# ── SOURCE-PIN — the loop wires the R5 guard-down machinery ──────────────────────────────────────

_AGENT_LOOP_SRC = pathlib.Path(__file__).resolve().parents[1] / "src" / "agent_loop.py"


def test_source_pin_r5_wiring():
    src = _AGENT_LOOP_SRC.read_text()
    assert "_faith_record_judge_down_io" in src        # part 1: ok:false llm-io record on judge-down
    assert 'kind="faithfulness-judge"' in src          # …labeled as the judge on the llm-io ring
    assert "_faith_defer_retro" in src                 # part 3: defer the guard-down turn
    assert "_faith_drain_retro" in src                 # part 3: re-judge on the next opportunity
    assert "_faith_record_retro_dropped" in src        # shared drop recorder (dropped-beat attribution)
