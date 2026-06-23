"""Feature 0067 — the PRESENCE / IDENTITY desync guard (FE half, the "reconcile" piece).

The narrator inventing/teleporting houseguests into a scene is a closed-set FACT error (who is where /
who exists). Like the 0065 board guard, this is caught POST-TURN with a gentle next-turn re-ground —
never by editing live prose (presence prose has no crisp claim pattern; editing it would gut the
storytelling the open set owns). High-precision: it flags ONLY a houseguest STAGED as acting in the
scene who the engine places evicted or entirely off-scene (a nearby houseguest is never flagged), and
it skips a turn where the player changed rooms. Roles only — throwaway display names exercise it.
"""
import asyncio
import importlib

chat_helpers = importlib.import_module("routes.chat_helpers")


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


# ── _stages_in_scene: the staging detector ────────────────────────────────────────────────────

def test_staging_detects_action_and_speech_verbs():
    assert chat_helpers._stages_in_scene("Mara perched on the edge of the bunk.", "Mara")
    assert chat_helpers._stages_in_scene("Devon pauses mid-unpack and looks up.", "Devon")
    assert chat_helpers._stages_in_scene("Rik's leaning against the window frame.", "Rik")   # possessive
    assert chat_helpers._stages_in_scene("Tam's been watching the doorway fill up.", "Tam")  # aux filler
    assert chat_helpers._stages_in_scene('Lena: "I called this one."', "Lena")               # quoted line


def test_staging_ignores_a_bare_mention():
    # A name mentioned without staging them in the present scene must NOT match (else clean turns nag).
    assert not chat_helpers._stages_in_scene("I heard Mara won HOH last week.", "Mara")
    assert not chat_helpers._stages_in_scene("Remember when Devon left the house?", "Devon")
    assert not chat_helpers._stages_in_scene("Everyone trusts Lena more than me.", "Lena")


def test_staging_is_whole_token_only():
    # A name must match as a whole token, never a substring (no false hit inside another word).
    assert not chat_helpers._stages_in_scene("The marathon starts and Samuel grins.", "Mara")


# ── _presence_facts: building the in-view / off-scene / evicted sets ──────────────────────────

def test_presence_facts_splits_in_view_offscene_and_evicted():
    state = _state(
        "living-room", present=["An Ally"], nearby={"kitchen": ["A Neighbor"]},
        house=_house(active=["An Ally", "A Neighbor", "A Schemer"], evicted=["A Ghost"]),
    )
    facts = chat_helpers._presence_facts(state)
    assert facts["in_view"] == {"An Ally", "A Neighbor"}      # player's room + adjacent
    assert facts["active_offscene"] == {"A Schemer"}          # living but elsewhere
    assert facts["evicted"] == {"A Ghost"}


def test_presence_facts_is_none_pre_game():
    assert chat_helpers._presence_facts({"whereabouts": None}) is None
    assert chat_helpers._presence_facts({}) is None


# ── _presence_desync_directive: the gentle re-ground ──────────────────────────────────────────

def test_flags_an_offscene_houseguest_staged_in_scene():
    facts = {"room": "bedroom-a", "in_view": {"An Ally"},
             "active_offscene": {"A Schemer"}, "evicted": set()}
    # The Bedroom-A case: a houseguest the engine has in another (non-adjacent) room given a line.
    directive = chat_helpers._presence_desync_directive(
        'An Ally grins at you. A Schemer leans in the doorway. "What is this, a field trip?"', facts)
    assert directive is not None
    assert "A Schemer" in directive and "elsewhere" in directive
    assert "An Ally" not in directive  # the in-view houseguest is correctly NOT flagged


def test_flags_an_evicted_houseguest_voiced_as_present():
    facts = {"room": "living-room", "in_view": {"An Ally"},
             "active_offscene": set(), "evicted": {"A Ghost"}}
    directive = chat_helpers._presence_desync_directive("A Ghost smirks from the couch.", facts)
    assert directive is not None and "A Ghost" in directive and "EVICTED" in directive


def test_does_not_flag_a_nearby_houseguest():
    # A houseguest one room over is IN VIEW (glimpsed/overheard) — staging them is legitimate.
    facts = {"room": "living-room", "in_view": {"An Ally", "A Neighbor"},
             "active_offscene": set(), "evicted": set()}
    assert chat_helpers._presence_desync_directive("A Neighbor calls from the kitchen.", facts) is None


def test_clean_turn_yields_no_directive():
    facts = {"room": "living-room", "in_view": {"An Ally"},
             "active_offscene": {"A Schemer"}, "evicted": {"A Ghost"}}
    # Off-scene names only MENTIONED, never staged → no nag.
    assert chat_helpers._presence_desync_directive(
        "An Ally nods. You wonder where A Schemer and A Ghost stand.", facts) is None


# ── the post-turn entry point: skips, combines, fail-open ─────────────────────────────────────

def test_post_turn_skips_when_the_player_changed_rooms(monkeypatch):
    from src import orwell_engine
    monkeypatch.setattr(orwell_engine, "get_game_state", lambda user=None: _async(
        _state("bedroom-a", present=["An Ally"],
               house=_house(active=["An Ally", "A Schemer"]))))
    chat_helpers._LAST_BEAT_SIG["u"] = {"room": "kitchen"}  # the turn moved the player kitchen→bedroom-a
    chat_helpers._DESYNC_REGROUND.pop("u", None)
    _run(chat_helpers.record_post_turn_presence_check("u", "A Schemer grins at you."))
    assert "u" not in chat_helpers._DESYNC_REGROUND  # move turn ⇒ skipped, no false flag


def test_post_turn_stashes_and_combines_with_an_existing_directive(monkeypatch):
    from src import orwell_engine
    monkeypatch.setattr(orwell_engine, "get_game_state", lambda user=None: _async(
        _state("living-room", present=["An Ally"],
               house=_house(active=["An Ally", "A Schemer"]))))
    chat_helpers._LAST_BEAT_SIG["u2"] = {"room": "living-room"}  # same room — not a move turn
    chat_helpers._DESYNC_REGROUND["u2"] = "RE-GROUND ON THE BOARD — (a prior board directive)."
    _run(chat_helpers.record_post_turn_presence_check("u2", "A Schemer leans in the doorway."))
    combined = chat_helpers._DESYNC_REGROUND["u2"]
    assert "a prior board directive" in combined          # the board directive is preserved
    assert "A Schemer" in combined and "WHO IS IN THE ROOM" in combined  # presence appended
    chat_helpers._DESYNC_REGROUND.pop("u2", None)


def _async(value):
    async def _c(*a, **k):
        return value
    return _c()
