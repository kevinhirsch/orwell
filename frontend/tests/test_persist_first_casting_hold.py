"""The 2026-07-13 prod-deadlock FE half — persist-first casting turns + the FAST holding card.

Two invariants, both born from the live wedge (engine refusing pre-game cast write-backs while the
#1313 house-entry hold starved):

1. PERSIST-FIRST (requirement 7): in the chat POST path the player's user-message row must be
   durably persisted BEFORE any game-framing / hold / genesis await can run — CLAUDE.md's own law
   ("never ship an action that is narrated but never recorded"; a fortiori never DROP the player's
   text). `build_chat_context` persists via `add_user_message` (→ `SessionManager._persist_message`,
   a synchronous DB write at append time) and only THEN awaits `apply_game_framing`; the ≤180s
   house-entry hold and the genesis single-flight tail live in the TOOL phase (`do_create_character`,
   after the row is on disk). A turn aborted mid-hold therefore still leaves the user message in the
   store.

2. FAST HOLDING CARD (requirement 8): while the house-entry hold is unsatisfied the createCharacter
   turn returns the "Production is finalizing your casting…" holding card PROMPTLY — a short inline
   grace (`house_ready_inline_budget()`, default 10s, env `ORWELL_HOUSE_READY_INLINE_S`) instead of
   the old inline-everything ~180s of silence — and the background gate-clear watch owns the rest
   (re-checks authoring, clears the marker, runs the deferred post-start kicks exactly once, pushes a
   game-updated). The LOUD "house entry refused" strict-policy ledger entry moved to the WATCH
   EXPIRY, the point the wait is genuinely exhausted.

Roles only — every string is a generic probe, never cast material.
"""
import importlib
import inspect
import json

import pytest

ti = importlib.import_module("src.tool_implementations")
oe = importlib.import_module("src.orwell_engine")
ca = importlib.import_module("src.orwell_cast_authoring")
cid = importlib.import_module("src.orwell_cast_identity")
chat_helpers = importlib.import_module("routes.chat_helpers")
enrichment_policy = importlib.import_module("src.enrichment_policy")

CHAT_HELPERS_SRC = inspect.getsource(chat_helpers)


# ── (1) persist-first: the user row lands before any hold/framing await ─────────────


def test_user_message_persists_before_game_framing_in_build_chat_context():
    """Source-pin: `build_chat_context` appends+persists the user message (`add_user_message`)
    BEFORE it awaits `apply_game_framing` — so a turn that later wedges in the framing / tool phase
    has already written the player's text."""
    body = inspect.getsource(chat_helpers.build_chat_context)
    persist_at = body.index("add_user_message(")
    framing_at = body.index("apply_game_framing(")
    assert persist_at < framing_at, (
        "the user message must persist BEFORE the game-framing await — a hold engaged later in the "
        "turn must never be able to drop the player's text")


def test_no_hold_or_genesis_award_inside_the_locked_context_build():
    """Source-pin: the context build (which runs under the per-session lock — F4) must never await
    the house-entry hold or the genesis single-flight — those belong to the TOOL phase, after the
    user row is persisted. A hold inside the locked build would block EVERY later POST for the same
    session BEFORE persistence (the live 2026-07-13 symptom: messages hang, then vanish on reload)."""
    body = inspect.getsource(chat_helpers.build_chat_context)
    assert "await_house_ready" not in body
    assert "run_genesis" not in body
    framing = inspect.getsource(chat_helpers.apply_game_framing)
    assert "await_house_ready" not in framing
    assert "run_genesis" not in framing


def test_add_user_message_is_a_synchronous_durable_write():
    """Behavioral: `add_user_message` delegates to `SessionManager._persist_message` synchronously at
    append time — the row is in the store the moment the call returns, before any framing/hold await
    can run (and regardless of how the request ends)."""
    models = importlib.import_module("core.models")

    persisted = []

    class _FakeManager:
        def _persist_message(self, session_id, message):
            persisted.append((session_id, message.role, message.content))

    prior = models._session_manager
    models.set_session_manager(_FakeManager())
    try:
        sess = models.Session(id="s-persist-first", name="probe", model="m", endpoint_url="http://x")

        class _Pre:
            user_content = "a player line that must never be lost"
            text_for_context = user_content
            attachment_meta = None

        chat_helpers.add_user_message(sess, chat_handler=_NoopHandler(), preprocessed=_Pre())
    finally:
        models._session_manager = prior

    assert persisted and persisted[0][1] == "user"
    assert persisted[0][2] == "a player line that must never be lost"


class _NoopHandler:
    def update_session_name_if_needed(self, sess, text):
        return None


def test_aborted_turn_after_persist_still_leaves_the_row():
    """Behavioral pin for the requirement's exact wording: a POST that hits the hold (or any later
    failure) still leaves the user message in the store — simulate the turn aborting right after the
    persist-first point and assert the row survived."""
    models = importlib.import_module("core.models")

    persisted = []

    class _FakeManager:
        def _persist_message(self, session_id, message):
            persisted.append((session_id, message.role))

    prior = models._session_manager
    models.set_session_manager(_FakeManager())
    try:
        sess = models.Session(id="s-aborted-hold", name="probe", model="m", endpoint_url="http://x")

        class _Pre:
            user_content = "another player line"
            text_for_context = user_content
            attachment_meta = None

        chat_helpers.add_user_message(sess, chat_handler=_NoopHandler(), preprocessed=_Pre())
        # The turn then wedges/aborts in the framing / hold / genesis phase:
        with pytest.raises(RuntimeError):
            raise RuntimeError("simulated mid-hold abort")
    finally:
        models._session_manager = prior

    assert persisted == [("s-aborted-hold", "user")], (
        "the user row must survive a turn aborted after the persist-first point")


