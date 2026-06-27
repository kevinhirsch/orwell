"""F16 / #1014 / #1045 — the outcome desync guard must fire SINGLE-TENANT (`owner=None`).

A real-LLM eviction playthrough leaked a premature vote tally to the player ("Seven votes to evict
X … that's the majority", "By a vote of ten…") BEFORE the engine committed those ballots. The engine's
reveal was correct; the MODEL narrated ahead, and the FE guard that should HOLD such a premature
closed-set claim never fired.

Root cause: the 0065 desync guard has two OUTER layers in `agent_loop.py` that BOTH early-returned on
a falsy `owner`:

  1. `_pre_emission_outcome_guard(text, owner)` — `if not text or not owner: return text`;
  2. the post-turn beat-signature checkpoint — `if _is_live_game and owner:`.

#1045 already fixed the INNER key (`chat_helpers._desync_key(None)` → the canonical game-session id
`gs:<session>`), so `screen_streamed_outcome` / `record_post_turn_desync_check` CAN operate
single-tenant. But they were UNREACHABLE: both outer gates bailed on `not owner` first. With
`AUTH_ENABLED=false` (a legitimate home deploy), `owner=None` every turn, so neither guard ran and a
premature tally streamed un-held.

This fix drops the `not owner` bail at both gates (fail-open now keys on absent TEXT / game context,
never on absent owner) and lets the #1045 session-keyed inner helpers do the work. These tests pin
that the guard now:

  • HOLDS a premature closed-set tally claim with `owner=None` (fail-before: it streamed through);
  • REACHES the post-turn desync check with `owner=None` for a live-game turn (was skipped before);
  • still streams a no-closed-set-claim turn byte-identically with `owner=None` (fail-open preserved);
  • never weakens cross-user isolation (a real owner keys on its own identity — covered alongside in
    test_fe_fixes_1045_1034_1019.py::test_cross_user_isolation_preserved).

Roles only: throwaway proper nouns inside narration strings exercise the regexes, never canonical cast.
"""

import asyncio
import importlib
import os

import pytest

chat_helpers = importlib.import_module("routes.chat_helpers")
orwell_engine = importlib.import_module("src.orwell_engine")
orwell_game_session = importlib.import_module("src.orwell_game_session")
agent_loop = importlib.import_module("src.agent_loop")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# The single-tenant canonical session id the FE resolves when `owner=None`, and the desync-store key
# `_desync_key(None)` derives from it (#1045). Both the pre-emission and post-turn layers read/write
# their per-turn signature under THIS key when there is no owner.
_SESSION = "sess-single-tenant"
_KEY = "gs:" + _SESSION


@pytest.fixture(autouse=True)
def _single_tenant(monkeypatch):
    """Bind the userless canonical session so `_desync_key(None) == 'gs:<session>'`, and scrub the
    desync stores around each test."""
    monkeypatch.setattr(orwell_game_session, "get_game_session", lambda user: _SESSION)
    chat_helpers._LAST_BEAT_SIG.pop(_KEY, None)
    chat_helpers._DESYNC_REGROUND.pop(_KEY, None)
    chat_helpers._LAST_BEAT_SIG.pop(None, None)
    chat_helpers._DESYNC_REGROUND.pop(None, None)
    yield
    chat_helpers._LAST_BEAT_SIG.pop(_KEY, None)
    chat_helpers._DESYNC_REGROUND.pop(_KEY, None)
    chat_helpers._LAST_BEAT_SIG.pop(None, None)
    chat_helpers._DESYNC_REGROUND.pop(None, None)


def _evict_sig(**kw):
    base = {"week": 1, "phase": "eviction", "pending": None, "hoh": "npc:1",
            "noms": ["npc:2", "npc:3"], "vetoHolder": None, "vetoUsed": False,
            "evicted": 0, "finished": False}
    base.update(kw)
    return base


def _board_fakes(monkeypatch, *, phase="eviction", evicted=0, finished=False, week=1):
    """A stable eviction-phase board where the evicted count does NOT move, so any eviction/tally
    claim narrated during the eviction phase is a phantom the engine never committed. The fakes
    accept `user=None` (single-tenant) exactly as the engine does under AUTH_ENABLED=false."""
    house = [{"id": "player", "status": "active"}, {"id": "npc:2", "status": "active"}]
    for i in range(evicted):
        house.append({"id": f"npc:{100 + i}", "status": "evicted"})

    async def fake_status(user=None):
        return {"week": week, "phase": phase, "hoh": {"id": "npc:1"},
                "nominees": [{"id": "npc:2"}, {"id": "npc:3"}],
                "veto": {"holder": None, "used": False, "players": []},
                "pending": None, "beatSeq": 7}

    async def fake_state(user=None, **kw):
        return {"week": week, "phase": phase, "finished": finished, "house": house, "beatSeq": 7}

    monkeypatch.setattr(orwell_engine, "game_status", fake_status)
    monkeypatch.setattr(orwell_engine, "get_game_state", fake_state)


