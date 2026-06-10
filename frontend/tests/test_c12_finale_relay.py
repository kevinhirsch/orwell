"""Queue C12 — the front-end stops being the thing that makes the game unplayable.

Three guards, name-agnostic, engine monkeypatched (no running engine needed):
  1. The submitDecision relay forwards EVERY engine decision kind (finale included) and its
     payload fields — the relay must never reject a pending kind the engine can produce.
  2. POST /api/orwell/new-game refuses to replace a STARTED game without confirm=true (409),
     and forwards confirmRestart on an explicit confirm.
  3. Engine-down MID-SEASON fails CLOSED for game content: the turn gets the feed-down
     framing instead of letting the model narrate from stale context (audit F2).
"""

import importlib
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")
tool_impl = importlib.import_module("src.tool_implementations")
chat_helpers = importlib.import_module("routes.chat_helpers")


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app)


# --- 1. the decision relay covers the engine's full contract ------------------------

# Mirror of src/ports/GameSession.ts SubmitDecisionReq["kind"].
ENGINE_KINDS = [
    "nominations", "veto-decision", "comp-intent", "houseguests-choice",
    "replacement", "eviction-vote", "tie-break", "final-eviction",
    "finale-statement", "finale-answer", "juror-vote",
]


@pytest.mark.parametrize("kind", ENGINE_KINDS)
def test_relay_accepts_every_engine_kind(monkeypatch, kind):
    seen = {}

    async def fake_submit(decision, user=None):
        seen.update(decision)
        return {"ok": True}

    monkeypatch.setattr(orwell_engine, "submit_decision", fake_submit)
    import asyncio
    res = asyncio.get_event_loop().run_until_complete(
        tool_impl.do_submit_decision(json.dumps({"kind": kind}), owner="p")
    )
    assert res.get("exit_code") == 0, f"{kind} rejected by the relay: {res}"
    assert seen.get("kind") == kind


def test_relay_forwards_finale_fields(monkeypatch):
    seen = {}

    async def fake_submit(decision, user=None):
        seen.update(decision)
        return {"ok": True}

    monkeypatch.setattr(orwell_engine, "submit_decision", fake_submit)
    import asyncio
    asyncio.get_event_loop().run_until_complete(tool_impl.do_submit_decision(json.dumps({
        "kind": "finale-answer", "appeal": "mend", "statement": "ignored-here",
        "intent": "compete", "vote": "x",
    }), owner="p"))
    # every payload field the engine contract defines is forwarded, none silently dropped
    assert seen.get("appeal") == "mend"
    assert seen.get("statement") == "ignored-here"
    assert seen.get("intent") == "compete"
    assert seen.get("vote") == "x"


def test_relay_rejects_unknown_kind(monkeypatch):
    called = []

    async def fake_submit(decision, user=None):
        called.append(decision)
        return {"ok": True}

    monkeypatch.setattr(orwell_engine, "submit_decision", fake_submit)
    import asyncio
    res = asyncio.get_event_loop().run_until_complete(
        tool_impl.do_submit_decision(json.dumps({"kind": "coronation"}), owner="p")
    )
    assert res.get("exit_code") == 1 and not called


# --- 2. new-game guards a started season --------------------------------------------

def test_new_game_409_when_started_without_confirm(client, monkeypatch):
    async def fake_state(user=None):
        return {"started": True}

    created = []

    async def fake_create(*a, **k):
        created.append(k)
        return {"started": True}

    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "create_character", fake_create)
    r = client.post("/api/orwell/new-game", json={"playerName": "P"})
    assert r.status_code == 409 and not created


def test_new_game_confirm_forwards_restart(client, monkeypatch):
    async def fake_state(user=None):
        return {"started": True}

    created = []

    async def fake_create(*a, **k):
        created.append(k)
        return {"started": True}

    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "create_character", fake_create)
    r = client.post("/api/orwell/new-game", json={"playerName": "P", "confirm": True})
    assert r.status_code == 200
    assert created and created[0].get("confirm_restart") is True


def test_new_game_fresh_sandbox_unchanged(client, monkeypatch):
    async def fake_state(user=None):
        return {"started": False}

    created = []

    async def fake_create(*a, **k):
        created.append(k)
        return {"started": True}

    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "create_character", fake_create)
    r = client.post("/api/orwell/new-game", json={"playerName": "P"})
    assert r.status_code == 200 and created


