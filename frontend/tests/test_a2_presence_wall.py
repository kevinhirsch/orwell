"""Issue #1726 (A2) — the STRUCTURAL presence guard (the "Guard" half of the issue's 3-part spec;
the "Bind" half — the terminal whereabouts occupancy pin — is a separate change to the narrator
prompt).

A live A/B on `z-ai/glm-4.7` (reasoning-off) found the existing next-turn-only nudge
(`_presence_desync_directive` / `record_post_turn_presence_check`, feature 0076) insufficient on its
own: the terminal binding pin alone only cut the phantom-placement failure rate 5/6 -> 3/6, never to
zero (issue #1726 comment, 2026-07-21). "Location does NOT bind on wording alone" — a STRUCTURAL,
SAME-TURN guard is required, mirroring `screen_knowledge_wall`'s DROP posture rather than 0076's
gentler re-ground-only posture.

This module tests the two new pieces:
  (a) `screen_presence_wall` — drops a sentence that stages an off-scene/evicted houseguest as
      present, BEFORE the text reaches the player (same-turn, sibling to `screen_knowledge_wall`).
  (b) `_presence_omission_directive` — detects the inverse (PARITY-8): the engine places houseguests
      in the player's room, but narration never surfaces any of them at all ("room population never
      updates").

Roles only: houseguest display names are throwaway role words, exercising the regexes exactly as the
sibling 0076 / knowledge-wall guard tests do; no name carries test intent.
"""

import asyncio
import importlib

import pytest

chat_helpers = importlib.import_module("routes.chat_helpers")

_USER = "u-presence-wall"


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _state(room, present, nearby=None, house=None):
    return {
        "whereabouts": {
            "room": room,
            "present": [{"id": f"npc:{n}", "name": n} for n in present],
            "nearby": [{"room": r, "present": [{"id": f"npc:{n}", "name": n} for n in ps]}
                       for r, ps in (nearby or {}).items()],
        },
        "house": house or [],
    }


def _house(active=(), evicted=()):
    return ([{"name": n, "status": "active"} for n in active]
            + [{"name": n, "status": "evicted"} for n in evicted])


def _async(value):
    async def _c(*a, **k):
        return value
    return _c()


@pytest.fixture(autouse=True)
def _clean_state():
    dkey = chat_helpers._desync_key(_USER)
    for key in (dkey, None, "default"):
        chat_helpers._LAST_BEAT_SIG.pop(key, None)
        chat_helpers._DESYNC_REGROUND.pop(key, None)
    yield
    for key in (dkey, None, "default"):
        chat_helpers._LAST_BEAT_SIG.pop(key, None)
        chat_helpers._DESYNC_REGROUND.pop(key, None)


# ── part (a): screen_presence_wall DROPS a phantom placement, same-turn ──────────────────────── #

def test_scan_drops_the_sentence_staging_an_offscene_houseguest(monkeypatch):
    from src import orwell_engine
    state = _state(
        "backyard", present=["An Ally"],
        house=_house(active=["An Ally", "A Schemer"]),
    )
    monkeypatch.setattr(orwell_engine, "get_game_state", lambda user=None: _async(state))
    transcript = (
        "The backyard was quiet under the string lights. "
        'A Schemer leans against the fence and mutters, "nobody suspects us yet." '
        "You kept your face still and changed the subject."
    )
    out = _run(chat_helpers.screen_presence_wall(_USER, transcript))
    assert "A Schemer" not in out               # the phantom placement is gone
    assert "The backyard was quiet" in out       # ordinary prose survives
    assert "changed the subject" in out
    # A next-turn re-ground is stashed after a drop.
    assert chat_helpers._DESYNC_REGROUND.get(chat_helpers._desync_key(_USER))


def test_scan_drops_the_sentence_staging_an_evicted_houseguest(monkeypatch):
    from src import orwell_engine
    state = _state(
        "living-room", present=["An Ally"],
        house=_house(active=["An Ally"], evicted=["A Ghost"]),
    )
    monkeypatch.setattr(orwell_engine, "get_game_state", lambda user=None: _async(state))
    transcript = 'A Ghost smirks from the couch, "did you miss me?" An Ally rolls her eyes.'
    out = _run(chat_helpers.screen_presence_wall(_USER, transcript))
    assert "did you miss me" not in out          # the evicted houseguest's staged line is gone
    assert "An Ally rolls her eyes" in out


