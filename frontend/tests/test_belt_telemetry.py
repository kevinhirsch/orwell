"""Product gap #3 — belt-fire telemetry (docs/design/undercall-seam-structural.md §5).

Every FE guardrail belt that error-corrects a model under-call now COUNTS its firing in the
Vault-free 0065 sync ledger, so playtests can MEASURE belt reliance instead of feeling it:

  * ``orwell_sync_ledger.note_belt_fire(user, belt)`` — fail-soft in-memory buffer (names +
    small counts only; the same coercion floor as every ledger field);
  * ``record_turn`` drains the buffer into the turn entry's ``beltsFired`` map;
  * ``get_belt_totals(user)`` — ring + pending aggregate, per-user scoped.

Also pins (source-level) that every named belt call site actually notes its fire, and that the
agent-loop helper is fail-soft. Roles only — belt/tool NAMES are app capabilities, never a body.
"""

import importlib
import os

import pytest

ledger = importlib.import_module("src.orwell_sync_ledger")

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(autouse=True)
def _tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(ledger, "LEDGER_PATH", tmp_path / "orwell_sync_ledger.json")
    ledger._PENDING_BELTS.clear()
    yield
    ledger._PENDING_BELTS.clear()


# ── the buffer → record_turn drain ───────────────────────────────────────────────────────────


def test_noted_fires_drain_into_the_next_recorded_turn():
    ledger.note_belt_fire("player", "auto-record-scene")
    ledger.note_belt_fire("player", "auto-record-scene")
    ledger.note_belt_fire("player", "forced-tool-choice:advanceGame")
    ledger.record_turn("player", session="s", turn_id="t")
    e = ledger.get_recent("player")[0]
    assert e["beltsFired"] == {"auto-record-scene": 2, "forced-tool-choice:advanceGame": 1}
    # drained: a second turn with no new fires records an empty map
    ledger.record_turn("player", session="s", turn_id="t2")
    assert ledger.get_recent("player")[-1]["beltsFired"] == {}


def test_explicit_belts_fired_arg_merges_with_the_buffer():
    ledger.note_belt_fire("player", "casting-nudge")
    ledger.record_turn("player", session="s", turn_id="t",
                       belts_fired={"casting-nudge": 1, "advance-stall-nudge": 3})
    e = ledger.get_recent("player")[0]
    assert e["beltsFired"] == {"casting-nudge": 2, "advance-stall-nudge": 3}


def test_multi_count_note_and_default_n():
    ledger.note_belt_fire("player", "premiere-meet-belt", 4)
    ledger.record_turn("player", session="s", turn_id="t")
    assert ledger.get_recent("player")[0]["beltsFired"] == {"premiere-meet-belt": 4}


# ── the Vault-free coercion floor ────────────────────────────────────────────────────────────


def test_belt_names_are_clipped_and_counts_coerced():
    big = "belt " + "x" * 500
    ledger.note_belt_fire("player", big)
    ledger.note_belt_fire("player", "ok-belt", "not-a-number")  # coerces to 0 ⇒ dropped
    ledger.note_belt_fire("player", "neg-belt", -5)  # non-positive ⇒ dropped
    ledger.note_belt_fire("player", "", 3)  # empty name ⇒ dropped
    ledger.record_turn("player", session="s", turn_id="t")
    belts = ledger.get_recent("player")[0]["beltsFired"]
    assert list(belts.values()) == [1]
    (name,) = belts.keys()
    assert len(name) <= ledger._MAX_NAME_LEN  # a body can never ride a belt name


def test_belt_map_is_bounded_at_the_name_cap():
    for i in range(ledger._MAX_NAMES + 20):
        ledger.note_belt_fire("player", f"belt-{i}")
    ledger.record_turn("player", session="s", turn_id="t")
    assert len(ledger.get_recent("player")[0]["beltsFired"]) <= ledger._MAX_NAMES