def test_client_maps_confirm_restart(monkeypatch):
    sent = {}

    async def fake_call(name, args, user=None):
        sent.update(args)
        return {}

    monkeypatch.setattr(orwell_engine, "_call", fake_call)
    import asyncio
    asyncio.get_event_loop().run_until_complete(
        orwell_engine.create_character("P", confirm_restart=True, user="u"))
    assert sent.get("confirmRestart") is True
    sent.clear()
    asyncio.get_event_loop().run_until_complete(orwell_engine.create_character("P", user="u"))
    assert "confirmRestart" not in sent


# --- 3. engine-down mid-season fails CLOSED (audit F2) -------------------------------

def _run(coro):
    import asyncio
    return asyncio.get_event_loop().run_until_complete(coro)


async def _down(*_a, **_k):
    raise RuntimeError("engine unreachable")


async def _async_noop(*_a, **_k):
    return None


def test_game_turn_prepends_moment_prompt(monkeypatch):
    chat_helpers._GAME_WAS_ACTIVE.clear()

    async def fake_state(user=None):
        return {"started": True, "moment": "social"}

    async def fake_mp(moment=None, user=None):
        return {"systemPrompt": "GM-PROMPT"}

    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "get_moment_prompt", fake_mp)
    preface = [{"role": "system", "content": "base"}]
    ea, ga, fd = _run(chat_helpers.apply_game_framing(preface, "p"))
    assert (ea, ga, fd) == (True, True, False)
    assert preface[0]["content"].startswith("GM-PROMPT")


def test_engine_down_mid_season_fails_closed(monkeypatch):
    chat_helpers._GAME_WAS_ACTIVE.clear()

    async def fake_state(user=None):
        return {"started": True, "moment": "social"}

    async def fake_mp(moment=None, user=None):
        return {"systemPrompt": "GM-PROMPT"}

    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)
    monkeypatch.setattr(orwell_engine, "get_moment_prompt", fake_mp)
    _run(chat_helpers.apply_game_framing([], "p"))  # a game turn succeeds → marker set

    monkeypatch.setattr(orwell_engine, "get_game_state", _down)
    preface = [{"role": "system", "content": "base"}]
    ea, ga, fd = _run(chat_helpers.apply_game_framing(preface, "p"))
    assert (ea, ga, fd) == (False, False, True)
    # the refusal-to-continue framing leads the system prompt; no in-character narration
    assert preface[0]["content"] == chat_helpers.FEED_DOWN_PROMPT


def test_engine_down_with_no_game_history_stays_plain_on_NON_game_build(monkeypatch):
    # Legacy mixed-use behavior: only when the game build is OFF is plain chat a legitimate
    # surface, so an engine outage for a never-framed user fails open to the normal assistant.
    monkeypatch.setenv("ORWELL_GAME_BUILD", "0")
    chat_helpers._GAME_WAS_ACTIVE.clear()
    monkeypatch.setattr(orwell_engine, "get_game_state", _down)
    preface = [{"role": "system", "content": "base"}]
    ea, ga, fd = _run(chat_helpers.apply_game_framing(preface, "p"))
    assert (ea, ga, fd) == (False, False, False)
    assert preface == [{"role": "system", "content": "base"}]  # fail-open for non-game chat


def test_game_end_clears_the_marker(monkeypatch):
    monkeypatch.setenv("ORWELL_GAME_BUILD", "0")  # marker semantics belong to the non-game build
    chat_helpers._GAME_WAS_ACTIVE.clear()

    async def started(user=None):
        return {"started": True, "moment": "social"}

    async def ended(user=None):
        return {"started": False}

    async def fake_mp(moment=None, user=None):
        return {"systemPrompt": "GM-PROMPT"}

    monkeypatch.setattr(orwell_engine, "get_moment_prompt", fake_mp)
    monkeypatch.setattr(orwell_engine, "get_game_state", started)
    _run(chat_helpers.apply_game_framing([], "p"))
    monkeypatch.setattr(orwell_engine, "get_game_state", ended)
    _run(chat_helpers.apply_game_framing([], "p"))  # game over/reset → marker cleared
    monkeypatch.setattr(orwell_engine, "get_game_state", _down)
    preface = []
    _, _, fd = _run(chat_helpers.apply_game_framing(preface, "p"))
    assert fd is False and preface == []


# --- the game build never serves a vanilla turn (user-reported: "vanilla assistant is
# unplayable" — a fresh player said "hi" and met a generic chatbot) -------------------

