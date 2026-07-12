"""F-S4-F (ADR 0009 / roadmap R4, #1415) — name grounding does NOT degrade on the resume path.

The audit *suspected* a resume-context name drift ("Luke Fleming" -> "Lake Fleming"). Investigation
(see the issue write-up) found this is NOT a structural degradation, and these pins keep it that way:

  1. The resumable-stream endpoint `GET /api/chat/resume/{id}` is a PURE REPLAY — it re-attaches to a
     detached run's buffered SSE and streams it back; it does NOT re-invoke the agent loop, the game
     framing, or the model. A pure replay emits exactly the bytes the original run produced, so it
     cannot INTRODUCE a name drift (there is no fresh generation on this path).

  2. Every MODEL-invoking turn — including the fresh-context RE-ENTRY turn a reopened session takes —
     is framed through `apply_game_framing`, which fetches the engine moment prompt. That prompt
     always carries the full roster (the single source of truth for names — proven engine-side in
     `tests/unit/locationGrounding0009.test.ts`). So a resumed session's NEXT turn re-grounds names
     from engine truth; grounding does not thin on resume.

Source-level pins, in the established FE convention (the real gate lives in the wiring, not a keyword).
"""
from __future__ import annotations

import os
import re

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(rel: str) -> str:
    with open(os.path.join(_ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


def _chat_resume_body() -> str:
    src = _read(os.path.join("routes", "chat_routes.py"))
    start = src.index("async def chat_resume(")
    # The function is short; stop at the next route registration.
    nxt = src.index("@router.", start)
    return src[start:nxt]


def test_resume_endpoint_is_a_pure_replay_not_a_regeneration():
    """The resume path re-attaches to the buffered run and streams it — no fresh model generation, so
    it cannot introduce a name drift the original run did not already have."""
    body = _chat_resume_body()
    # It replays the detached run's buffer...
    assert "agent_runs.subscribe(" in body, (
        "chat_resume must replay the detached run via agent_runs.subscribe (a pure buffer replay)")
    assert "agent_runs.has_run(" in body, "chat_resume must 404 a session with no buffered run"
    # ...and it must NOT re-run the agent loop / game framing / a model call (which could regenerate
    # text and drift a name). A pure replay touches none of these.
    for forbidden in ("apply_game_framing", "get_moment_prompt", "run_agent(", "run_agent_loop", "agent_loop("):
        assert forbidden not in body, (
            f"chat_resume must be a pure replay — it must NOT call {forbidden!r} (that would regenerate "
            "text on resume and could introduce a name drift)")


def test_reentry_regrounds_a_reopened_session_from_engine_truth():
    """A fresh context (a reopened / mid-season-resumed session this process has not framed) requests
    the RE-ENTRY moment, whose prompt carries the full roster — so name grounding is RE-ESTABLISHED on
    resume, never inherited-and-drifted from prior chat text."""
    src = _read(os.path.join("routes", "chat_helpers.py"))
    # P2 wiring: an unframed session flips the moment to RE_ENTRY_MOMENT before the moment-prompt fetch.
    assert re.search(
        r"if session_id is not None and session_id not in _SESSION_GAME_FRAMED:\s*\n\s*moment = RE_ENTRY_MOMENT",
        src,
    ), "the fresh-context (resume) path must request the RE-ENTRY moment"
    assert 'RE_ENTRY_MOMENT = "re-entry"' in src
    # The re-entry moment is then fetched as the ordinary moment prompt (the roster-bearing frame) —
    # NOT a reduced/history-only context. buildSystemPrompt always appends renderGameContext (the
    # roster); the engine-side pin proves the roster is present for moment="re-entry".
    reentry_at = src.index("moment = RE_ENTRY_MOMENT")
    after = src[reentry_at:reentry_at + 1200]
    assert "orwell_engine.get_moment_prompt(moment" in after, (
        "after selecting RE_ENTRY_MOMENT the framing must fetch the roster-bearing moment prompt, so a "
        "resumed session re-grounds names from engine truth")