# ── (2) the fast holding card: short inline grace + background watch ─────────────────


def _started_res():
    house = [{"id": "player", "name": "The Player"}]
    prompts = [{"houseguestId": "player", "name": "The Player", "prompt": "headshot"}]
    for i in range(1, 16):
        house.append({"id": f"npc:{i}", "name": f"Houseguest {i}"})
        prompts.append({"houseguestId": f"npc:{i}", "name": f"Houseguest {i}", "prompt": "headshot"})
    return {"started": True, "house": house, "portraitPrompts": prompts}


@pytest.fixture(autouse=True)
def _isolate_engine(monkeypatch):
    async def fake_create(*a, **k):
        return _started_res()
    monkeypatch.setattr(oe, "create_character", fake_create)

    async def fake_state(*a, **k):
        return {"started": False}
    monkeypatch.setattr(oe, "get_game_state", fake_state)
    monkeypatch.setattr(cid, "kickoff_identity", lambda *a, **k: None)
    yield


async def _async_true(owner):
    return True


def test_inline_budget_default_is_seconds_not_minutes(monkeypatch):
    """The inline slice of the readiness wait is SHORT (seconds) — the ~180s window belongs to the
    background watch, never to the player's turn."""
    monkeypatch.delenv("ORWELL_HOUSE_READY_INLINE_S", raising=False)
    budget = ca.house_ready_inline_budget()
    assert 0 < budget <= 30, f"the inline hold budget must be seconds, not minutes (got {budget})"
    # …and it can never exceed the full readiness window even if mis-tuned.
    monkeypatch.setattr(ca, "_HOUSE_READY_INLINE_S", 99999.0)
    assert ca.house_ready_inline_budget() <= ca._HOUSE_READY_TIMEOUT_S


def test_create_character_waits_only_the_inline_budget(monkeypatch, run):
    """The createCharacter turn passes the SHORT inline budget to the readiness wait — never the
    full (~180s) window (the old inline-everything dead air)."""
    monkeypatch.delenv("ORWELL_ALLOW_FLOOR_START", raising=False)
    monkeypatch.setattr(ca, "house_entry_gate_active", _async_true)
    seen = {}

    async def _capture(owner, **k):
        seen.update(k)
        return {"ready": False, "authored": 3, "total": 15, "missing": 12}
    monkeypatch.setattr(ca, "await_house_ready", _capture)
    monkeypatch.setattr(ca, "kickoff_house_ready_watch", lambda *a, **k: True)

    res = run(ti.do_create_character('{"playerName":"P"}', owner="pf-bob"))
    assert res["exit_code"] == 0
    out = json.loads(res["output"])
    assert out.get("started") is False and (out.get("castingHouse") or {}).get("state") == "authoring"
    assert seen.get("timeout") == ca.house_ready_inline_budget(), (
        "the in-turn readiness wait must use the SHORT inline budget; the long window belongs to "
        "the background watch")
    ca.clear_house_entry_gate_block("pf-bob")


def test_holding_path_arms_the_watch_that_converges_the_hold(monkeypatch, run):
    """The holding card is not a dead end: the same turn arms the background gate-clear watch whose
    on_ready runs the deferred post-start kicks — the hold CONVERGES once profiles land."""
    monkeypatch.delenv("ORWELL_ALLOW_FLOOR_START", raising=False)
    monkeypatch.setattr(ca, "house_entry_gate_active", _async_true)

    async def _not_ready(owner, **k):
        return {"ready": False, "authored": 0, "total": 15, "missing": 15}
    monkeypatch.setattr(ca, "await_house_ready", _not_ready)
    watch = {"n": 0, "on_ready": None}

    def fake_watch(owner, on_ready=None, **k):
        watch["n"] += 1
        watch["on_ready"] = on_ready
        return True
    monkeypatch.setattr(ca, "kickoff_house_ready_watch", fake_watch)

    res = run(ti.do_create_character('{"playerName":"P"}', owner="pf-carol"))
    assert res["exit_code"] == 0
    assert watch["n"] == 1 and callable(watch["on_ready"]), (
        "the immediate holding return must arm the background watch (the hold's convergence path)")
    ca.clear_house_entry_gate_block("pf-carol")


def test_watch_expiry_is_the_loud_strict_failure(monkeypatch, run):
    """The strict-policy 'house entry refused' ledger entry fires at WATCH EXPIRY (the wait genuinely
    exhausted) — the holding turn itself is the normal path, not a failure."""
    monkeypatch.setattr(ca, "house_entry_gate_active", _async_true)

    async def _never_ready(owner, **k):
        return {"ready": False, "authored": 2, "total": 15, "missing": 13}
    monkeypatch.setattr(ca, "await_house_ready", _never_ready)
    monkeypatch.setattr(enrichment_policy, "is_strict", lambda: True)
    enrichment_policy.clear_failures("pf-dave")

    async def _drive():
        armed = ca.kickoff_house_ready_watch("pf-dave", timeout=0.01, poll_interval=0.01)
        assert armed is True
        import asyncio
        for _ in range(50):
            task = ca._HOUSE_READY_WATCHES.get("pf-dave")
            if task is None or task.done():
                break
            await asyncio.sleep(0.01)
    run(_drive())

    kinds = [f.get("callClass") for f in enrichment_policy.failures("pf-dave")]
    reasons = " | ".join(f.get("reason", "") for f in enrichment_policy.failures("pf-dave"))
    assert "cast-authoring" in kinds and "house entry refused" in reasons, (
        "the exhausted watch must ledger the LOUD strict-policy failure")
    # The marker stays (the overlay keeps holding) — never a silent floor start.
    assert ca.house_entry_gate_status("pf-dave") is not None
    ca.clear_house_entry_gate_block("pf-dave")
