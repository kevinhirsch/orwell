"""LANE A (RC1+RC2+RC7) — the overseer-active realignment + at-least-once progression net.

The captured game-breaker: ONE un-retried `StaleBeatError` on `advanceGame` detached the narrator,
which then fabricated an entire HOH competition, a winner, and a player expulsion with `toolsCalled:[]`
while the engine sat in `phase:premiere` the whole session. These gates pin the closers:

  S1a — the FE progression path RE-FIRES a stale-409'd advance ONCE (fresh CAS token, SAME idempotency
        key ⇒ at-most-once preserved, at-least-once gained); a SECOND 409 records RED + arms the S1b
        forced-advance escalation.
  S1b — the lull-independent forced-advance escalation: armed by chat_helpers, forced on the wire by
        the agent loop. Pure flag mechanics + source-pin.
  S1c — a stall nudge that never converts to progression is RED-eligible (the success-gated belt
        telemetry made 12 unconverted nudges invisible). Source-pin.
  S2b — a faithfulness judge that could not run must FAIL CLOSED on a closed-set outcome draft (the
        msg53 'Jasmine wins Head of Household!' hole — the judge timed out and nothing intercepted it).

Roles only; the engine client is faked so we capture the exact kwargs the FE passes.
"""
import asyncio
import importlib
import os

import pytest

al = importlib.import_module("src.agent_loop")
chat_helpers = importlib.import_module("routes.chat_helpers")
orwell_engine = importlib.import_module("src.orwell_engine")
log_rings = importlib.import_module("src.log_rings")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(autouse=True)
def _clean_state():
    chat_helpers._LAST_BEAT_SEQ.clear()
    chat_helpers._LAST_BEAT_SIG.clear()
    chat_helpers._DESYNC_REGROUND.clear()
    chat_helpers._DEFERRED_FOLDS.clear()
    chat_helpers._ADVANCE_ESCALATION.clear()
    chat_helpers.reset_stale_beat_rejections()
    chat_helpers.clear_social_runway("owner")
    yield
    chat_helpers._LAST_BEAT_SEQ.clear()
    chat_helpers._LAST_BEAT_SIG.clear()
    chat_helpers._DESYNC_REGROUND.clear()
    chat_helpers._DEFERRED_FOLDS.clear()
    chat_helpers._ADVANCE_ESCALATION.clear()
    chat_helpers.reset_stale_beat_rejections()
    chat_helpers.clear_social_runway("owner")


def _stale_409(now: int) -> "orwell_engine.EngineToolError":
    return orwell_engine.EngineToolError(
        f"stale write refused — expected beatSeq is behind the current board (now {now}); re-ground",
        status=409)


# ── S1a — the advance RE-FIRE (fresh CAS token, SAME idempotency key) ───────────────────────────── #

def test_advance_stale_409_is_refired_once_with_same_idempotency_key(monkeypatch):
    """The literal root-cause fix: a stale-409 on the pre-resolve advance no longer reconciles-and-
    RETURNS un-advanced. It re-fires ONCE against the fresh beatSeq with the SAME idempotency key and
    the beat lands — the narrator can never be left detached on an unadvanced beat."""
    seq = {"v": 50}
    chat_helpers._LAST_BEAT_SEQ["owner"] = 50
    calls = []

    async def fake_status(user=None):
        return {"phase": "nominations", "pending": None, "veto": {}, "beatSeq": seq["v"]}

    async def fake_state(user=None, **kw):
        return {"phase": "veto-competition", "week": 1, "finished": False, "house": [], "beatSeq": seq["v"]}

    async def fake_advance(expected_beat_seq=None, idempotency_key=None, user=None):
        calls.append({"expected_beat_seq": expected_beat_seq, "idempotency_key": idempotency_key})
        # First call carries the pre-reconcile token → 409; the reconcile bumps last-seen to 51, so the
        # RE-FIRE carries 51 and the engine accepts it (the beat advances).
        if expected_beat_seq != 51:
            seq["v"] = 51
            raise _stale_409(51)
        seq["v"] = 52
        return {"event": {"content": "noms"}, "beatSeq": 52}

    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "advance_game", fake_advance)

    _run(chat_helpers._pre_resolve_npc_ceremony(
        "owner", {"phase": "nominations", "week": 1}, retry=False, player_msg="let's see the noms"))

    assert len(calls) == 2, "the stale-409'd advance was re-fired exactly once (at-least-once)"
    assert calls[0]["idempotency_key"], "the progression call carried an idempotency key"
    assert calls[0]["idempotency_key"] == calls[1]["idempotency_key"], \
        "the retry reuses the SAME idempotency key so the engine dedupes a double-apply (at-most-once)"
    assert calls[1]["expected_beat_seq"] == 51, "the retry carried the reconciled fresh CAS token"
    assert chat_helpers.stale_beat_rejections() == 1
    assert not chat_helpers.advance_escalation_armed("owner"), "a single 409 that recovered arms nothing"