def test_game_build_engine_down_fails_closed_even_for_a_fresh_user(monkeypatch):
    # The exact reported shape: brand-new player, fresh FE process (empty marker set),
    # engine unreachable at the FIRST frame → must be the feeds-down voice, never vanilla.
    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)  # default = game build ON
    chat_helpers._GAME_WAS_ACTIVE.clear()
    monkeypatch.setattr(orwell_engine, "get_game_state", _down)
    preface = [{"role": "system", "content": "base"}]
    ea, ga, fd = _run(chat_helpers.apply_game_framing(preface, "fresh-user"))
    assert (ea, ga, fd) == (False, False, True)
    assert preface[0]["content"] == chat_helpers.FEED_DOWN_PROMPT


def test_started_game_with_moment_prompt_failure_stays_in_character_not_feeds_down(monkeypatch):
    # The latent flaw in the first cut: one try/except wrapped BOTH engine calls, so a started
    # season whose moment-prompt fetch hiccupped collapsed to a feeds-down message. get_game_state
    # already proved the season is live, so the turn must stay in character (fallback frame).
    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)
    chat_helpers._GAME_WAS_ACTIVE.clear()

    async def started(user=None):
        return {"started": True, "moment": "social"}

    async def mp_down(moment=None, user=None):
        raise RuntimeError("moment prompt boom")

    monkeypatch.setattr(orwell_engine, "get_game_state", started)
    monkeypatch.setattr(orwell_engine, "get_moment_prompt", mp_down)
    preface = [{"role": "system", "content": "base"}]
    ea, ga, fd = _run(chat_helpers.apply_game_framing(preface, "p"))
    assert (ea, ga, fd) == (True, True, False)  # live game, in-character, NOT feeds-down
    assert preface[0]["content"].startswith(chat_helpers.FALLBACK_GM_PROMPT)
    assert preface[0]["content"].endswith("base")  # the fallback frames the existing system prompt


def test_game_build_retries_state_once_so_a_brief_engine_blip_recovers(monkeypatch):
    # A momentary engine restart between turns should recover to a normal in-character turn under
    # the game build (one short retry), not surface a feeds-down message.
    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)
    monkeypatch.setattr(chat_helpers.asyncio, "sleep", _async_noop)
    chat_helpers._GAME_WAS_ACTIVE.clear()
    calls = {"n": 0}

    async def flaky(user=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("connection refused (restarting)")
        return {"started": True, "moment": "social"}

    async def fake_mp(moment=None, user=None):
        return {"systemPrompt": "GM-PROMPT"}

    monkeypatch.setattr(orwell_engine, "get_game_state", flaky)
    monkeypatch.setattr(orwell_engine, "get_moment_prompt", fake_mp)
    preface = [{"role": "system", "content": "base"}]
    ea, ga, fd = _run(chat_helpers.apply_game_framing(preface, "p"))
    assert (ea, ga, fd) == (True, True, False)
    assert calls["n"] == 2  # retried once and recovered
    assert preface[0]["content"].startswith("GM-PROMPT")


def test_game_build_no_started_game_gets_the_pre_game_casting_voice(monkeypatch):
    # Engine up but this sandbox has no season (new player / reset / lost save): the turn is
    # framed as production steering into casting — never a generic assistant.
    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)
    chat_helpers._GAME_WAS_ACTIVE.clear()

    async def no_game(user=None):
        return {"started": False}

    monkeypatch.setattr(orwell_engine, "get_game_state", no_game)
    preface = [{"role": "system", "content": "base"}]
    ea, ga, fd = _run(chat_helpers.apply_game_framing(preface, "p"))
    assert (ea, ga, fd) == (True, False, False)
    assert preface[0]["content"] == chat_helpers.PRE_GAME_PROMPT
    assert preface[1]["content"] == "base"


def test_non_game_build_no_started_game_stays_plain(monkeypatch):
    monkeypatch.setenv("ORWELL_GAME_BUILD", "0")
    chat_helpers._GAME_WAS_ACTIVE.clear()

    async def no_game(user=None):
        return {"started": False}

    monkeypatch.setattr(orwell_engine, "get_game_state", no_game)
    preface = [{"role": "system", "content": "base"}]
    ea, ga, fd = _run(chat_helpers.apply_game_framing(preface, "p"))
    assert (ea, ga, fd) == (True, False, False)
    assert preface == [{"role": "system", "content": "base"}]
