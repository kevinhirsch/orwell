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
