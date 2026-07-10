"""WebSocket Phase-1 — the portrait/headshot ARRIVAL push edge.

Sibling to test_ws_pollkill_batch2.py, which made the cast gadget STAND DOWN its adaptive roster
poll under WS (#1291). That poll was the cast panel's only signal that a freshly-generated portrait
had landed — so cancelling it under WS opened a gap: portraits are produced by a BACKGROUND FE
write-back (`orwell_portraits.generate_and_store`) that, unlike every sibling enrichment task
(cast-authoring / zeitgeist / off-screen texture), never published a "game-updated" ping. Under WS
the poll was gone AND nothing pushed ⇒ a portrait could arrive with no update path.

The fix (server-side, this module): `generate_and_store` fires the shared `session_events`
"game-updated" push (via `orwell_game_session.publish_game_updated`) as each face lands and once more
at run completion. The WS `state`/`hud` bridge relays it to `orwell:gamechanged` — the ONE dispatcher
(g15) — which the cast panel already listens for and re-fetches the roster on.

DORMANT by construction: the push is gated on `settings.ws_transport_enabled()`, which defaults OFF.
Flag off ⇒ NO publish ⇒ byte-identical production, the fast roster poll stays the sole update path
(the permanent fallback). Structural + behavioral; roles only, no names.
"""

import asyncio
import importlib
import os

import pytest

orwell_portraits = importlib.import_module("src.orwell_portraits")
orwell_game_session = importlib.import_module("src.orwell_game_session")
settings = importlib.import_module("src.settings")

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(name):
    with open(os.path.join(FRONTEND, "static", "js", name), encoding="utf-8") as f:
        return f.read()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _prompt(hid, name, physical):
    return {
        "houseguestId": hid, "name": name,
        "prompt": ("photorealistic candid production still, Big Brother house interior. "
                   f"Subject: {name}, 30 years old. "
                   f"Physical appearance: {physical}. "
                   "Presentation style: casual. Expression: an easy open smile. "
                   "Framing: head-and-shoulders. Setting: kitchen counters blurred behind"),
    }


_DISTINCT = [
    _prompt("npc:1", "Houseguest One", "tall and lean, warm brown skin, tight black curls, square jaw"),
    _prompt("npc:2", "Houseguest Two", "short and stocky, pale freckled skin, red wavy hair, round face"),
    _prompt("npc:3", "Houseguest Three", "average height, olive skin, straight dark hair, sharp cheekbones"),
]


@pytest.fixture
def tmp_portraits(tmp_path, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "PORTRAITS_DIR", tmp_path / "portraits")
    orwell_portraits._GEN_PROGRESS.clear()
    return tmp_path / "portraits"


def _stub_pipeline(monkeypatch):
    """A deterministic, provider-free generation run: three faces land, no L17 regen, no beats."""
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: True)

    async def fake_gen(prompt, user, reference_png=None):
        return b"PNG-" + prompt.encode()[:4]
    monkeypatch.setattr(orwell_portraits, "_generate_one", fake_gen)

    async def no_dedupe(prompts, user, **k):
        return {"regenerated": 0, "regeneratedIds": [], "offenders": []}
    monkeypatch.setattr(orwell_portraits, "dedupe_lookalikes", no_dedupe)


def _capture_publishes(monkeypatch):
    calls = []
    monkeypatch.setattr(orwell_game_session, "publish_game_updated", lambda user: calls.append(user))
    return calls


# ── the push edge fires when WS transport is ON ──────────────────────────────────────────────────

def test_portrait_arrival_pushes_game_updated_when_ws_is_on(tmp_portraits, monkeypatch):
    monkeypatch.setattr(settings, "ws_transport_enabled", lambda: True)
    _stub_pipeline(monkeypatch)
    calls = _capture_publishes(monkeypatch)

    summary = _run(orwell_portraits.generate_and_store(_DISTINCT, "u", record_beats=False))
    assert summary["generated"] == 3

    # One push per landed face (the panel's poll STOOD DOWN, so this is its arrival signal)…
    per_face = [c for c in calls if c == "u"]
    assert len(per_face) == 4  # 3 faces + 1 final completion reconcile
    # …every push is scoped to the run's user (cross-user isolation preserved).
    assert all(c == "u" for c in calls)


# ── the NO-PROVIDER pre-pass path also fires the push (a player-chosen headshot lands with no model)

def _player_prompt():
    return {"houseguestId": orwell_portraits.PLAYER_PORTRAIT_ID, "name": "The Player",
            "prompt": "photorealistic candid production still. Subject: The Player, 30 years old."}


