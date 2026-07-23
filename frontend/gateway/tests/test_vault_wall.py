"""Prove the gateway Vault Wall guards strip sealed content, phantom presences,
and inline-planning leaks from outbound replies.

CLAUDE.md mandate: "Secret state can never reach the player — enforced in code
at the port/tool boundary, never by prompt wording."  These tests PROVE the
gateway code boundary does the enforcement.
"""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch, MagicMock


# ── helpers ──────────────────────────────────────────────────────────────────


def _build_fake_engine(
    *,
    state: dict | None = None,
    moment_prompt: str | None = None,
    sealed: list[dict] | None = None,
    knowledge_scope: list[dict] | None = None,
) -> MagicMock:
    """Return a MagicMock that looks like the real ``src.orwell_engine`` module
    with all async methods the gateway path touches."""
    eng = MagicMock()
    eng.EngineToolError = type("EngineToolError", (Exception,), {"no_game": False})
    eng.get_game_state = AsyncMock(return_value=state or {})
    eng.get_moment_prompt = AsyncMock(
        return_value={"systemPrompt": moment_prompt or ""}
    )
    eng.sealed_from_house = AsyncMock(return_value=sealed or [])
    eng.knowledge_scope_manifest = AsyncMock(return_value=knowledge_scope or [])
    return eng


def _kw_fact(content: str, known_to: list[str] | None = None) -> dict:
    """Build a pre-processed sealed-fact entry (as returned by
    ``fetch_sealed_from_house``) suitable for patch return."""
    from routes.chat_helpers import _sealed_signatures

    sigs = _sealed_signatures(content)
    assert sigs, f"content {content!r} produced no signatures"
    return {
        "content": content,
        "knownTo": known_to or [],
        "signatures": sigs,
    }


# ── fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _clear_stores():
    """Clear process-local caches that can hold stale state across tests.
    Fail-soft if the module cannot be loaded (dev environment without deps).
    """
    try:
        import routes.chat_helpers as ch
        ch._KW_SEALED_CACHE.clear()
        ch._LAST_BEAT_SIG.clear()
    except ImportError:
        pass
    yield


# ── knowledge wall ───────────────────────────────────────────────────────────


class TestKnowledgeWall:
    """The knowledge wall guard must strip sealed Diary-Room secrets from
    a houseguest's narrated reply."""

    async def test_strips_sealed_diary_room_content(self):
        """A narrated reply where a houseguest voices a sealed Diary-Room
        secret must have the leaked sentence stripped."""
        from frontend.gateway.handler import _call_player_turn

        user = "test-user-dr"
        message = "What did I say in the Diary Room?"

        # A sealed Diary-Room secret: 'knownTo' empty ⇒ ANY staged houseguest
        # leaks it.  The shingle signature is built from content words with
        # stopwords removed; the narration must CONTAIN that signature as a
        # substring of its content-normalized form.
        sealed_content = "I am planning to backdoor the Head of Household"

        # Build a reply whose first sentence contains the sealed content and
        # stages a houseguest as speaking (the quote pattern: name + ':' + quoted
        # text triggers _stages_in_scene).
        leaked_reply = (
            'Ana: "Yes, I heard you were planning to backdoor the Head of '
            'Household."  Sam is reading in the corner.'
        )

        # Mock the engine so _call_player_turn can run
        eng = _build_fake_engine(
            state={"house": [{"name": "Ana", "status": "active"}, {"name": "Sam", "status": "active"}]},
            moment_prompt="The Diary Room is private.",
        )

        # Patch the engine import AND the chat_helpers functions we depend on
        # Inject the fake engine into sys.modules so the local `from src import orwell_engine`
        # inside `_call_player_turn` resolves to it.
        patches = [
            patch.dict("sys.modules", {"src.orwell_engine": eng}),
            patch("frontend.gateway.handler._narrate_gateway_turn",
                  AsyncMock(return_value=leaked_reply)),
            # Return a pre-processed fact with known signatures
            patch("routes.chat_helpers.fetch_sealed_from_house",
                  AsyncMock(return_value=[_kw_fact(sealed_content)])),
            # Active names roster so the guard can attribute speakers
            patch("routes.chat_helpers._kw_active_names",
                  return_value=["Ana", "Sam"]),
            # The guard stashes a re-ground directive — prevent cross-test contamination
            patch("routes.chat_helpers.stash_knowledge_wall_reground"),
        ]
        for p in patches:
            p.start()
        try:
            reply = await _call_player_turn(user, message)
        finally:
            for p in patches:
                p.stop()

        # The leaked sentence (Ana voicing the sealed secret) must be gone
        assert "backdoor" not in reply, (
            "sealed Diary-Room content reached the reply"
        )
        # Legitimate content that is not a leak survives
        assert "Sam is reading" in reply, (
            "legitimate narrative content was incorrectly stripped"
        )

    async def test_does_not_strip_legitimate_content(self):
        """A narrated reply with no sealed content must pass through intact."""
        from frontend.gateway.handler import _call_player_turn

        user = "test-user-no-seal"
        message = "What is everyone doing?"
        reply_text = (
            'Ana: "I am making coffee."  Sam is reading in the corner.'
        )

        eng = _build_fake_engine(
            state={"house": [{"name": "Ana", "status": "active"}, {"name": "Sam", "status": "active"}]},
            moment_prompt="The game is in daytime.",
        )

        patches = [
            patch.dict("sys.modules", {"src.orwell_engine": eng}),
            patch("frontend.gateway.handler._narrate_gateway_turn",
                  AsyncMock(return_value=reply_text)),
            # Nothing sealed this turn
            patch("routes.chat_helpers.fetch_sealed_from_house",
                  AsyncMock(return_value=[])),
        ]
        for p in patches:
            p.start()
        try:
            reply = await _call_player_turn(user, message)
        finally:
            for p in patches:
                p.stop()

        assert reply == reply_text, (
            "legitimate content was modified when nothing was sealed"
        )


