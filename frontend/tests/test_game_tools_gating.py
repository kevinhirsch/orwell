"""Game-build agent-tool gating (feature 0032 extension).

Security-sensitive: this gate decides which tools the chat agent (an LLM) is
actually handed. Roles only — no houseguest/player names. Vertical/tool names
(bash, email, getGameState, …) are app capabilities, not people, so naming them
is fine.

Three tiers under the game build:
  KEEP     — always listed + handed to the agent.
  OPTIONAL — listed but off by default (opt-in via `game_tools_enabled`).
  DROP     — never listed, never handed to the agent (computed = TOOL_TAGS - KEEP
             - OPTIONAL, so newly inherited tools fail-closed to dropped).

The GET /api/tools surface is exercised through a TestClient mounting the real
model_routes router (no heavy full-app import needed — see conftest's core stub).
"""

import os

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from src.agent_tools import (
    TOOL_TAGS,
    GAME_TOOL_KEEP,
    GAME_TOOL_OPTIONAL,
    game_build_disabled_additions,
)


# ── helpers ──────────────────────────────────────────────────────────────────

def _set_game_build(monkeypatch, on: bool):
    monkeypatch.setenv("ORWELL_GAME_BUILD", "1" if on else "0")


def _client(monkeypatch, *, game_build: bool, settings: dict | None = None):
    """A minimal app mounting the real /api/tools router, with settings pinned to
    an in-memory dict so the test does not depend on (or mutate) data/settings.json."""
    _set_game_build(monkeypatch, game_build)
    from routes import model_routes

    store = dict(settings or {})
    monkeypatch.setattr(model_routes, "_load_settings", lambda: dict(store))
    monkeypatch.setattr(model_routes, "_save_settings", lambda s: store.update(s))

    app = FastAPI()
    app.include_router(model_routes.setup_model_routes(model_discovery=object()))
    return TestClient(app), store


def _by_id(tools):
    return {t["id"]: t for t in tools}


# Representative dropped ids (scrapped/dead verticals) that must never reach the agent.
_DROPPED_SAMPLE = ("web_fetch", "send_email", "serve_model", "trigger_research", "manage_memory")


# ── Scenario: GET /api/tools hides the drop-set, keeps KEEP + OPTIONAL ─────────

def test_get_tools_omits_dropped_lists_keep_and_optional(monkeypatch):
    client, _ = _client(monkeypatch, game_build=True)
    tools = client.get("/api/tools").json()["tools"]
    ids = {t["id"] for t in tools}

    # No dropped/dead-vertical id is ever listed.
    for dropped in _DROPPED_SAMPLE:
        assert dropped not in ids, dropped

    # KEEP (engine + core) and OPTIONAL (power) ids are present.
    for keep in ("getGameState", "generate_image", "ask_user", "submitDecision"):
        assert keep in ids, keep
    for opt in ("bash", "api_call", "read_file"):
        assert opt in ids, opt

    # The listed set is exactly the keep+optional intersection with TOOL_TAGS.
    assert ids == (GAME_TOOL_KEEP | GAME_TOOL_OPTIONAL) & TOOL_TAGS


def test_get_tools_optional_off_keep_on_by_default(monkeypatch):
    client, _ = _client(monkeypatch, game_build=True)
    tools = _by_id(client.get("/api/tools").json()["tools"])

    # Optional tools: flagged optional and OFF by default (nothing opted in yet).
    for opt in ("bash", "api_call", "python", "edit_file"):
        assert tools[opt]["optional"] is True, opt
        assert tools[opt]["enabled"] is False, opt

    # Keep tools: not optional and ON by default.
    for keep in ("getGameState", "generate_image", "ask_user"):
        assert tools[keep]["optional"] is False, keep
        assert tools[keep]["enabled"] is True, keep


def test_get_tools_optin_flips_optional_enabled(monkeypatch):
    client, _ = _client(monkeypatch, game_build=True, settings={"game_tools_enabled": ["bash"]})
    tools = _by_id(client.get("/api/tools").json()["tools"])
    # Opted-in optional tool now reads enabled; a non-opted one stays off.
    assert tools["bash"]["enabled"] is True
    assert tools["python"]["enabled"] is False


def test_get_tools_disabled_overrides_keep_and_optin(monkeypatch):
    client, _ = _client(
        monkeypatch, game_build=True,
        settings={"game_tools_enabled": ["bash"], "disabled_tools": ["bash", "getGameState"]},
    )
    tools = _by_id(client.get("/api/tools").json()["tools"])
    # disabled_tools wins for both a keep tool and an opted-in optional tool.
    assert tools["getGameState"]["enabled"] is False
    assert tools["bash"]["enabled"] is False


# ── Scenario: game build OFF → unchanged (all TOOL_TAGS, optional=False) ───────

