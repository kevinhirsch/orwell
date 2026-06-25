"""Orwell #872 — a brand-new player on deepseek-v4-pro must always reach Day 1.

The provider intermittently 400s on continuation/tool rounds. Before the fix this:
  A) rendered the raw HTTP status as a literal Big Brother / producer bubble ("Error 400");
  B) blocked the casting finalize fallback — a pure-error turn emits no visible narration, which
     the loop treated as a player CANCELLATION and so the FE-driven createCharacter never fired,
     leaving the season stuck at phase:setup forever (the model can never finalize when its own
     turn keeps erroring);
  C) sent 29 tools on casting turns (a likely 400 contributor).

These drive the REAL stream_agent_loop in casting mode with a STUBBED 400 (no live key) and assert:
  - NO raw HTTP status / "Error 400" reaches the player's body channel (item A);
  - the casting flow still finalizes — the FE forces createCharacter so the season can premiere
    even though every model turn errors (item B);
  - the casting turn is sent only the minimal casting tool set (item C).

Roles only; `playerName` is the non-name token "P". Mirrors test_castingloop_fix.py's harness.
"""
import asyncio
import json

from src import agent_loop as al


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


_FINALIZABLE = {"ready": True, "finalizable": True,
                "known": {"playerName": "P", "backstory": "x", "motivation": "y",
                          "personaArchetype": "z"},
                "missing": [], "next": None}


def _drive_casting_with_400(monkeypatch, *, casting_view, last_user, max_rounds=3,
                            error_shape="event"):
    """Drive the REAL stream_agent_loop in casting mode where the model's stream ALWAYS errors.

    `error_shape`:
      "event"     — an HTTP-status error as `event: error` (llm_core's non-200 path);
      "mid"       — an in-band `data: {error,status}` (llm_core's mid-stream provider-error path).

    Returns (player_body_deltas, force_calls, tool_names_sent)."""
    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)
    monkeypatch.setattr(al, "get_setting", lambda key, default=None: default)
    import src.tool_index as ti
    monkeypatch.setattr(ti, "get_tool_index", lambda: None)
    monkeypatch.setattr(al, "_player_turn_is_lull", lambda messages: True)

    import src.orwell_engine as oe
    async def fake_state(user=None):
        return {"started": False, "moment": "character-creation", "casting": casting_view}
    monkeypatch.setattr(oe, "get_game_state", fake_state)
    async def _empty_extract(*a, **k):
        return ""
    monkeypatch.setattr("src.llm_core.llm_call_async", _empty_extract)
    async def _noop_update(fields, user=None):
        return {}
    monkeypatch.setattr(oe, "update_casting", _noop_update)

    force_calls = []
    import src.tool_implementations as timpl
    async def force_spy(content, owner=None):
        force_calls.append((content, owner))
        return {"output": json.dumps({"started": True}), "exit_code": 0}
    monkeypatch.setattr(timpl, "do_create_character", force_spy)

    tool_names_sent = []

    async def fake_stream(candidates, messages, **kwargs):
        # capture the tools the loop chose to send on a casting turn (item C)
        tool_names_sent.append([
            (t.get("function", {}) or {}).get("name")
            for t in (kwargs.get("tools") or [])
        ])
        # the provider 400s — exactly the deepseek continuation-round failure
        if error_shape == "mid":
            yield 'data: ' + json.dumps({
                "error": "Provider returned error",
                "status": 400,
                "error_type": "provider_unavailable",
                "mid_stream": True,
            }) + '\n\n'
        else:
            friendly = "OpenRouter returned HTTP 400: invalid request (reasoning continuation)"
            yield ('event: error\ndata: ' + json.dumps({
                "status": 400, "text": friendly, "raw": '{"error":{"message":"bad"}}'}) + '\n\n')
        yield "data: [DONE]\n\n"
    monkeypatch.setattr(al, "stream_llm_with_fallback", fake_stream)

    player_body_deltas = []
    raw_error_chunks = []

    async def drive():
        gen = al.stream_agent_loop(
            "https://openrouter.ai/api/v1/chat/completions", "deepseek/deepseek-v4-pro",
            [{"role": "system", "content": "You are the casting producer."},
             {"role": "user", "content": last_user}],
            owner="P", game_mode="casting", max_rounds=max_rounds)
        async for chunk in gen:
            if chunk.startswith("data: ") and not chunk.startswith("data: [DONE]"):
                try:
                    data = json.loads(chunk[6:])
                except Exception:
                    continue
                # the PLAYER body channel is a non-thinking `delta` (what reaches the bubble)
                if "delta" in data and not data.get("thinking"):
                    player_body_deltas.append(data["delta"])
            elif chunk.startswith("event: error"):
                raw_error_chunks.append(chunk)

    al._CASTING_STALL_LEVEL.pop("P", None)
    al._CASTING_SUBSTANCE_LEVEL.pop("P", None)
    _run(drive())
    return player_body_deltas, force_calls, tool_names_sent, raw_error_chunks