# ── presence wall ────────────────────────────────────────────────────────────


class TestPresenceWall:
    """The presence wall must strip any sentence that stages an off-scene or
    evicted houseguest as present/acting in the player's scene."""

    async def test_strips_evicted_houseguest_from_scene(self):
        """A reply staging an evicted houseguest must have that sentence
        dropped."""
        from frontend.gateway.handler import _call_player_turn

        user = "test-user-evict"
        message = "Who is in the living room?"

        # Game state: Jordan is evicted, Alex and Sam are in the living room.
        # The reply stages Jordan (evicted) as acting.
        reply_with_phantom = (
            "Alex is reading on the couch. "
            "Jordan stands up and looks around the room. "
            "Sam is practicing guitar in the corner."
        )

        game_state = {
            "whereabouts": {
                "room": "living-room",
                "present": [
                    {"name": "Alex", "status": "active"},
                    {"name": "Sam", "status": "active"},
                ],
                "nearby": [],
            },
            "house": [
                {"name": "Alex", "status": "active"},
                {"name": "Sam", "status": "active"},
                {"name": "Jordan", "status": "evicted-week-2"},
            ],
        }

        eng = _build_fake_engine(
            state=game_state,
            moment_prompt="The houseguests are relaxing.",
        )

        patches = [
            patch.dict("sys.modules", {"src.orwell_engine": eng}),
            patch("frontend.gateway.handler._narrate_gateway_turn",
                  AsyncMock(return_value=reply_with_phantom)),
        ]
        for p in patches:
            p.start()
        try:
            reply = await _call_player_turn(user, message)
        finally:
            for p in patches:
                p.stop()

        # The evicted houseguest (Jordan) must be absent
        assert "Jordan stands" not in reply, (
            "evicted houseguest still staged as present"
        )
        # Legitimate houseguests survive
        assert "Alex is reading" in reply, (
            "legitimate houseguest action was stripped"
        )
        assert "Sam is practicing" in reply, (
            "legitimate houseguest action was stripped"
        )

    async def test_legitimate_scene_unchanged(self):
        """A reply with only in-view houseguests must pass through intact."""
        from frontend.gateway.handler import _call_player_turn

        user = "test-user-legit"
        message = "What is happening?"
        reply_text = "Alex is reading on the couch. Sam is practicing guitar."

        game_state = {
            "whereabouts": {
                "room": "living-room",
                "present": [
                    {"name": "Alex", "status": "active"},
                    {"name": "Sam", "status": "active"},
                ],
                "nearby": [],
            },
            "house": [
                {"name": "Alex", "status": "active"},
                {"name": "Sam", "status": "active"},
            ],
        }

        eng = _build_fake_engine(
            state=game_state,
            moment_prompt="Daytime in the house.",
        )

        patches = [
            patch.dict("sys.modules", {"src.orwell_engine": eng}),
            patch("frontend.gateway.handler._narrate_gateway_turn",
                  AsyncMock(return_value=reply_text)),
        ]
        for p in patches:
            p.start()
        try:
            reply = await _call_player_turn(user, message)
        finally:
            for p in patches:
                p.stop()

        assert reply == reply_text, (
            "legitimate scene content was incorrectly modified"
        )


# ── inline-planning scrub ────────────────────────────────────────────────────