# ════════════════════════════════════════════════════════════════════════════
#  Layer 1 — _pre_emission_outcome_guard HOLDS a premature claim with owner=None
# ════════════════════════════════════════════════════════════════════════════

def test_pre_emission_guard_holds_premature_tally_with_owner_none(monkeypatch):
    """THE #1014 REGRESSION (layer 1). A premature running-vote tally ("Seven votes to evict X …
    that's the majority") narrated during the eviction phase BEFORE the engine commits the eviction
    is DROPPED by `_pre_emission_outcome_guard` even though `owner=None`.

    Fail-before: on main the guard's `if not text or not owner` bail returned the text untouched, so
    the tally streamed to the player. Pass-after: the bail is gone, the #1045 session-keyed inner
    screen runs, and the phantom sentence is held."""
    # The baseline the framing checkpoint stashed this userless turn (engine has NOT yet committed).
    chat_helpers._LAST_BEAT_SIG[_KEY] = _evict_sig(phase="eviction", evicted=0)
    _board_fakes(monkeypatch, phase="eviction", evicted=0)

    text = ("The living room is dead silent. "
            "Seven votes to evict Phoebe, three for Yara — that's the majority. "
            "Outside, the cameras keep rolling.")
    out = _run(agent_loop._pre_emission_outcome_guard(text, None))

    # The phantom tally sentence is dropped before the player ever sees it…
    assert "Seven votes to evict" not in out
    assert "that's the majority" not in out
    # …while the surrounding creative prose still streams (sentence granularity, delimiters intact).
    assert "The living room is dead silent." in out
    assert "the cameras keep rolling" in out
    # And the next-turn re-ground backstop was stashed under the session key (not under None).
    assert _KEY in chat_helpers._DESYNC_REGROUND
    assert "RE-GROUND" in chat_helpers._DESYNC_REGROUND[_KEY]


def test_pre_emission_guard_holds_committed_count_with_owner_none(monkeypatch):
    """A "By a vote of ten…" committed-count phrasing narrated ahead of the engine commit is held
    single-tenant too — the engine never hands the player a count (anonymized ballots only)."""
    chat_helpers._LAST_BEAT_SIG[_KEY] = _evict_sig(phase="eviction", evicted=0)
    _board_fakes(monkeypatch, phase="eviction", evicted=0)

    out = _run(agent_loop._pre_emission_outcome_guard(
        "By a vote of ten to one, you have been evicted from the Big Brother house.", None))
    assert out.strip() == "", "the premature committed-eviction sentence must be held"
    assert _KEY in chat_helpers._DESYNC_REGROUND


# ════════════════════════════════════════════════════════════════════════════
#  Layer 2 — record_post_turn_desync_check is REACHED with owner=None
# ════════════════════════════════════════════════════════════════════════════

def test_post_turn_desync_check_reached_with_owner_none(monkeypatch):
    """THE #1014 REGRESSION (layer 2). The post-turn beat-signature checkpoint was gated on
    `_is_live_game and owner`, so single-tenant (`owner=None`) it never ran. Driven with `owner=None`
    and a live eviction-phase board that did NOT move, a turn that narrated an eviction must leave a
    re-ground directive queued under the session key — proving the check was REACHED.

    Fail-before: skipped entirely (no directive). Pass-after: the directive is stashed."""
    chat_helpers._LAST_BEAT_SIG[_KEY] = _evict_sig(phase="eviction", evicted=0)
    _board_fakes(monkeypatch, phase="eviction", evicted=0)  # board never committed the eviction

    _run(chat_helpers.record_post_turn_desync_check(
        None, "The house is stunned — by a unanimous vote, the houseguest is evicted tonight."))

    assert _KEY in chat_helpers._DESYNC_REGROUND, \
        "the post-turn desync check must be REACHED and stash a re-ground when owner is None"
    assert "RE-GROUND" in chat_helpers._DESYNC_REGROUND[_KEY]


