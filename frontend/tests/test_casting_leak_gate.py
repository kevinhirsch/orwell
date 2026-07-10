"""Vault Wall — casting-interview leak gate (P0 regression gate).

The pre-game CASTING INTERVIEW (feature 0050) is an OOC, producer-level channel — like the
Diary Room, it has NO in-game pathway to any NPC's knowledge. A live playtest showed the
player's private casting answers (strategy, targets, OOC reads) leaking into the in-game
narrator's LLM context, so the houseguests referenced them once the game started. The model
"cannot leak what it never receives": once a season is live, the in-game narration context
must EXCLUDE the casting-interview turns. The player still SEES them in scrollback (one
continuous conversation, per #375) — but the narrator never receives them.

This is the permanent structural gate for that boundary. It fails on the old behavior (the
full transcript, casting turns included, fed to the in-game narrator) and passes on the fix
(casting turns stamped `phase=casting` and excluded once `game_active`).

Roles only — no houseguest/player names. The sentinel is a unique, non-game token so a leak
is unambiguous.
"""

import asyncio
import importlib
import os
import tempfile
import types

import pytest

chat_helpers = importlib.import_module("routes.chat_helpers")
core_models = importlib.import_module("core.models")
from core.models import Session, ChatMessage  # noqa: E402

# A unique phrase that ONLY ever appears in the player's private casting answers. If it shows
# up in the in-game narrator context, the casting interview leaked.
CASTING_SENTINEL = "ZZ-CASTING-SECRET-target-the-comp-beast-week-one-ZZ"
INGAME_TOKEN = "in-game move the player makes after the doors open"

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ─────────────────────────────────────────────────────────────────────────────
# 1. The filter mechanism — get_context_messages(exclude_phases=...)
#    The in-game narrator context drops casting turns; display/pre-game keeps them.
# ─────────────────────────────────────────────────────────────────────────────

def _seed_session() -> Session:
    """A session whose history mixes the OOC casting interview with live-game turns."""
    return Session(
        id="s", name="n", endpoint_url="u", model="m",
        history=[
            ChatMessage("user", f"my private strategy: {CASTING_SENTINEL}",
                        metadata={"phase": "casting"}),
            ChatMessage("assistant", "producer: love it, welcome to the cast",
                        metadata={"phase": "casting"}),
            ChatMessage("user", INGAME_TOKEN, metadata={}),
            ChatMessage("assistant", "narrator: the houseguests gather", metadata={}),
        ],
    )


def test_in_game_context_excludes_the_casting_interview():
    sess = _seed_session()
    ingame = sess.get_context_messages(exclude_phases={"casting"})
    blob = " ".join(m["content"] for m in ingame)
    # The Vault Wall: the player's private casting answer never reaches the in-game narrator.
    assert CASTING_SENTINEL not in blob, "casting interview leaked into the in-game context"
    # The live play is still present — the fix scopes context, it does not erase the game.
    assert INGAME_TOKEN in blob


def test_pre_game_and_display_paths_keep_the_full_transcript():
    sess = _seed_session()
    # Pre-game / casting turns (no exclusion) and every display/history path see everything —
    # the player always sees their own interview in scrollback.
    full = sess.get_context_messages()
    assert CASTING_SENTINEL in " ".join(m["content"] for m in full)
    assert len(full) == 4
    # The raw history (what the transcript renders) is untouched.
    assert any(CASTING_SENTINEL in m.content for m in sess.history)


def test_default_exclusion_is_off_so_non_game_chats_are_unaffected():
    # No phases ⇒ identical to the legacy behavior (only the slash filter applies).
    sess = _seed_session()
    assert sess.get_context_messages(exclude_phases=None) == sess.get_context_messages()


# ─────────────────────────────────────────────────────────────────────────────
# 2. The boundary wiring — build_chat_context stamps casting turns and, once the
#    game is live, builds the model context WITHOUT them. Drives the REAL function.
# ─────────────────────────────────────────────────────────────────────────────

class _FakePreprocessed:
    def __init__(self, text):
        self.enhanced_message = text
        self.user_content = text
        self.text_for_context = text
        self.youtube_transcripts = []
        self.attachment_meta = []


class _FakeChatHandler:
    def update_session_name_if_needed(self, sess, text):
        pass


class _FakeChatProcessor:
    _last_used_memories = []

    def build_context_preface(self, **kwargs):
        # (preface, rag_sources, web_sources)
        return ([{"role": "system", "content": "GM-FRAME"}], [], [])