def test_advance_double_stale_409_records_red_and_arms_escalation(monkeypatch):
    """A SECOND consecutive 409 is a real sustained-concurrency loss: the beat stays un-advanced, so we
    record RED (#1599 — never fail softly) and ARM the S1b lull-independent forced advance for the next
    round rather than letting the narrator drift."""
    seq = {"v": 50}
    chat_helpers._LAST_BEAT_SEQ["owner"] = 50
    calls = []
    reds = []

    async def fake_status(user=None):
        return {"phase": "nominations", "pending": None, "veto": {}, "beatSeq": seq["v"]}

    async def fake_state(user=None, **kw):
        return {"phase": "veto-competition", "week": 1, "finished": False, "house": [], "beatSeq": seq["v"]}

    async def fake_advance(expected_beat_seq=None, idempotency_key=None, user=None):
        calls.append(idempotency_key)
        seq["v"] += 1
        raise _stale_409(seq["v"])  # the board keeps moving — always stale

    def fake_red(anomaly_class, exc, *, corrected=None, **ctx):
        reds.append((anomaly_class, corrected))

    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "advance_game", fake_advance)
    monkeypatch.setattr(log_rings, "record_soft_failure", fake_red)

    _run(chat_helpers._pre_resolve_npc_ceremony(
        "owner", {"phase": "nominations", "week": 1}, retry=False, player_msg="let's see the noms"))

    assert len(calls) == 2, "tried once + re-fired once, then gave up (no blind loop)"
    assert calls[0] == calls[1], "both attempts carried the SAME idempotency key"
    assert chat_helpers.stale_beat_rejections() == 2
    assert chat_helpers.advance_escalation_armed("owner"), "S1b escalation armed after the double stale"
    assert any(c == "progression:advance-double-stale" for c, _ in reds), "a RED health event was recorded"
    assert all(corr == "forced-advance-armed" for _, corr in reds), "the disposition names the correction"


# ── S1b — the escalation flag mechanics (pure, cross-module) ───────────────────────────────────── #

def test_advance_escalation_flag_arm_read_clear():
    assert chat_helpers.advance_escalation_armed("owner") is False
    chat_helpers._arm_advance_escalation("owner")
    assert chat_helpers.advance_escalation_armed("owner") is True
    chat_helpers.clear_advance_escalation("owner")
    assert chat_helpers.advance_escalation_armed("owner") is False


def test_advance_escalation_keyed_per_game_single_tenant():
    """The flag keys via `_beat_seq_key` (= `_desync_key`), so a None owner (auth-off single-tenant)
    arms + reads under the canonical-session key — never collapsing to `.get(None)` inert."""
    chat_helpers._arm_advance_escalation(None)
    assert chat_helpers.advance_escalation_armed(None) is True
    chat_helpers.clear_advance_escalation(None)
    assert chat_helpers.advance_escalation_armed(None) is False


def test_s1b_force_block_source_pin():
    """The agent loop FORCES tool_choice=advanceGame when the escalation is armed — lull-independent,
    only when advanceGame is on the wire, no pending open, and never submitDecision. Source-pinned
    because the force lives inline in the (non-unit-drivable) streaming function."""
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "src", "agent_loop.py"), encoding="utf-8") as fh:
        src = fh.read()
    assert "_ch_esc.advance_escalation_armed(owner)" in src
    assert '"advanceGame" in _tool_names_sent' in src
    assert '"function": {"name": "advanceGame"}' in src
    assert "_ch_esc.clear_advance_escalation(owner)" in src  # one-shot, never wedged on


# ── S1c — the stall-unconverted RED telemetry (source-pin — inline in the streaming function) ───── #

def test_s1c_stall_unconverted_telemetry_source_pin():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "src", "agent_loop.py"), encoding="utf-8") as fh:
        src = fh.read()
    assert "progression:stall-unconverted" in src, "the unconverted-nudge RED event class is emitted"
    # gated on the beat NOT having moved (an FE forced advance also bumps beatSeq — never a false red)
    assert "_s1_beat_moved" in src
    assert "not _s1_beat_moved and _turn_advance_nudges > 0" in src


# ── S2b — a judge that could not run FAILS CLOSED on a closed-set outcome draft ─────────────────── #

def test_faith_guard_down_fails_closed_on_closed_set_draft():
    """The msg53 hole: the faithfulness judge TIMED OUT and the fabricated 'Jasmine wins Head of
    Household!' soft-passed. A guard-down draft carrying closed-set outcome vocabulary must fail CLOSED
    — queue a visible re-ground AND arm the forced advance — never soft-pass."""
    chat_helpers._DESYNC_REGROUND.clear()
    chat_helpers._ADVANCE_ESCALATION.clear()
    out = al._faith_guard_down_p0("owner", "Jasmine wins Head of Household! The house erupts.")
    assert out is True
    assert "owner" in chat_helpers._DESYNC_REGROUND, "a visible next-turn re-ground was queued"
    assert chat_helpers.advance_escalation_armed("owner"), "the forced advance was armed"


def test_faith_guard_down_never_touches_open_set_prose():
    """ADR 0005 #1: a guard-down draft with NO closed-set claim (pure social prose) is NOT failed
    closed — creative/open-set narration is never held or re-grounded."""
    chat_helpers._DESYNC_REGROUND.clear()
    chat_helpers._ADVANCE_ESCALATION.clear()
    out = al._faith_guard_down_p0("owner", "We all settle into the kitchen and laugh about the day.")
    assert out is False
    assert "owner" not in chat_helpers._DESYNC_REGROUND
    assert chat_helpers.advance_escalation_armed("owner") is False


def test_s2b_wired_into_both_judge_down_handlers_source_pin():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "src", "agent_loop.py"), encoding="utf-8") as fh:
        src = fh.read()
    # both the resolve-failed and the call-failed (timeout) handlers run the fail-closed interdiction
    assert src.count("_faith_guard_down_p0(owner, narration)") >= 2