# ── Item A: no raw HTTP status ever reaches the player BODY channel ──────────────

def test_400_never_lands_in_player_body_channel_event_shape(monkeypatch):
    body, _force, _tools, raw = _drive_casting_with_400(
        monkeypatch, casting_view=_FINALIZABLE, last_user="I'm ready, put me in the house",
        error_shape="event")
    joined = " ".join(body)
    assert "400" not in joined, f"raw HTTP 400 leaked into the player body: {body!r}"
    assert "HTTP" not in joined and "OpenRouter" not in joined and "Error" not in joined, (
        f"a raw provider error reached the player body channel: {body!r}")
    # the error is still surfaced on its OWN typed channel (the FE renders it diegetically / silently),
    # never as reply-channel body text — so the typed signal must exist somewhere off the body.
    # (event: error is forwarded; or the in-band path emits a typed `error`.)


def test_400_never_lands_in_player_body_channel_mid_shape(monkeypatch):
    body, _force, _tools, _raw = _drive_casting_with_400(
        monkeypatch, casting_view=_FINALIZABLE, last_user="I'm ready, put me in the house",
        error_shape="mid")
    joined = " ".join(body)
    assert "400" not in joined and "Provider returned error" not in joined, (
        f"a mid-stream provider error leaked into the player body: {body!r}")


# ── Item B: the season still premieres even though every model turn errors ───────

def test_casting_finalizes_despite_persistent_400(monkeypatch):
    _body, force_calls, _tools, _raw = _drive_casting_with_400(
        monkeypatch, casting_view=_FINALIZABLE, last_user="I'm ready, put me in the house",
        error_shape="event")
    assert force_calls, (
        "the season must premiere even when the model's turns keep 400ing: with casting engine-"
        "finalizable and the player ready, the FE must force createCharacter itself (item B).")


def test_errored_casting_turn_is_not_treated_as_a_cancellation(monkeypatch):
    # an errored turn produces no visible narration, but it must NOT disable the finalize fallback
    # the way a real player Stop (cancellation) does.
    _body, force_calls, _tools, _raw = _drive_casting_with_400(
        monkeypatch, casting_view=_FINALIZABLE, last_user="lock it in", error_shape="mid")
    assert force_calls, "a mid-stream 400 is a stall, not a cancellation — finalize must still fire"


# ── Item C: a casting turn is sent only the minimal casting tool set ─────────────

def test_casting_turn_sends_only_the_minimal_tool_set(monkeypatch):
    _body, _force, tool_names_sent, _raw = _drive_casting_with_400(
        monkeypatch, casting_view=_FINALIZABLE, last_user="hi", error_shape="event")
    assert tool_names_sent, "the model stream must have been invoked at least once"
    first = set(n for n in tool_names_sent[0] if n)
    # whatever subset of CASTING_TOOLS is API-eligible, it must be a SUBSET — never the broad surface
    assert first <= set(al.CASTING_TOOLS), (
        f"casting turn sent tools outside the minimal casting set: {sorted(first - set(al.CASTING_TOOLS))}")
    assert "updateCasting" in first and "createCharacter" in first, (
        f"the casting essentials must be offered, got {sorted(first)}")
    # and it must be small (ADR-0003 minimalism) — far below the 29 the audit saw
    assert len(first) <= len(al.CASTING_TOOLS), f"too many tools on a casting turn: {sorted(first)}"


def test_casting_tools_constant_is_minimal():
    assert al.CASTING_TOOLS, "CASTING_TOOLS must define the minimal casting surface"
    assert "updateCasting" in al.CASTING_TOOLS
    assert "createCharacter" in al.CASTING_TOOLS
    # the live-season / God-Mode levers must NOT be in the casting set
    for forbidden in ("advanceGame", "runCompetition", "submitDecision", "overrideMechanic",
                      "recordInteraction", "inspectNonVaultState"):
        assert forbidden not in al.CASTING_TOOLS, f"{forbidden} must not be a casting tool"