class TestInlinePlanningScrub:
    """The inline-planning scrub must strip untagged planning monologue from
    the content channel (the GLM-4.7 pattern where reasoning_chars=0 and the
    model routes planning INTO the content)."""

    async def test_strips_planning_preamble(self):
        """A reply beginning with a model's internal planning preamble must
        have the planning sentence stripped."""
        from frontend.gateway.handler import _call_player_turn

        user = "test-user-plan"
        message = "What happens next?"

        # The model emits planning in the content channel with no reason tag.
        # The first sentence matches _INLINE_PLANNING_OPENER_RE patterns like
        # "I need to" + planning verb.
        planning_reply = (
            "I need to ground myself in the actual game state before I say "
            "anything else. The room falls quiet as Ana looks at you "
            "expectantly."
        )

        eng = _build_fake_engine(
            state={
                "whereabouts": {
                    "room": "kitchen",
                    "present": [{"name": "Ana", "status": "active"}],
                    "nearby": [],
                },
                "house": [{"name": "Ana", "status": "active"}],
            },
            moment_prompt="The kitchen is warm.",
        )

        patches = [
            patch.dict("sys.modules", {"src.orwell_engine": eng}),
            patch("frontend.gateway.handler._narrate_gateway_turn",
                  AsyncMock(return_value=planning_reply)),
        ]
        for p in patches:
            p.start()
        try:
            reply = await _call_player_turn(user, message)
        finally:
            for p in patches:
                p.stop()

        # The planning preamble must be gone
        assert "I need to ground myself" not in reply, (
            "inline planning preamble reached the player"
        )
        # The actual narration that follows must survive
        assert "room falls quiet" in reply, (
            "legitimate narration after planning was incorrectly stripped"
        )

    async def test_does_not_strip_regular_narration(self):
        """A normal narration without planning must pass through intact."""
        from frontend.gateway.handler import _call_player_turn

        user = "test-user-regular"
        message = "What happens next?"
        reply_text = (
            "The room falls quiet as Ana looks at you expectantly."
        )

        eng = _build_fake_engine(
            state={
                "whereabouts": {
                    "room": "kitchen",
                    "present": [{"name": "Ana", "status": "active"}],
                    "nearby": [],
                },
                "house": [{"name": "Ana", "status": "active"}],
            },
            moment_prompt="The kitchen is warm.",
        )

        patches = [
            patch.dict("sys.modules", {"src.orwell_engine": eng}),
            patch("frontend.gateway.handler._narrate_gateway_turn",
                  AsyncMock(return_value=reply_text)),
        ]
        for p in patches:
            p.start()
        try:
            reply = await _call_player_turn(user, message)
        finally:
            for p in patches:
                p.stop()

        assert reply == reply_text, (
            "regular narration was incorrectly modified"
        )


# ── fail-soft behaviour ─────────────────────────────────────────────────────


class TestFailSoft:
    """If any guard raises, the reply must pass through unchanged — a scrub
    hiccup never drops the reply."""

    async def test_knowledge_wall_failure_returns_original(self):
        """When screen_knowledge_wall raises, the original reply survives."""
        from frontend.gateway.handler import _call_player_turn

        user = "test-user-fail1"
        message = "hello"
        reply_text = "Hello! How can I help?"

        eng = _build_fake_engine(
            state={
                "whereabouts": {
                    "room": "living-room",
                    "present": [],
                    "nearby": [],
                },
                "house": [],
            },
            moment_prompt="Daytime.",
        )

        patches = [
            patch.dict("sys.modules", {"src.orwell_engine": eng}),
            patch("frontend.gateway.handler._narrate_gateway_turn",
                  AsyncMock(return_value=reply_text)),
            patch("routes.chat_helpers.screen_knowledge_wall",
                  AsyncMock(side_effect=RuntimeError("engine down"))),
        ]
        for p in patches:
            p.start()
        try:
            reply = await _call_player_turn(user, message)
        finally:
            for p in patches:
                p.stop()

        assert reply == reply_text, (
            "reply was dropped when knowledge wall raised"
        )

    async def test_presence_wall_failure_returns_original(self):
        """When screen_presence_wall raises, the original reply survives."""
        from frontend.gateway.handler import _call_player_turn

        user = "test-user-fail2"
        message = "hello"
        reply_text = "Hello! How can I help?"

        eng = _build_fake_engine(
            state={
                "whereabouts": {
                    "room": "living-room",
                    "present": [],
                    "nearby": [],
                },
                "house": [],
            },
            moment_prompt="Daytime.",
        )

        patches = [
            patch.dict("sys.modules", {"src.orwell_engine": eng}),
            patch("frontend.gateway.handler._narrate_gateway_turn",
                  AsyncMock(return_value=reply_text)),
            patch("routes.chat_helpers.screen_presence_wall",
                  AsyncMock(side_effect=RuntimeError("engine down"))),
        ]
        for p in patches:
            p.start()
        try:
            reply = await _call_player_turn(user, message)
        finally:
            for p in patches:
                p.stop()

        assert reply == reply_text, (
            "reply was dropped when presence wall raised"
        )

    async def test_inline_planning_scrub_failure_returns_original(self):
        """When _scrub_inline_planning_leak raises, the original reply survives."""
        from frontend.gateway.handler import _call_player_turn

        user = "test-user-fail3"
        message = "hello"
        reply_text = "Hello! How can I help?"

        eng = _build_fake_engine(
            state={
                "whereabouts": {
                    "room": "living-room",
                    "present": [],
                    "nearby": [],
                },
                "house": [],
            },
            moment_prompt="Daytime.",
        )

        patches = [
            patch.dict("sys.modules", {"src.orwell_engine": eng}),
            patch("frontend.gateway.handler._narrate_gateway_turn",
                  AsyncMock(return_value=reply_text)),
            patch("src.agent_loop._scrub_inline_planning_leak",
                  side_effect=RuntimeError("crash")),
        ]
        for p in patches:
            p.start()
        try:
            reply = await _call_player_turn(user, message)
        finally:
            for p in patches:
                p.stop()

        assert reply == reply_text, (
            "reply was dropped when inline-planning scrub raised"
        )