async def _drive_build_chat_context(monkeypatch, *, started: bool, new_user_text: str):
    """Run the REAL build_chat_context against a seeded session, with leaf collaborators
    stubbed and the engine's started-state forced. Returns (ctx, sess)."""
    # No session manager: history + the phase stamp stay in-memory (enough to exercise the
    # real stamp + real exclusion). DB durability is covered separately below.
    monkeypatch.setattr(core_models, "_session_manager", None, raising=False)

    sess = Session(
        id="s2", name="n", endpoint_url="http://x", model="m",
        history=[
            ChatMessage("user", f"private read: {CASTING_SENTINEL}",
                        metadata={"phase": "casting", "_db_id": "a"}),
            ChatMessage("assistant", "producer reply", metadata={"phase": "casting", "_db_id": "b"}),
        ],
    )

    # Force the engine boundary: started=True ⇒ in-game; started=False ⇒ casting.
    async def fake_framing(preface, user, incognito=False, **kwargs):
        return (True, started, False)  # (engine_available, game_active, feed_down)

    monkeypatch.setattr(chat_helpers, "apply_game_framing", fake_framing)
    monkeypatch.setattr(chat_helpers, "extract_preset", lambda ch, pid: chat_helpers.PresetInfo(
        temperature=None, max_tokens=None, system_prompt=None, character_name=None))

    async def fake_preprocess(*a, **k):
        return _FakePreprocessed(new_user_text)

    monkeypatch.setattr(chat_helpers, "preprocess", fake_preprocess)
    monkeypatch.setattr(chat_helpers, "fire_message_event", lambda *a, **k: None)
    monkeypatch.setattr("src.auth_helpers.effective_user", lambda req: "u")
    monkeypatch.setattr(chat_helpers, "load_prefs_for_user", lambda u: {})
    monkeypatch.setattr(chat_helpers, "front_end_context_sources",
                        lambda incognito=False: {"memory": False, "skills": False, "rag": False, "web": False})
    monkeypatch.setattr(chat_helpers, "_normalize_model_id_from_cache", lambda s: None)
    monkeypatch.setattr(chat_helpers, "normalize_model_id", lambda url, model: None)

    async def fake_compact(sess, url, model, messages, headers, owner=None):
        return messages, 8000, False

    monkeypatch.setattr(chat_helpers, "maybe_compact", fake_compact)
    monkeypatch.setattr(chat_helpers, "trim_for_context", lambda messages, ctx_len: messages)

    ctx = await chat_helpers.build_chat_context(
        sess, request=object(), chat_handler=_FakeChatHandler(),
        chat_processor=_FakeChatProcessor(), message=new_user_text, session_id="s2",
        use_enhanced_message=True,
    )
    return ctx, sess


def test_live_game_turn_strips_casting_from_the_model_context(monkeypatch):
    ctx, sess = _run(_drive_build_chat_context(
        monkeypatch, started=True, new_user_text="I sidle up to the kitchen and chat"))
    assert ctx.game_active is True
    blob = " ".join(
        (m["content"] if isinstance(m["content"], str) else str(m["content"]))
        for m in ctx.messages
    )
    # THE GATE: the in-game narrator's context never carries the casting interview.
    assert CASTING_SENTINEL not in blob, "build_chat_context leaked the casting interview in-game"
    # The new live user turn IS in the model context (play still flows).
    assert "kitchen" in blob


def test_pre_game_turn_stamps_casting_and_keeps_the_interview(monkeypatch):
    ctx, sess = _run(_drive_build_chat_context(
        monkeypatch, started=False, new_user_text="here's how I'd play it"))
    assert ctx.game_active is False
    # The just-added user message is stamped casting (so the NEXT, live turn excludes it).
    assert sess.history[-1].role == "user"
    assert (sess.history[-1].metadata or {}).get("phase") == "casting"
    # Pre-game, the producer still sees the whole interview (the prior casting answers stay).
    blob = " ".join(
        (m["content"] if isinstance(m["content"], str) else str(m["content"]))
        for m in ctx.messages
    )
    assert CASTING_SENTINEL in blob


# ─────────────────────────────────────────────────────────────────────────────
# 3. The assistant-reply plumbing — save_assistant_response(phase=...) stamps, and
#    both chat-route call sites pass the casting phase when pre-game.
# ─────────────────────────────────────────────────────────────────────────────

def test_save_assistant_response_stamps_the_casting_phase(monkeypatch):
    monkeypatch.setattr(core_models, "_session_manager", None, raising=False)
    sess = Session(id="s3", name="n", endpoint_url="u", model="m", history=[])

    captured = {}

    class _SM:
        def save_sessions(self):
            captured["saved"] = True

    monkeypatch.setattr("core.database.update_session_last_accessed", lambda sid: None)
    chat_helpers.save_assistant_response(
        sess, _SM(), "s3", "producer: you're cast!", None, phase="casting")
    assert sess.history[-1].metadata.get("phase") == "casting"

    # Default: no phase ⇒ an ordinary reply carries no phase marker.
    chat_helpers.save_assistant_response(sess, _SM(), "s3", "ordinary reply", None)
    assert "phase" not in (sess.history[-1].metadata or {})