def test_chosen_headshot_pushes_with_no_image_model_when_ws_is_on(tmp_portraits, monkeypatch):
    # No image model at all — the pre-pass writes the player's chosen headshot and RETURNS before the
    # generation loop. Deliberately NOT using _stub_pipeline (which forces availability True).
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: False)
    monkeypatch.setattr(orwell_portraits, "_read_intake_final", lambda user: b"CHOSEN-HEADSHOT-PNG")
    monkeypatch.setattr(settings, "ws_transport_enabled", lambda: True)
    calls = _capture_publishes(monkeypatch)

    summary = _run(orwell_portraits.generate_and_store([_player_prompt()], "u", record_beats=False))
    # The chosen headshot is stored even with no provider…
    assert summary["generated"] == 1
    assert orwell_portraits.portrait_file("u", orwell_portraits.PLAYER_PORTRAIT_ID) is not None
    # …and the arrival STILL fires the push edge on this early-return path (user-scoped).
    assert calls == ["u"]


def test_chosen_headshot_does_not_push_when_ws_is_off(tmp_portraits, monkeypatch):
    monkeypatch.setattr(orwell_portraits, "image_generation_available", lambda user: False)
    monkeypatch.setattr(orwell_portraits, "_read_intake_final", lambda user: b"CHOSEN-HEADSHOT-PNG")
    monkeypatch.setattr(settings, "ws_transport_enabled", lambda: False)
    calls = _capture_publishes(monkeypatch)

    summary = _run(orwell_portraits.generate_and_store([_player_prompt()], "u", record_beats=False))
    assert summary["generated"] == 1  # stored
    assert orwell_portraits.portrait_file("u", orwell_portraits.PLAYER_PORTRAIT_ID) is not None
    assert calls == []  # dormant: no push when the flag is off (the poll is the fallback)


# ── flag OFF ⇒ no push: byte-identical production, the poll is the permanent fallback ─────────────

def test_no_push_when_ws_transport_is_off(tmp_portraits, monkeypatch):
    monkeypatch.setattr(settings, "ws_transport_enabled", lambda: False)
    _stub_pipeline(monkeypatch)
    calls = _capture_publishes(monkeypatch)

    summary = _run(orwell_portraits.generate_and_store(_DISTINCT, "u", record_beats=False))
    assert summary["generated"] == 3
    # Dormant: the flag is off ⇒ NOTHING publishes; the fast roster poll remains the sole update path.
    assert calls == []


def test_push_helper_is_gated_on_the_ws_flag(tmp_portraits, monkeypatch):
    # A direct call proves the gate itself (independent of the generation loop): off ⇒ no-op, on ⇒ push.
    seen = []
    monkeypatch.setattr(orwell_game_session, "publish_game_updated", lambda user: seen.append(user))

    monkeypatch.setattr(settings, "ws_transport_enabled", lambda: False)
    orwell_portraits._push_portrait_arrival("u")
    assert seen == []

    monkeypatch.setattr(settings, "ws_transport_enabled", lambda: True)
    orwell_portraits._push_portrait_arrival("u")
    assert seen == ["u"]


def test_push_failure_never_breaks_the_run(tmp_portraits, monkeypatch):
    # Best-effort/fail-soft: a publish that raises must not abort a portrait generation run.
    monkeypatch.setattr(settings, "ws_transport_enabled", lambda: True)
    _stub_pipeline(monkeypatch)

    def boom(user):
        raise RuntimeError("event bus down")
    monkeypatch.setattr(orwell_game_session, "publish_game_updated", boom)

    summary = _run(orwell_portraits.generate_and_store(_DISTINCT, "u", record_beats=False))
    assert summary["generated"] == 3  # the run completed despite every push raising


# ── the client CONSUMES the push AND keeps the poll as the permanent fallback ─────────────────────

def test_cast_panel_refreshes_on_the_push_and_keeps_the_poll_fallback():
    cast = _read("orwellCast.js")
    # Consumer: the panel LISTENS for orwell:gamechanged (what the WS state/hud bridge relays to) and
    # re-fetches the roster — so a pushed portrait arrival updates it with no poll.
    assert 'window.addEventListener("orwell:gamechanged"' in cast
    assert "refreshRoster()" in cast
    # Fallback: the adaptive roster poll is a self-rescheduling setTimeout that ONLY stands down under
    # WS (`if (_wsActive()) return;`) — when WS is off/unavailable it remains, the permanent fallback.
    assert "if (_wsActive()) return;" in cast
    assert "_timer = setTimeout(async () => {" in cast


def test_push_routes_through_the_single_gamechanged_dispatcher_not_an_ad_hoc_event(tmp_portraits):
    # g15: the portrait push must NOT introduce an ad-hoc CustomEvent — it rides session_events →
    # the WS bridge → platform.js orwellGameChanged (the ONE dispatcher). The pipeline dispatches no
    # client event of its own; it only publishes a server-side session_events ping.
    portraits_src = open(os.path.join(FRONTEND, "src", "orwell_portraits.py"), encoding="utf-8").read()
    assert "CustomEvent" not in portraits_src      # no ad-hoc client event dispatch from the pipeline
    assert "publish_game_updated" in portraits_src  # it goes through the shared server push seam
