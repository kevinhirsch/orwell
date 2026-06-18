"""Feature 0057 (chunk 4) — the post-season producers' re-approach.

When a season is over and the player ESCAPES the reunion into off-finale free chat, the producers
re-approach OUT OF FICTION and re-invite them to the next season. It mirrors the existing
stall-nudge: ENGAGEMENT-driven (never a wall-clock timer — the game clock is the play-clock),
escalating across turns, capped, persisted per user, and routed only through the sanctioned
"New season" door (never an improvised in-chat season).

Source-pins (the behavior runs against the real engine in the play-through harness) + behavioral
checks of the pure helpers. Name-agnostic — no houseguest names anywhere.
"""
import importlib
import os

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*rel):
    with open(os.path.join(FRONTEND, *rel), encoding="utf-8") as f:
        return f.read()


# ── source-pins ─────────────────────────────────────────────────────────────────────────────

def test_reapproach_config_present():
    js = _read("src", "agent_loop.py")
    assert "_REAPPROACH_NUDGES = [" in js
    # three graduated rungs: light → more direct → the standing offer
    assert js.count("# 1 — light") == 1
    assert "_MAX_REAPPROACH_NUDGES_PER_TURN" in js          # in-loop cap
    assert "_REAPPROACH_LEVEL" in js                        # persisted cross-turn escalation
    assert "_POSTSEASON_OFFTOPIC_TURNS" in js               # the engagement counter
    assert "_POSTSEASON_OFFTOPIC_TURNS_BEFORE_REAPPROACH" in js


def test_reapproach_is_out_of_fiction_and_routes_through_the_button():
    js = _read("src", "agent_loop.py")
    # the nudge is out-of-fiction (producer in the real world, not a houseguest) and points the
    # player at the sanctioned "New season" button — never an improvised in-chat season.
    assert "OUT of fiction" in js or "out of fiction" in js
    assert "New season" in js
    assert "Do NOT improvise a new season" in js or "Never start a season yourself" in js


def test_reapproach_fires_only_post_season_after_an_escape():
    js = _read("src", "agent_loop.py")
    # gated on the live game's terminal moment AND the player having wandered off the reunion
    assert '_moment == "post-season"' in js
    assert "_player_escaped_reunion(messages)" in js
    # engagement-driven: a couple of OFF-FINALE turns before the invite, escalating + capped
    assert "_off >= _POSTSEASON_OFFTOPIC_TURNS_BEFORE_REAPPROACH" in js
    assert "_turn_reapproach_nudges < _MAX_REAPPROACH_NUDGES_PER_TURN" in js
    assert "_REAPPROACH_NUDGES[min(_level" in js


def test_reapproach_state_resets_when_leaving_post_season():
    js = _read("src", "agent_loop.py")
    # a new season (moment no longer post-season) forgets the per-user re-approach state
    assert "_POSTSEASON_OFFTOPIC_TURNS.pop(owner" in js
    assert "_REAPPROACH_LEVEL.pop(owner" in js


def test_reapproach_is_not_a_wall_clock_timer():
    # The trigger must be engagement (off-finale turns), never elapsed time.
    js = _read("src", "agent_loop.py")
    # the helper counts the player's turns; no time.sleep / wall-clock gate drives the nudge
    reapproach_block = js[js.index("_REAPPROACH_NUDGES = ["):js.index("_player_escaped_reunion")]
    assert "time.time" not in reapproach_block
    assert "sleep" not in reapproach_block


# ── behavioral: the escape detector ───────────────────────────────────────────────────────────

def test_escaped_reunion_detection():
    al = importlib.import_module("src.agent_loop")
    mk = lambda txt: [{"role": "user", "content": txt}]
    # STILL in the reunion (paying off the season just played) → NOT an escape
    assert not al._player_escaped_reunion(mk("who did the jury vote for at the finale?"))
    assert not al._player_escaped_reunion(mk("can we open the producer's vault and look back?"))
    assert not al._player_escaped_reunion(mk("why did that eviction go the way it did?"))
    # wandered OFF into free chat → an escape
    assert al._player_escaped_reunion(mk("anyway, what do you like to do for fun?"))
    assert al._player_escaped_reunion(mk("tell me a joke"))
    # silence / an empty turn reads as drift
    assert al._player_escaped_reunion([])


def test_reapproach_threshold_is_a_couple_of_turns():
    al = importlib.import_module("src.agent_loop")
    # a couple of escaped turns, not an instant nudge on the first off-topic line
    assert al._POSTSEASON_OFFTOPIC_TURNS_BEFORE_REAPPROACH >= 2
    # escalation rungs exist and are capped by their own length
    assert len(al._REAPPROACH_NUDGES) >= 3