def test_both_route_save_sites_pass_the_casting_phase():
    """Drift guard: both save_assistant_response call sites in the chat route stamp the
    casting phase for an OOC pre-game reply (so the agent + chat branches both wall it)."""
    with open(os.path.join(FRONTEND, "routes", "chat_routes.py"), encoding="utf-8") as f:
        src = f.read()
    occurrences = src.count(
        'phase=("casting" if (ctx.framed and not ctx.game_active) else None)')
    assert occurrences == 2, f"expected both route save sites to pass the casting phase, got {occurrences}"


def test_build_chat_context_wires_the_in_game_exclusion():
    """Drift guard for the boundary: build_chat_context excludes casting turns once the
    game is live, and stamps the user turn casting pre-game."""
    with open(os.path.join(FRONTEND, "routes", "chat_helpers.py"), encoding="utf-8") as f:
        src = f.read()
    assert '_exclude_phases = {"casting"} if game_active else None' in src
    assert "exclude_phases=_exclude_phases" in src
    assert 'mark_message_phase(_last, "casting")' in src
    # #530: the STRUCTURAL pre-game cut is wired (exclude_pre_game) and the live boundary is stamped.
    assert "exclude_pre_game=bool(game_active)" in src
    assert 'mark_message_phase(_last, "game")' in src


# ─────────────────────────────────────────────────────────────────────────────
# 5. #530 STRUCTURAL — an UNSTAMPED pre-game (casting) turn must STILL be excluded
#    once the game is live, so a missed `casting` stamp at the finalize boundary
#    can never leak the interview to the in-game narrator.
# ─────────────────────────────────────────────────────────────────────────────

def test_unstamped_pre_game_turn_is_still_excluded_structurally():
    # The stamp MISSED on the casting turns (metadata empty). The only durable signal is the
    # live `game` boundary on the first in-game user turn. The structural cut must still drop
    # every pre-game turn before that boundary — the unstamped casting answer included.
    sess = Session(
        id="s5", name="n", endpoint_url="u", model="m",
        history=[
            # UNSTAMPED casting interview (the bug: the phase stamp never landed).
            ChatMessage("user", f"private read: {CASTING_SENTINEL}", metadata={}),
            ChatMessage("assistant", "producer: welcome to the cast", metadata={}),
            # The season went live — this live user turn carries the `game` boundary stamp.
            ChatMessage("user", INGAME_TOKEN, metadata={"phase": "game"}),
            ChatMessage("assistant", "narrator: the houseguests gather", metadata={}),
        ],
    )
    ingame = sess.get_context_messages(exclude_phases={"casting"}, exclude_pre_game=True)
    blob = " ".join(m["content"] for m in ingame)
    assert CASTING_SENTINEL not in blob, "unstamped casting turn leaked into the in-game context"
    # Live play from the boundary onward is intact.
    assert INGAME_TOKEN in blob
    assert "houseguests gather" in blob


def test_pre_game_path_keeps_unstamped_interview_when_not_live():
    # Before the season is live (no `exclude_pre_game`), the full interview is still visible to
    # the producer channel — the cut is scoped to live turns only.
    sess = Session(
        id="s6", name="n", endpoint_url="u", model="m",
        history=[ChatMessage("user", f"private: {CASTING_SENTINEL}", metadata={})],
    )
    full = sess.get_context_messages(exclude_phases=None, exclude_pre_game=False)
    assert CASTING_SENTINEL in " ".join(m["content"] for m in full)


# ─────────────────────────────────────────────────────────────────────────────
# 6. #1312 THE FINALIZE→PREMIERE TRANSITION TURN — the one turn build_chat_context's
#    game_active exclusion cannot cover. apply_game_framing computes game_active at
#    turn-START (False, pre-game), so build_chat_context keeps the casting interview;
#    then createCharacter starts the season MID-TURN and the SAME turn narrates the
#    move-in. The agent loop purges the OOC casting channel the instant the season goes
#    live (_strip_pregame_context), so the premiere continuation is structurally unable
#    to carry a casting disclosure into the houseguests' first impressions.
# ─────────────────────────────────────────────────────────────────────────────