def test_scan_passes_clean_narration_through_verbatim(monkeypatch):
    from src import orwell_engine
    state = _state(
        "kitchen", present=["An Ally", "A Neighbor"],
        house=_house(active=["An Ally", "A Neighbor", "A Schemer"]),
    )
    monkeypatch.setattr(orwell_engine, "get_game_state", lambda user=None: _async(state))
    clean = 'An Ally grins and says, "welcome to my kitchen." You both laugh about it.'
    out = _run(chat_helpers.screen_presence_wall(_USER, clean))
    assert out == clean  # byte-identical: nobody off-scene/evicted is staged


def test_scan_is_a_noop_when_nothing_is_offscene_or_evicted(monkeypatch):
    from src import orwell_engine
    # The whole (small) house is in view — nobody to guard against.
    state = _state("kitchen", present=["An Ally", "A Neighbor"],
                    house=_house(active=["An Ally", "A Neighbor"]))
    monkeypatch.setattr(orwell_engine, "get_game_state", lambda user=None: _async(state))
    text = 'A Neighbor says, "pass the salt."'
    out = _run(chat_helpers.screen_presence_wall(_USER, text))
    assert out == text


def test_scan_is_a_noop_without_a_live_scene(monkeypatch):
    from src import orwell_engine
    # Pre-game / player out of the house: no usable whereabouts.
    monkeypatch.setattr(orwell_engine, "get_game_state", lambda user=None: _async({"whereabouts": None}))
    text = 'A Schemer says, "hello?"'
    out = _run(chat_helpers.screen_presence_wall(_USER, text))
    assert out == text


def test_scan_is_fail_open_on_an_engine_read_error(monkeypatch):
    from src import orwell_engine

    async def _boom(user=None):
        raise RuntimeError("engine unreachable")

    monkeypatch.setattr(orwell_engine, "get_game_state", _boom)
    text = 'A Schemer says, "hello?"'
    out = _run(chat_helpers.screen_presence_wall(_USER, text))
    assert out == text  # never hold narration on a read hiccup


def test_scan_does_not_flag_a_nearby_houseguest(monkeypatch):
    from src import orwell_engine
    state = _state(
        "living-room", present=["An Ally"], nearby={"kitchen": ["A Neighbor"]},
        house=_house(active=["An Ally", "A Neighbor"]),
    )
    monkeypatch.setattr(orwell_engine, "get_game_state", lambda user=None: _async(state))
    text = 'A Neighbor calls out from the kitchen, "dinner in five!"'
    out = _run(chat_helpers.screen_presence_wall(_USER, text))
    assert out == text  # a nearby (glimpsed/overheard) houseguest is legitimate, never dropped


def test_scan_only_drops_the_offending_sentence_not_the_whole_scene(monkeypatch):
    from src import orwell_engine
    state = _state("backyard", present=["An Ally"], house=_house(active=["An Ally", "A Schemer"]))
    monkeypatch.setattr(orwell_engine, "get_game_state", lambda user=None: _async(state))
    transcript = (
        "An Ally settles into the lounge chair. "
        'A Schemer steps in and announces, "I run this house." '
        "The sprinklers click on in the distance."
    )
    out = _run(chat_helpers.screen_presence_wall(_USER, transcript))
    assert "An Ally settles into the lounge chair." in out
    assert "I run this house" not in out
    assert "The sprinklers click on in the distance." in out


def test_scan_fires_single_tenant_with_owner_none(monkeypatch):
    # Under AUTH_ENABLED=false the chat route runs with owner=None (NAR-1 safety).
    from src import orwell_engine
    state = _state("backyard", present=["An Ally"], house=_house(active=["An Ally", "A Schemer"]))
    monkeypatch.setattr(orwell_engine, "get_game_state", lambda user=None: _async(state))
    dkey = chat_helpers._desync_key(None)
    try:
        text = 'A Schemer leans in and says, "you can trust me." You nod slowly.'
        out = _run(chat_helpers.screen_presence_wall(None, text))
        assert "you can trust me" not in out
        assert "You nod slowly." in out
    finally:
        chat_helpers._DESYNC_REGROUND.pop(dkey, None)


# ── part (b): the inverse — an engine-present houseguest the narration omitted entirely ─────── #

def test_omission_flags_when_no_present_houseguest_is_mentioned_at_all():
    facts = {"room": "kitchen", "in_view": {"An Ally", "A Neighbor"},
             "room_present": {"An Ally", "A Neighbor"}, "active_offscene": set(), "evicted": set()}
    directive = chat_helpers._presence_omission_directive(
        "You wander into the empty-feeling kitchen and pour a glass of water alone.", facts)
    assert directive is not None
    assert "An Ally" in directive and "A Neighbor" in directive
    assert "never mentioned" in directive


