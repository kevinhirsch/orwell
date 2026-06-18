"""Queue C32 — web search as an in-fiction agent capability (amends 0032).

Ruling (2026-06-10): the agent must be able to leverage web search IN CHARACTER — the
player references something real (a new movie), the agent quietly searches and replies in
the houseguest's voice. Search informs real-world flavor ONLY, never game truth.
"""

import importlib
import os
import re

settings = importlib.import_module("src.settings")
agent_tools = importlib.import_module("src.agent_tools")

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(FRONTEND)


def _read(*rel):
    with open(os.path.join(*rel), encoding="utf-8") as f:
        return f.read()


# --- the vertical is mounted and agent-callable under the game build -----------------

def test_web_search_is_in_the_keep_set_not_the_drop_set():
    assert "web_search" in settings.GAME_KEEP_SET
    assert "web_search" not in settings.GAME_DROP_SET


def test_web_search_feature_enabled_under_game_build(monkeypatch):
    monkeypatch.setenv("ORWELL_GAME_BUILD", "1")
    assert settings.is_feature_enabled("web_search") is True


def test_agent_can_call_web_search_in_game_build():
    # game_build_disabled_additions returns the forced-off set; web_search must not be in it.
    off = agent_tools.game_build_disabled_additions([])
    assert "web_search" not in off
    assert "web_search" in agent_tools.GAME_TOOL_KEEP


# --- the Settings search tab is global config: admin-only (C30 ruling) ----------------

def test_search_settings_tab_is_admin_only():
    html = _read(FRONTEND, "static", "index.html")
    m = re.search(r'<button class="([^"]*)" data-settings-tab="search"', html)
    assert m, "search nav button not found"
    assert "admin-only" in m.group(1), "search provider config is global → admin-only"


# --- the in-fiction guardrails live in the game-master prompt -------------------------

def test_moment_prompt_carries_the_real_world_clause():
    ts = _read(REPO, "src", "engine", "momentPrompts.ts")
    assert "THE REAL WORLD." in ts
    assert "web_search" in ts
    # silent, in-voice synthesis — never raw results, never fiction breaks
    assert "Never show search results, never mention searching" in ts
    # the hard guardrail: flavor only, game truth stays with the game's own levers (the machinery
    # is never NAMED to the model — "engine" was scrubbed to diegetic terms, audit 2026-06-18).
    assert "game truth comes only from your levers" in ts
    # fiction consistency: the house has no internet (phrase spans two prompt lines)
    assert "a houseguest can know the movie, not this week's box office" in ts
    # fail-soft: no provider → improvise in character
    assert "If search is unavailable" in ts