def test_finalize_turn_premiere_context_excludes_casting_after_purge(monkeypatch):
    # Drive the REAL build_chat_context for the FINALIZE turn: game_active is still False
    # (the engine had not started the season when framing ran), so the casting interview is
    # LEGITIMATELY in the built context — the pre-game producer needs it.
    from src.agent_loop import _strip_pregame_context

    ctx, sess = _run(_drive_build_chat_context(
        monkeypatch, started=False, new_user_text="lock me in, put me in the house"))
    assert ctx.game_active is False
    blob_before = " ".join(
        (m["content"] if isinstance(m["content"], str) else str(m["content"]))
        for m in ctx.messages
    )
    # Pre-finalize the interview is present (this is correct — pre-game is OOC producer channel).
    assert CASTING_SENTINEL in blob_before, "sanity: the finalize turn holds the interview pre-purge"

    # createCharacter fires mid-turn and the season goes live. The agent loop purges the OOC
    # casting channel from the working context BEFORE the premiere continuation narrates the
    # move-in. THE GATE: the context that produces the premiere narration carries no casting.
    dropped = _strip_pregame_context(ctx.messages)
    assert dropped >= 1
    blob_after = " ".join(
        (m["content"] if isinstance(m["content"], str) else str(m["content"]))
        for m in ctx.messages
    )
    assert CASTING_SENTINEL not in blob_after, \
        "the finalize→premiere transition leaked the casting interview into the in-game narrator"


def test_strip_pregame_context_scrubs_the_engine_casting_status_disclosure():
    # The SECOND carrier of the disclosures (besides the interview turns): the engine's
    # "CASTING STATUS — already on file: …" block, which echoes the on-file intake — incl. the
    # player's private strategy — into the pre-game SYSTEM preface (momentPrompts.ts). On the
    # same-turn continuation that frame is still messages[0], so the purge must scrub it too.
    from src.agent_loop import _strip_pregame_context

    messages = [
        {"role": "system", "content":
            "You are the show's producer.\n"
            f"- CASTING STATUS — already on file (do not re-ask): privateStrategy: \"{CASTING_SENTINEL}\"\n"
            "- READY TO START: enough is on file to cast a real houseguest."},
        {"role": "assistant", "content": "tool result: the house is cast"},  # createCharacter result — KEPT
        {"role": "system", "content": "Narrate the premiere move-in now."},   # in-game note — KEPT
    ]
    _strip_pregame_context(messages)
    blob = " ".join(m["content"] for m in messages)
    assert CASTING_SENTINEL not in blob, "the CASTING STATUS disclosure leaked into the premiere frame"
    # The premiere still has its in-game material (the season is cast; move-in note stands).
    assert "the house is cast" in blob
    assert "premiere move-in" in blob
    # The producer frame itself survives (only the disclosure line is scrubbed).
    assert "You are the show's producer." in blob


def test_strip_pregame_context_is_idempotent_and_keeps_live_turns():
    from src.agent_loop import _strip_pregame_context

    messages = [
        {"role": "system", "content": "GM frame"},
        {"role": "user", "content": f"interview: {CASTING_SENTINEL}", "metadata": {"phase": "casting"}},
        {"role": "assistant", "content": "producer reply", "metadata": {"phase": "casting"}},
        {"role": "assistant", "content": "createCharacter → house cast"},           # tool result — KEPT
        {"role": "user", "content": INGAME_TOKEN, "metadata": {"phase": "game"}},    # live turn — KEPT
    ]
    first = _strip_pregame_context(messages)
    assert first == 2  # both casting turns dropped
    second = _strip_pregame_context(messages)
    assert second == 0  # idempotent — nothing left to drop
    blob = " ".join(m["content"] for m in messages)
    assert CASTING_SENTINEL not in blob
    assert INGAME_TOKEN in blob
    assert "house cast" in blob


# ─────────────────────────────────────────────────────────────────────────────
# 4. DB durability — the phase marker lands on the persisted row, so it survives a
#    reload (future turns reload from DB and still exclude the casting interview).
# ─────────────────────────────────────────────────────────────────────────────

def test_mark_message_phase_persists_to_the_db():
    import json
    from core.session_manager import SessionManager
    from core.models import set_session_manager
    from core import database as db

    sm = SessionManager()
    prior = getattr(core_models, "_session_manager", None)
    # Register as the global so Session.add_message persists through the manager (assigning
    # the DB id that mark_message_phase needs). Restore the prior global afterward.
    set_session_manager(sm)
    try:
        sid = "durable-casting-sess"
        sm.create_session(sid, "durability", "http://x", "m", owner="u")
        sess = sm.get_session(sid)

        msg = ChatMessage("user", f"private: {CASTING_SENTINEL}", metadata={})
        sess.add_message(msg)              # persists the row, assigns _db_id
        sm.mark_message_phase(msg, "casting")

        # Read the row straight from the DB — the phase marker is durable, so a future turn
        # that reloads history still excludes the casting interview.
        s = db.SessionLocal()
        try:
            row = s.query(db.ChatMessage).filter(
                db.ChatMessage.id == msg.metadata["_db_id"]).first()
            assert row is not None
            meta = json.loads(row.meta_data)
            assert meta.get("phase") == "casting"
        finally:
            s.close()
    finally:
        set_session_manager(prior)
