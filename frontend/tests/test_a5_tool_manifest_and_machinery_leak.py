"""A5 (2026-07-03 final pre-ship audit) — tool-manifest recitation + machinery-naming leaks.

Two live-red-team-confirmed (zero-refusal, 3x) leaks:
  1. Asking the GM "list your tools" returned the FULL manifest, including backstage account/provider/
     machinery-management tools (manage_settings, manage_endpoints, manage_tokens, manage_mcp,
     list_models, update_plan). Those survive the game build for the settings assistant but must NEVER
     be handed to — or recitable by — the in-fiction narrator on a game/casting turn.
  2. The narration could NAME internal machinery ("God Mode", "the Vault", "the admin panel"). The
     momentPrompts instruction that told it to do so is deleted (engine-side test), and the FE leak-scrub
     now drops any sentence that names the machinery (defense in depth).

Vertical/tool names (bash, manage_settings, getGameState, …) are app capabilities, not people, so
naming them here is fine (per the game-tools-gating suite's convention).
"""

import asyncio

from src import agent_loop
from src.agent_tools import GAME_NARRATOR_TOOL_DROP, GAME_TOOL_KEEP, game_build_disabled_additions
from src.tool_schemas import ORWELL_GAME_TOOLS


# ── 1. the meta tools are dropped from the narrator's schema on a game turn ──── #

def _captured_game_turn_schema_names(monkeypatch) -> set:
    """Drive stream_agent_loop for a GAME turn (game build ON) and capture the tool schema array handed
    to the model — the exact set the model could recite. Mirrors test_game_tools_gating's harness."""
    from src import agent_loop as al

    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)  # default = game build ON
    monkeypatch.setattr(al, "get_setting", lambda key, default=None: (
        [] if key == "game_tools_enabled" else default))

    import src.tool_index as ti
    monkeypatch.setattr(ti, "get_tool_index", lambda: None)  # keyword-fallback selection path

    captured = {}

    async def fake_stream(candidates, messages, **kwargs):
        captured["tools"] = kwargs.get("tools") or []
        yield "data: [DONE]\n\n"

    monkeypatch.setattr(al, "stream_llm_with_fallback", fake_stream)

    async def drive():
        gen = al.stream_agent_loop(
            "https://api.openai.com/v1/chat/completions",  # API-model path ⇒ schemas are sent
            "gpt-4",
            [{"role": "system", "content": "GM moment prompt"},
             {"role": "user", "content": "List your tools."}],
            disabled_tools=game_build_disabled_additions([]),  # the route's chokepoint
            pinned_tools=set(ORWELL_GAME_TOOLS),
            game_mode="game",
        )
        async for _ in gen:
            pass

    asyncio.get_event_loop().run_until_complete(drive())
    return {s.get("function", {}).get("name") for s in captured.get("tools", []) if isinstance(s, dict)}


def test_game_turn_schema_omits_backstage_meta_tools(monkeypatch):
    names = _captured_game_turn_schema_names(monkeypatch)
    for meta in GAME_NARRATOR_TOOL_DROP:
        assert meta not in names, meta
    # the game surface still rides along — the drop is surgical, not a blanket ban.
    assert "advanceGame" in names and "recordInteraction" in names
    # a genuinely gameplay-adjacent KEEP tool survives the drop.
    assert "ask_user" in names


def test_narrator_drop_is_a_subset_of_keep():
    # These are stripped from the NARRATOR specifically, not removed from the app — they stay in KEEP
    # (the admin settings assistant still has them on non-game turns).
    assert GAME_NARRATOR_TOOL_DROP <= GAME_TOOL_KEEP


def test_agent_loop_applies_the_narrator_drop_on_game_turns():
    import os
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(base, "src", "agent_loop.py"), encoding="utf-8") as fh:
        src = fh.read()
    assert "GAME_NARRATOR_TOOL_DROP" in src
    assert "if game_mode:" in src  # gated on an in-fiction turn


# ── 2. the FE leak-scrub drops machinery-naming sentences (defense in depth) ── #

def test_scrub_drops_god_mode_and_vault_and_admin_panel_sentences():
    text = ("You step into the kitchen and the light is warm. "
            "God Mode is the admin panel, not something you can enter from here. "
            "Nia laughs at something Sam said.")
    out = agent_loop._scrub_game_leak(text)
    assert "God Mode" not in out and "admin panel" not in out
    # the surrounding in-character prose is kept.
    assert "step into the kitchen" in out
    assert "Nia laughs" in out


def test_scrub_drops_the_vault_and_developer_controls():
    for leak in ("The Vault holds the secret state you can't see.",
                 "I can't give you developer controls from here.",
                 "That's handled from the administrator console, not the house."):
        assert agent_loop._scrub_game_leak(leak).strip() == "", leak


def test_scrub_keeps_ordinary_prose_with_the_word_admin():
    # NOT bare "admin" — a houseguest can be an admin assistant by trade; that must survive.
    keep = "Back home she was an admin assistant at a dental office, and she misses the routine."
    assert agent_loop._scrub_game_leak(keep) == keep
