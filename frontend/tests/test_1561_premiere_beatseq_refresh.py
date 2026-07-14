"""#1561 — premiere first-turn desync: createCharacter must refresh the FE's last-seen beatSeq.

The createCharacter FINALIZE advances the engine beatSeq (season start + the premiere fan-out), exactly
like advanceGame/submitDecision/turnIn — but, unlike those, `do_create_character` never flowed its
committed result through `_refresh_beat_seq`. So the FE's last-seen token stayed at the PRE-create value
while the engine head moved (e.g. 58 -> 64), and the very first narration turn attached a stale
`expectedBeatSeq` → a stale-beat 409 + desync on turn 1 (the belts recovered it after the fact; this
removes it at the seam).

BEHAVIORAL: drive `do_create_character` against a stubbed engine whose create result carries a bumped
beatSeq, and assert the FE last-seen tracker (`chat_helpers.last_beat_seq`) reflects it afterwards.
Roles only; no names.
"""
import importlib
import inspect

import pytest

ti = importlib.import_module("src.tool_implementations")
ch = importlib.import_module("routes.chat_helpers")


def test_do_create_character_refreshes_last_seen_beat(monkeypatch):
    """A started createCharacter result must refresh the per-user last-seen beatSeq so the first
    narration turn attaches the CURRENT beat, not the pre-create one."""
    owner = "role-player"
    oe = importlib.import_module("src.orwell_engine")

    # The FE last-seen tracker starts BEHIND the engine (the pre-create view).
    ch._refresh_beat_seq(owner, {"beatSeq": 58})
    assert ch.last_beat_seq(owner) == 58

    async def _create(*a, **k):
        # The engine finalizes casting and starts the season — its committed result carries the
        # ADVANCED beatSeq (the season-start + premiere fan-out).
        return {"started": True, "beatSeq": 64, "house": [], "portraitPrompts": []}

    monkeypatch.setattr(oe, "create_character", _create)
    # Keep the best-effort side-kicks inert — they must not affect the beat refresh.
    monkeypatch.setattr(oe, "remember_pending", lambda *a, **k: None)

    import asyncio
    args = '{"playerName": "role-player"}'
    res = asyncio.get_event_loop().run_until_complete(ti.do_create_character(args, owner=owner))
    assert isinstance(res, dict)

    assert ch.last_beat_seq(owner) == 64, (
        "createCharacter must refresh the FE last-seen beatSeq to the committed head (64), so the first "
        "narration turn does not self-409 stale-beat on turn 1")


def test_do_create_character_does_not_refresh_on_a_refused_create(monkeypatch):
    """A no-op / refused create (createRefused, or not started) must NOT stomp the last-seen beat — it
    advanced nothing."""
    owner = "role-player-2"
    oe = importlib.import_module("src.orwell_engine")

    ch._refresh_beat_seq(owner, {"beatSeq": 20})

    async def _create(*a, **k):
        # e.g. a createCharacter over an already-running season (the B36 no-op guard).
        return {"started": True, "createRefused": True, "beatSeq": 999}

    monkeypatch.setattr(oe, "create_character", _create)
    monkeypatch.setattr(oe, "remember_pending", lambda *a, **k: None)

    import asyncio
    asyncio.get_event_loop().run_until_complete(
        ti.do_create_character('{"playerName": "role-player-2"}', owner=owner))

    assert ch.last_beat_seq(owner) == 20, "a refused create advances nothing — it must not refresh last-seen"


# ── BEHAVIORAL — the #1599 disposition log ACTUALLY fires on a real refresh failure ─────────────────

def test_refresh_failure_logs_the_1599_warning(monkeypatch, caplog):
    """#1599 — the #1599 WARNING is a phantom guard unless a genuine refresh failure can REACH it. The
    call site must bypass the fail-open `_refresh_after_model_progression` wrapper (which swallows) and
    call the RAISING `_refresh_beat_seq` directly, so a real failure propagates into the `except` and the
    warning actually emits. Drive that path: make the refresh raise and assert the WARNING logged."""
    owner = "role-player-3"
    oe = importlib.import_module("src.orwell_engine")

    async def _create(*a, **k):
        return {"started": True, "beatSeq": 71, "house": [], "portraitPrompts": []}

    monkeypatch.setattr(oe, "create_character", _create)
    monkeypatch.setattr(oe, "remember_pending", lambda *a, **k: None)

    # The underlying beatSeq refresh FAILS (e.g. a corrupt store, an import error). The call site must
    # NOT swallow it — it must log the #1599 disposition.
    def _boom(*a, **k):
        raise RuntimeError("beat store unavailable")

    monkeypatch.setattr(ch, "_refresh_beat_seq", _boom)

    import asyncio
    with caplog.at_level("WARNING"):
        res = asyncio.get_event_loop().run_until_complete(
            ti.do_create_character('{"playerName": "role-player-3"}', owner=owner))
    # The turn still stands — a degraded refresh is corrected by the stale-beat belt, not fatal
    # (the tool returns its usual envelope, it does not crash out).
    assert isinstance(res, dict) and "started" in (res.get("output") or "")
    # The disposition WARNING must have fired (this is the whole point — no silent soft-failure).
    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
    assert any("#1561" in m and "beatSeq refresh failed" in m for m in warnings), (
        "a failed post-createCharacter beatSeq refresh must emit the #1599 disposition WARNING, not be "
        f"swallowed silently; saw warnings: {warnings}")


# ── STRUCTURAL — pin the seam + the #1599 disposition log ──────────────────────────────────────────

def test_refresh_is_wired_into_do_create_character():
    src = inspect.getsource(ti.do_create_character)
    # The RAISING refresh (not the fail-open wrapper) must be the call site, so a failure can be logged.
    assert "_refresh_beat_seq" in src, (
        "do_create_character must refresh the FE last-seen beatSeq via the raising _refresh_beat_seq "
        "(NOT the fail-open _refresh_after_model_progression wrapper, which would swallow failures)")
    # #1599 — if the guard cannot run, it must log with disposition, never swallow silently.
    assert "#1599" in src and "logger.warning" in src, (
        "a failed beatSeq refresh (the turn-1 desync guard) must log at WARNING per #1599")