def test_get_tools_game_build_off_lists_everything(monkeypatch):
    client, _ = _client(monkeypatch, game_build=False, settings={"disabled_tools": ["bash"]})
    tools = _by_id(client.get("/api/tools").json()["tools"])
    # Every TOOL_TAG is listed, including dropped-under-game ids.
    assert set(tools) == set(TOOL_TAGS)
    for t in tools.values():
        assert t["optional"] is False
    # Legacy semantics: enabled == not in disabled_tools.
    assert tools["bash"]["enabled"] is False
    assert tools["web_search"]["enabled"] is True


# ── Scenario: POST persists both lists ────────────────────────────────────────

def test_post_tools_persists_disabled_and_enabled_optional(monkeypatch):
    # The POST still runs the real require_admin gate; AUTH_ENABLED=false is its
    # documented bypass, so the minimal app exercises the handler (admin-gating
    # itself is covered by the app-admin suite).
    monkeypatch.setenv("AUTH_ENABLED", "false")
    client, store = _client(monkeypatch, game_build=True)
    resp = client.post(
        "/api/tools",
        json={"disabled": ["getGameState"], "enabled_optional": ["bash", "api_call"]},
    )
    assert resp.status_code == 200, resp.text
    assert store["disabled_tools"] == ["getGameState"]
    assert store["game_tools_enabled"] == ["bash", "api_call"]


# ── Unit: game_build_disabled_additions ───────────────────────────────────────

def test_additions_force_off_drop_and_unopted_optional():
    off = game_build_disabled_additions([])
    # Dropped verticals AND un-opted optional tools are forced off.
    for forced in ("web_fetch", "bash", "send_email", "trigger_research", "manage_memory"):
        assert forced in off, forced
    # KEEP tools are NEVER forced off (they stay on unless disabled separately).
    # web_search joined the keep-set (C32 ruling: in-fiction real-world lookups).
    for keep in ("getGameState", "ask_user", "generate_image", "submitDecision", "web_search"):
        assert keep not in off, keep


def test_additions_optin_excludes_only_that_tool():
    off = game_build_disabled_additions(["bash"])
    assert "bash" not in off            # opted in → no longer forced off
    assert "web_fetch" in off           # an un-opted dropped/other tool still off
    assert "python" in off              # a different optional tool stays off


def test_additions_never_drop_keep_set_for_any_optin():
    # No matter what the user opts into, the keep-set is never forced off.
    for optin in ([], ["bash"], list(GAME_TOOL_OPTIONAL), ["getGameState"], ["ask_user"]):
        off = game_build_disabled_additions(optin)
        assert not (GAME_TOOL_KEEP & off), (optin, GAME_TOOL_KEEP & off)


def test_additions_partition_covers_every_tool_tag():
    # KEEP ∪ OPTIONAL ∪ DROP(=additions with no opt-in) == TOOL_TAGS, with KEEP
    # disjoint from the forced-off set (fail-closed: a new inherited tag defaults
    # into DROP, not into the agent's hands).
    off = game_build_disabled_additions([])
    assert (set(GAME_TOOL_KEEP) | set(GAME_TOOL_OPTIONAL) | off) >= set(TOOL_TAGS)
    assert set(off) <= set(TOOL_TAGS)
    assert not (set(GAME_TOOL_KEEP) & off)


# ── A1: the auto-escalation withhold is escalation-reason-aware ───────────────
#
# The old vacuous shape proved game_build_disabled_additions(["bash"]) excludes bash IN
# ISOLATION while the route's unconditional auto-escalation withhold re-disabled it on
# every chat-originated game turn. These tests COMPOSE the two production blocks exactly
# as routes/chat_routes.py does (chokepoint → withhold), so the opt-in is proven on the
# composed disabled set actually handed to the agent loop.

from routes.chat_helpers import AUTO_ESCALATION_WITHHELD, auto_escalation_withhold


def _composed_disabled_set(*, game_escalated: bool, game_tools_enabled: list) -> set:
    """The chat route's game-turn disabled-set assembly, composed verbatim:
    the game-build chokepoint, then the (reason-aware) auto-escalation withhold."""
    disabled = set()
    disabled.update(game_build_disabled_additions(game_tools_enabled))   # chokepoint
    disabled.update(auto_escalation_withhold(game_escalated, game_tools_enabled))
    return disabled


def test_chat_path_game_escalation_honors_the_bash_optin():
    # Game build on, admin opted bash in, default player path (chat → game escalation):
    # bash must NOT be in the composed disabled set handed to the agent loop.
    disabled = _composed_disabled_set(game_escalated=True, game_tools_enabled=["bash"])
    assert "bash" not in disabled
    # builtin_browser has no sanctioned opt-in — withheld unconditionally.
    assert "builtin_browser" in disabled


def test_chat_path_game_escalation_without_optin_still_withholds():
    # Mirror case: no opt-in ⇒ the heavy tools stay withheld on the game escalation too.
    disabled = _composed_disabled_set(game_escalated=True, game_tools_enabled=[])
    for heavy in ("bash", "python", "read_file", "write_file", "builtin_browser"):
        assert heavy in disabled, heavy


def test_chat_path_intent_escalation_keeps_the_full_withhold():
    # The notes/calendar/email intent escalation is NOT the game path: it withholds the
    # heavy tools even when they are opted in for game turns.
    disabled = _composed_disabled_set(game_escalated=False, game_tools_enabled=["bash"])
    assert "bash" in disabled