def test_post_turn_desync_check_clean_turn_owner_none(monkeypatch):
    """A real, committed eviction narrated single-tenant leaves NO re-ground (the check ran and the
    board backed the claim) — proving REACHED-but-correct, not REACHED-and-over-eager."""
    chat_helpers._LAST_BEAT_SIG[_KEY] = _evict_sig(phase="eviction", evicted=0)
    _board_fakes(monkeypatch, phase="eviction", evicted=1)  # someone really left

    _run(chat_helpers.record_post_turn_desync_check(
        None, "After the vote, one houseguest is evicted and walks out the front door."))
    assert _KEY not in chat_helpers._DESYNC_REGROUND


# ════════════════════════════════════════════════════════════════════════════
#  Fail-open preserved — a no-closed-set-claim turn streams byte-identically
# ════════════════════════════════════════════════════════════════════════════

def test_creative_turn_streams_unchanged_with_owner_none(monkeypatch):
    """ADR 0005 #1 (hard): with `owner=None`, a turn of pure creative/social play (no closed-set
    claim) streams BYTE-IDENTICALLY and never touches the engine. We prove the no-engine-touch by
    making the board reads raise — the guard must still return the text verbatim."""
    chat_helpers._LAST_BEAT_SIG[_KEY] = _evict_sig(phase="social", evicted=0)

    async def boom(user=None, **kw):
        raise AssertionError("the guard read the board for pure creative prose with owner=None")

    monkeypatch.setattr(orwell_engine, "game_status", boom)
    monkeypatch.setattr(orwell_engine, "get_game_state", boom)

    text = ("The player drapes a bedsheet over their shoulders and narrates the backyard as a doomed "
            "ocean liner. Everyone is laughing too hard to remember it is a competition.")
    out = _run(agent_loop._pre_emission_outcome_guard(text, None))
    assert out == text
    assert _KEY not in chat_helpers._DESYNC_REGROUND


def test_creative_turn_post_check_no_reground_with_owner_none(monkeypatch):
    """The post-turn check, single-tenant, leaves a creative turn's queue empty (open set untouched)."""
    chat_helpers._LAST_BEAT_SIG[_KEY] = _evict_sig(phase="social", evicted=0)
    _board_fakes(monkeypatch, phase="social", evicted=0)

    _run(chat_helpers.record_post_turn_desync_check(
        None, "They linger by the pool trading quiet reads; nothing is decided tonight."))
    assert _KEY not in chat_helpers._DESYNC_REGROUND


def test_pre_emission_guard_fail_open_when_no_session_binding(monkeypatch):
    """Hardest fail-open: `owner=None` AND no canonical session binding yet → `_desync_key` falls
    soft to the raw (None) user, no baseline exists, so a closed-set claim still EMITS (we cannot tell
    phantom from real). The guard must never crash on the userless/unbound path."""
    monkeypatch.setattr(orwell_game_session, "get_game_session", lambda user: None)
    chat_helpers._LAST_BEAT_SIG.pop(None, None)
    _board_fakes(monkeypatch, phase="eviction", evicted=0)

    text = "After the vote, one houseguest is evicted from the house."
    out = _run(agent_loop._pre_emission_outcome_guard(text, None))
    assert out == text  # fail-open: no baseline → emit, no crash


# ════════════════════════════════════════════════════════════════════════════
#  Source-pins — the two outer gates no longer bail on a falsy owner
# ════════════════════════════════════════════════════════════════════════════

def _read_src(*parts):
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, *parts), encoding="utf-8") as fh:
        return fh.read()


def test_pre_emission_guard_no_longer_bails_on_falsy_owner():
    """Layer 1 source-pin: `_pre_emission_outcome_guard` opens by bailing ONLY on absent text — the
    `not owner` early-return that made it inert single-tenant is gone."""
    src = _read_src("src", "agent_loop.py")
    defn = src.index("async def _pre_emission_outcome_guard(")
    # Span to the first executable bail (just past the docstring) — wide enough to clear the docstring.
    body = src[defn:defn + 2600]
    assert "if not text:" in body
    assert "if not text or not owner:" not in body


def test_post_turn_desync_layer_gated_on_live_game_alone():
    """Layer 2 source-pin: the post-turn desync + presence checks ride `if _is_live_game:` (no
    `and owner`), so they fire single-tenant. The non-desync belts stay `owner`-gated separately."""
    src = _read_src("src", "agent_loop.py")
    desync = src.index("record_post_turn_desync_check(")
    head = src.rindex("if _is_live_game:", 0, desync)
    assert "if _is_live_game and owner:" not in src[head:desync]
    # the presence layer rides the same live-game-alone gate (combines with the board re-ground).
    assert "record_post_turn_presence_check(" in src[head:desync + 1200]