def test_omission_does_not_flag_when_at_least_one_present_npc_appears():
    facts = {"room": "kitchen", "in_view": {"An Ally", "A Neighbor"},
             "room_present": {"An Ally", "A Neighbor"}, "active_offscene": set(), "evicted": set()}
    # Only ONE of the two present houseguests gets a line — legitimate spotlighting, not a swap.
    directive = chat_helpers._presence_omission_directive(
        'An Ally looks up from the counter and says, "morning."', facts)
    assert directive is None


def test_omission_is_none_when_nobody_is_present_in_the_room():
    facts = {"room": "kitchen", "in_view": set(), "room_present": set(),
             "active_offscene": {"A Schemer"}, "evicted": set()}
    assert chat_helpers._presence_omission_directive("You eat cereal alone.", facts) is None


def test_omission_bare_mention_counts_as_surfaced_not_only_staging():
    # A bare mention (no staging verb) is enough to prove the narration acknowledged them.
    facts = {"room": "kitchen", "in_view": {"An Ally"},
             "room_present": {"An Ally"}, "active_offscene": set(), "evicted": set()}
    directive = chat_helpers._presence_omission_directive(
        "You glance at An Ally across the room but say nothing.", facts)
    assert directive is None


def test_omission_still_fires_when_only_an_ambiguous_first_name_is_mentioned():
    # Greptile P1 (#1746): two roster members share the first name "Alex" — one PRESENT (Alex Kim),
    # one off-scene (Alex Diaz). Narration mentions only the bare, ambiguous first name "Alex". That
    # must NOT be credited to the present occupant (it could equally mean the off-scene one), so the
    # omission guard must still fire for the real room population — mirroring the same uniqueness bar
    # `_name_staged_unique` / `_presence_desync_directive` already apply on the drop side.
    facts = {"room": "kitchen", "in_view": {"Alex Kim"},
             "room_present": {"Alex Kim"}, "active_offscene": {"Alex Diaz"}, "evicted": set()}
    directive = chat_helpers._presence_omission_directive(
        "You wonder where Alex went as you wash a mug alone in the quiet kitchen.", facts)
    assert directive is not None
    assert "Alex Kim" in directive


def test_omission_does_not_fire_when_the_unique_full_name_is_mentioned():
    # The FULL name is never ambiguous — mentioning "Alex Kim" by full name still surfaces them even
    # though "Alex" alone is shared with the off-scene "Alex Diaz".
    facts = {"room": "kitchen", "in_view": {"Alex Kim"},
             "room_present": {"Alex Kim"}, "active_offscene": {"Alex Diaz"}, "evicted": set()}
    directive = chat_helpers._presence_omission_directive(
        "You spot Alex Kim by the sink and give a small wave.", facts)
    assert directive is None


def test_post_turn_check_stashes_the_omission_reground(monkeypatch):
    from src import orwell_engine
    state = _state("kitchen", present=["An Ally", "A Neighbor"],
                    house=_house(active=["An Ally", "A Neighbor"]))
    monkeypatch.setattr(orwell_engine, "get_game_state", lambda user=None: _async(state))
    dkey = chat_helpers._desync_key("u-omit")
    chat_helpers._LAST_BEAT_SIG["u-omit"] = {"room": "kitchen"}  # same room — not a move turn
    chat_helpers._DESYNC_REGROUND.pop(dkey, None)
    try:
        _run(chat_helpers.record_post_turn_presence_check(
            "u-omit", "You stand alone by the counter, lost in thought."))
        directive = chat_helpers._DESYNC_REGROUND.get(dkey)
        assert directive and "SURFACE WHO IS ACTUALLY HERE" in directive
    finally:
        chat_helpers._LAST_BEAT_SIG.pop("u-omit", None)
        chat_helpers._DESYNC_REGROUND.pop(dkey, None)


# ── the agent-loop wrapper is wired and fail-open ────────────────────────────────────────────── #

def test_agent_loop_wrapper_drops_the_phantom_placement(monkeypatch):
    agent_loop = importlib.import_module("src.agent_loop")
    from src import orwell_engine
    state = _state("backyard", present=["An Ally"], house=_house(active=["An Ally", "A Schemer"]))
    monkeypatch.setattr(orwell_engine, "get_game_state", lambda user=None: _async(state))
    text = 'A Schemer whispers, "watch your back." You stay silent.'
    out = _run(agent_loop._presence_wall_guard(text, _USER))
    assert "watch your back" not in out
    assert "You stay silent." in out


def test_agent_loop_wrapper_is_fail_open_on_empty():
    agent_loop = importlib.import_module("src.agent_loop")
    assert _run(agent_loop._presence_wall_guard("", _USER)) == ""