def test_garbage_belts_fired_arg_records_empty_map():
    ledger.record_turn("player", session="s", turn_id="t", belts_fired="not-a-dict")
    assert ledger.get_recent("player")[0]["beltsFired"] == {}


def test_note_belt_fire_never_raises_on_garbage():
    class _Evil:
        def __str__(self):
            raise RuntimeError("no name for you")
    ledger.note_belt_fire("player", _Evil())
    ledger.note_belt_fire("player", None)
    ledger.note_belt_fire(None, "default-belt")  # missing user maps to "default"


# ── get_belt_totals: ring + pending, per-user scoped ─────────────────────────────────────────


def test_belt_totals_sum_the_ring_and_the_pending_buffer():
    ledger.note_belt_fire("player", "auto-record-scene")
    ledger.record_turn("player", session="s", turn_id="t1")  # → ring
    ledger.note_belt_fire("player", "auto-record-scene")
    ledger.record_turn("player", session="s", turn_id="t2")  # → ring
    ledger.note_belt_fire("player", "auto-record-scene")     # still pending (no turn yet)
    ledger.note_belt_fire("player", "casting-nudge")         # pending only
    totals = ledger.get_belt_totals("player")
    assert totals == {"auto-record-scene": 3, "casting-nudge": 1}


def test_belt_totals_are_per_user_isolated():
    ledger.note_belt_fire("player-a", "auto-record-scene")
    ledger.note_belt_fire("player-b", "casting-nudge")
    assert ledger.get_belt_totals("player-a") == {"auto-record-scene": 1}
    assert ledger.get_belt_totals("player-b") == {"casting-nudge": 1}
    assert ledger.get_belt_totals("player-c") == {}


def test_no_auth_default_bucket_is_measurable_without_a_recorded_turn():
    # Under AUTH_ENABLED=false the belts note under user=None → the "default" sentinel; even
    # though the loop's ledger hook records nothing without an owner, totals stay readable.
    ledger.note_belt_fire(None, "advance-stall-nudge")
    assert ledger.get_belt_totals(None) == {"advance-stall-nudge": 1}
    assert ledger.get_belt_totals("default") == {"advance-stall-nudge": 1}


def test_clear_drops_the_pending_buffer_too():
    ledger.note_belt_fire("player", "auto-record-scene")
    ledger.record_turn("player", session="s", turn_id="t")
    ledger.note_belt_fire("player", "auto-record-scene")
    ledger.clear("player")
    assert ledger.get_belt_totals("player") == {}


def test_log_line_carries_the_belt_counts(caplog):
    import logging
    ledger.note_belt_fire("player", "auto-record-scene", 2)
    with caplog.at_level(logging.INFO, logger="src.orwell_sync_ledger"):
        ledger.record_turn("player", session="s", turn_id="t")
    lines = [r.getMessage() for r in caplog.records if "sync-ledger turn" in r.getMessage()]
    assert len(lines) == 1 and "auto-record-scene:2" in lines[0]


# ── the agent-loop helper is fail-soft ───────────────────────────────────────────────────────


def test_agent_loop_note_belt_is_fail_soft(monkeypatch):
    al = importlib.import_module("src.agent_loop")

    def boom(*_a, **_k):
        raise RuntimeError("telemetry store on fire")

    monkeypatch.setattr(ledger, "note_belt_fire", boom)
    al._note_belt("player", "auto-record-scene")  # must not raise


def test_agent_loop_note_belt_counts_into_the_ledger():
    al = importlib.import_module("src.agent_loop")
    al._note_belt("player", "eviction-reveal-steer")
    assert ledger.get_belt_totals("player") == {"eviction-reveal-steer": 1}


# ── source pins: every named belt call site notes its fire ──────────────────────────────────
# The registry of stable belt tokens lives in docs/design/undercall-seam-structural.md §5.
# Tightened (CodeRabbit, PR #1377): each token must appear as the BELT ARGUMENT of an actual
# note-belt CALL expression — `…note_belt*(<user-ident>, "token"…)` — so a comment or docstring
# mention can never satisfy the pin. Matches `_note_belt`, `note_belt_fire`, and the shared
# `note_belt` wrapper (incl. the `_sync_ledger_note_belt` import alias), with `owner`/`user`/
# `_force_owner` as the first argument.

