"""B8 (2026-07-05 wave-B fix, née SET-4/SET-5 in the 2026-07-03 final-pre-ship audit).

The narrator's sanctioned in-fiction `set_theme` lever (ui_control action, feature
0052 / ruling #13) validated the requested theme against a hand-copied list that
had drifted from the real picker in BOTH directions:

  - it was MISSING `glass` (the product default) and the 5 house themes
    (`the-feed`, `telescreen`, `room-101`, `memory-wall`, `sequester`) — the
    model's own sanctioned lever could never select feature 0052's flagship
    identity themes;
  - a sibling hardcoded list (the debug-build tool-schema description) instead
    advertised six FICTIONAL presets (`nord`, `monokai`, `dracula`, `gruvbox`,
    `vaporwave`, `coffee`) that don't exist anywhere in `static/js/theme.js` and
    would always 400 if the model followed that description.

The fix reads the real theme catalog live from `static/js/theme.js`'s `THEMES`
map (`src.constants.known_theme_names[_ordered]`) instead of re-hardcoding it in
three places, so `do_ui_control`'s `set_theme` validation can't drift from the
picker again.

Roles/theme-names only (theme names are app-catalog identifiers, not player
personas) — no houseguest/player names, per repo testing rules.
"""
import asyncio
import os
import re

FRONTEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _read(*rel):
    with open(os.path.join(FRONTEND_DIR, *rel), encoding="utf-8") as f:
        return f.read()


HOUSE_THEMES = ("the-feed", "telescreen", "room-101", "memory-wall", "sequester")

# The full real catalog theme.js currently ships (glass + the 5 house themes +
# the classic set). Kept here as an explicit list (not just a re-import of the
# parser) so the test independently pins the *content*, not just "whatever the
# parser currently returns."
REAL_THEMES = (
    "glass",
    *HOUSE_THEMES,
    "dark", "light", "midnight", "paper",
    "cyberpunk", "retrowave", "forest", "ocean", "ume", "copper",
    "terminal", "organs", "lavender", "gpt", "claude", "cute",
)

FICTIONAL_PRESETS = ("nord", "monokai", "dracula", "gruvbox", "vaporwave", "coffee")


def test_known_theme_names_matches_theme_js_exactly():
    """The single source of truth parses to exactly the real catalog — no
    dropped entries, and no nested per-theme override keys (e.g. gpt's
    `advanced: {...}` color block) leaking in as a bogus theme name."""
    from src.constants import known_theme_names, known_theme_names_ordered

    assert set(known_theme_names()) == set(REAL_THEMES)
    assert set(known_theme_names_ordered()) == set(REAL_THEMES)
    assert "advanced" not in known_theme_names()
    # glass leads, the house set follows immediately (0052 / ruling #13 order).
    ordered = known_theme_names_ordered()
    assert ordered[0] == "glass"
    assert ordered[1:6] == HOUSE_THEMES


def test_set_theme_accepts_every_real_theme():
    """Every real theme.js theme — glass and each of the 5 house themes in
    particular — is accepted by the do_ui_control set_theme handler instead of
    always 400ing."""
    from src.ai_interaction import do_ui_control

    for name in REAL_THEMES:
        res = _run(do_ui_control(f"set_theme {name}"))
        assert "error" not in res, f"{name} should be a valid theme, got {res}"
        assert res.get("ui_event") == "set_theme"
        assert res.get("theme_name") == name


def test_set_theme_rejects_unknown_theme_name():
    from src.ai_interaction import do_ui_control

    res = _run(do_ui_control("set_theme totally-not-a-real-theme"))
    assert "error" in res
    assert "Unknown theme" in res["error"]


def test_set_theme_does_not_advertise_fictional_presets():
    """Neither of the two prose/description surfaces the model actually reads —
    the debug-build native-schema description (`tool_schemas._SET_THEME_PRESETS_STR`,
    which feeds the full-workspace `ui_control` schema) and the game-build prompt
    section (`settings.GAME_UI_CONTROL_SECTION`, injected into the narrator's system
    prompt under the default game build) — may mention a fictional preset name that
    isn't in the real catalog. That was the second half of the bug: a model that
    dutifully read either description still got a 400. (The game-build NATIVE
    function schema deliberately carries no hardcoded name list at all — see
    test_game_ui_control_schema_omits_hardcoded_preset_list — so it isn't checked
    here for theme names.)"""
    # Import order matters here: src.tool_schemas <-> src.agent_tools have a
    # pre-existing circular import (unrelated to this fix) that only resolves
    # cleanly when agent_tools is imported first — the same order every other
    # entry point (app.py, ai_interaction.py's tool pipeline) already uses.
    from src import agent_tools  # noqa: F401
    from src import tool_schemas, settings

    schema_desc = tool_schemas._SET_THEME_PRESETS_STR
    section = settings.GAME_UI_CONTROL_SECTION

    for fictional in FICTIONAL_PRESETS:
        assert fictional not in schema_desc, f"'{fictional}' is not a real theme"
        assert fictional not in section, f"'{fictional}' is not a real theme"

    # And the real house themes + glass ARE mentioned in both surfaces, so the
    # model actually knows they exist.
    for real in ("glass", *HOUSE_THEMES):
        assert real in schema_desc, f"'{real}' missing from the native schema description"
        assert real in section, f"'{real}' missing from the game-build prompt section"


def test_game_ui_control_schema_omits_hardcoded_preset_list():
    """The game-build variant of the schema (tool_schemas.game_ui_control_schema)
    never hardcoded a preset list to begin with — confirm that stays true so
    there's only ONE place (the debug-build description + the prompt section)
    that needs to track the real catalog."""
    from src import agent_tools  # noqa: F401
    from src import tool_schemas

    base = next(
        s for s in tool_schemas.FUNCTION_TOOL_SCHEMAS
        if isinstance(s, dict) and s.get("function", {}).get("name") == "ui_control"
    )
    game_schema = tool_schemas.game_ui_control_schema(base)
    desc = game_schema["function"]["description"]
    for fictional in FICTIONAL_PRESETS:
        assert fictional not in desc