def test_chat_path_non_withheld_optional_consistent_either_way():
    # A1's consistency pin: an optional tool outside the withhold set (grep) behaves
    # identically on both escalation paths — enabled when opted in, off otherwise.
    for game_escalated in (True, False):
        assert "grep" not in _composed_disabled_set(
            game_escalated=game_escalated, game_tools_enabled=["grep"])
        assert "grep" in _composed_disabled_set(
            game_escalated=game_escalated, game_tools_enabled=[])


def test_withhold_never_unwithholds_outside_the_optional_set():
    # Opting in nonsense (or a KEEP/dropped id) can never shrink the withhold beyond
    # the sanctioned GAME_TOOL_OPTIONAL intersection.
    out = auto_escalation_withhold(True, ["builtin_browser", "getGameState", "send_email", "nope"])
    assert out == set(AUTO_ESCALATION_WITHHELD)


def test_chat_route_wires_the_reason_aware_withhold():
    # Drift pin: the route must feed BOTH blocks — the chokepoint and the reason-aware
    # withhold — or the composition above stops mirroring production.
    import pathlib
    src = (pathlib.Path(__file__).parent.parent / "routes" / "chat_routes.py").read_text(encoding="utf-8")
    assert 'game_build_disabled_additions(get_setting("game_tools_enabled", []))' in src
    assert 'auto_escalation_withhold(game_escalated, get_setting("game_tools_enabled", []))' in src
    assert "game_escalated = True" in src


# ── A2 (gate 3): an enabled optional tool is actually OFFERED on a game turn ──
#
# The four-gate trace's third silent defeat: on game turns the function-calling array is
# FUNCTION_TOOL_SCHEMAS ∩ _relevant_tools − disabled_tools, and the session-class optionals
# (chat_with_model, …) are not in ALWAYS_AVAILABLE and have no keyword hints in-character
# prose would trip — enabled but never offered. This is the NON-vacuous schema-assembly
# test the addendum demands: game turn + game_tools_enabled=["chat_with_model"] ⇒ the
# schema array handed to the API call contains it.

def _captured_schema_names(monkeypatch, *, enabled: list) -> set:
    import asyncio
    from src import agent_loop as al

    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)  # default = game build ON
    monkeypatch.setattr(al, "get_setting", lambda key, default=None: (
        enabled if key == "game_tools_enabled" else default))

    # Hermetic: no embedding-backed tool index in tests — the keyword-fallback selection
    # runs instead, which is exactly the filtered-set path the A2 finding is about.
    import src.tool_index as ti
    monkeypatch.setattr(ti, "get_tool_index", lambda: None)

    captured: dict = {}

    async def fake_stream(candidates, messages, **kwargs):
        captured["tools"] = kwargs.get("tools") or []
        yield "data: [DONE]\n\n"

    monkeypatch.setattr(al, "stream_llm_with_fallback", fake_stream)

    from src.tool_schemas import ORWELL_GAME_TOOLS

    async def drive():
        gen = al.stream_agent_loop(
            "https://api.openai.com/v1/chat/completions",  # API-model path ⇒ schemas are sent
            "gpt-4",
            [{"role": "system", "content": "GM moment prompt"},
             {"role": "user", "content": "I pull the HOH aside for a quiet chat."}],
            disabled_tools=game_build_disabled_additions(enabled),  # the route's chokepoint
            pinned_tools=set(ORWELL_GAME_TOOLS),
            game_mode="game",
        )
        async for _chunk in gen:
            pass

    asyncio.get_event_loop().run_until_complete(drive())
    return {
        s.get("function", {}).get("name")
        for s in captured.get("tools", [])
        if isinstance(s, dict)
    }


def test_game_turn_schema_array_contains_the_enabled_session_optional(monkeypatch):
    names = _captured_schema_names(monkeypatch, enabled=["chat_with_model"])
    assert "chat_with_model" in names
    # and the pinned game tools still ride along
    assert "advanceGame" in names and "recordInteraction" in names


def test_game_turn_schema_array_omits_the_unopted_optional(monkeypatch):
    names = _captured_schema_names(monkeypatch, enabled=[])
    assert "chat_with_model" not in names
    assert "advanceGame" in names  # the pinned game surface is unaffected


# ── A2 (gate 4): the admin UI says who the opt-ins apply to ───────────────────

def test_admin_tools_page_carries_the_gate4_copy():
    # Per-owner security blocks every power tool for non-admin accounts regardless of the
    # toggle (sound policy) — the page must SAY so, and note app_api's by-design 404s
    # against dropped verticals, or multi-account installs read both as random breakage.
    import pathlib
    js = (pathlib.Path(__file__).parent.parent / "static" / "js" / "admin.js").read_text(encoding="utf-8")
    assert "Opt-ins apply to admin accounts only" in js
    assert "404 by design" in js
    assert "OPTIONAL_TOOLS_NOTE" in js  # rendered into the System (opt-in) section body