import re


def _src(rel):
    with open(os.path.join(_BASE, *rel.split("/")), encoding="utf-8") as fh:
        return fh.read()


def _assert_belt_call(src, token, where):
    """Assert `token` (a belt-name string literal, opening quote included) appears as the
    second argument of a real note-belt call — not merely anywhere in the file."""
    pat = re.compile(
        r'note_belt(?:_fire)?\(\s*(?:owner|user|_force_owner)\s*,\s*' + re.escape(token))
    assert pat.search(src), f"belt telemetry CALL site missing in {where}: {token}"


def test_every_agent_loop_belt_notes_its_fire_as_a_real_call():
    src = _src("src/agent_loop.py")
    for token in (
        '"advance-stall-nudge"',
        '"forced-advance:"',              # _commit_advance_silently (preview-commit / stall / forced-stall)
        '"forced-tool-choice:"',          # #1154 live force (concat with the forced tool's name)
        '"forced-tool-choice:" + _CASTING_FINALIZE_TOOL',  # the gap-#3 casting force
        '"auto-record-scene"',
        '"auto-record-deal"',
        '"auto-confide"',
        '"auto-expose-secret"',
        '"auto-trade-secret"',
        '"auto-move-player"',
        '"auto-move-npc"',
        '"premiere-meet-belt"',
        '"casting-record-belt"',
        '"casting-nudge"',
        '"casting-finalize-force"',
        '"eviction-reveal-steer"',
        '"ceremony-narration-steer"',
    ):
        _assert_belt_call(src, token, "agent_loop.py")


def test_framing_and_gate_belts_note_their_fire_as_real_calls():
    ch = _src("routes/chat_helpers.py")
    _assert_belt_call(ch, '"pre-resolve-npc-ceremony"', "chat_helpers.py")
    _assert_belt_call(ch, '"headshot-on-file-framing"', "chat_helpers.py")
    ti = _src("src/tool_implementations.py")
    _assert_belt_call(ti, '"house-entry-gate-hold"', "tool_implementations.py")


def test_success_gated_belts_fire_only_after_the_helper_applied():
    """CodeRabbit MAJOR (PR #1377): a no-op/failed extraction must never count as a belt fire —
    that would poison the exact measurement this telemetry exists to create. Pin the shape:
    each success-gated belt's note call sits AFTER its awaited helper in source order (inside
    the success branch), never before it, and the once-per-turn counter still precedes the
    helper call (cap behavior preserved)."""
    src = _src("src/agent_loop.py")
    for helper, token in (
        ("_auto_move_player", '"auto-move-player"'),
        ("_auto_move_npc", '"auto-move-npc"'),
        ("_auto_record_deal", '"auto-record-deal"'),
        ("_auto_confide", '"auto-confide"'),
        ("_auto_expose_secret", '"auto-expose-secret"'),
        ("_auto_trade_secret", '"auto-trade-secret"'),
        ("_auto_record_scene", '"auto-record-scene"'),
    ):
        note_at = src.index("_note_belt(owner, " + token)
        # The nearest awaited helper call BEFORE the note must be this belt's own helper —
        # i.e. the note fires after (and therefore gated on) the helper's result.
        call_at = src.rindex("await " + helper + "(", 0, note_at)
        between = src[call_at:note_at].replace("await " + helper + "(", "", 1)
        assert "await _auto_" not in between, (
            f"{token}: note is not adjacent to its own helper's success branch")
        # And the belt's once-per-turn counter increment still precedes the helper call.
        assert re.search(r"_turn_\w+ \+= 1", src[max(0, call_at - 600):call_at]), (
            f"{token}: once-per-turn counter increment missing before the helper call")
