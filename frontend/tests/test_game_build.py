"""Feature 0032 — front-end surface reduction (the "game build").

Roles only (player, admin); never a houseguest/player name. Vertical names (shell,
email, …) are app features, not people, so naming them is fine.

These exercise the server-enforced reduction, not just CSS hiding:
  - is_feature_enabled / the single game-build switch (settings.py)
  - mount_optional → a dropped vertical's router is never registered (404 server-side),
    proven with a tiny FastAPI app + TestClient (no heavy app import needed)
  - front_end_context_sources → no front-end memory/RAG/skills/web in chat context
  - structural guards that app.py wires the gate (esp. the live shell endpoint)
  - static guards that the Settings tabs / entry points are pruned

The Tier-3 deletion DoD (boot a real instance, onboard, play a turn, render portraits)
is a documented running-instance check per frontend/INTEGRATION.md — not CI-provable here.
"""

import os

import pytest
from fastapi import FastAPI, APIRouter
from starlette.testclient import TestClient

from src import settings

FRONTEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ── helpers ─────────────────────────────────────────────────────────────────

def _set_game_build(monkeypatch, on: bool):
    monkeypatch.setenv("ORWELL_GAME_BUILD", "1" if on else "0")


def _build_app(monkeypatch, *, game_build: bool):
    """A minimal app mounting a keep-set route + two drop-set routes through the real
    settings.mount_optional gate. Mirrors how app.py registers routers."""
    _set_game_build(monkeypatch, game_build)
    app = FastAPI()
    executed = {"shell": False}

    keep = APIRouter()

    @keep.get("/api/orwell/ping")
    def _ping():
        return {"ok": True}

    shell = APIRouter()

    @shell.post("/api/shell/exec")
    def _shell_exec():
        executed["shell"] = True  # must NEVER run under the game build
        return {"ran": True}

    email = APIRouter()

    @email.get("/api/email/inbox")
    def _inbox():
        return {"mail": []}

    settings.mount_optional(app, "chat", keep)     # keep-set → always mounted
    settings.mount_optional(app, "shell", shell)   # drop-set → gated off
    settings.mount_optional(app, "email", email)   # drop-set → gated off
    return app, executed


# ── Scenario: the player sees only the game surface ──────────────────────────

def test_keep_set_present_and_drop_set_entry_points_hidden(monkeypatch):
    _set_game_build(monkeypatch, True)
    # Every game keep-set capability is enabled.
    for cap in ("chat", "onboarding", "status_panel", "portraits", "image_gen",
                "settings", "theme", "accounts", "engine_mcp", "agent"):
        assert settings.is_feature_enabled(cap) is True, cap
    # No dropped vertical's UI entry point survives (icon-rail launchers hidden).
    css = open(os.path.join(FRONTEND_DIR, "static/css/game-trim.css"), encoding="utf-8").read()
    for rail in ("#rail-email", "#rail-gallery", "#rail-research", "#rail-tasks", "#rail-memory"):
        assert rail in css, rail


# ── Scenario: a dropped vertical is gone server-side, not just hidden ─────────

def test_dropped_vertical_returns_not_found_even_for_admin(monkeypatch):
    app, _ = _build_app(monkeypatch, game_build=True)
    client = TestClient(app)
    # Keep-set route is live.
    assert client.get("/api/orwell/ping").status_code == 200
    # Dropped vertical: not mounted → 404, for an anonymous caller …
    assert client.get("/api/email/inbox").status_code == 404
    # … and identically for an authenticated admin (the path simply does not exist).
    admin_headers = {"Authorization": "Bearer admin", "Cookie": "session=admin"}
    assert client.get("/api/email/inbox", headers=admin_headers).status_code == 404


# ── Scenario: the live shell endpoint is removed in the game build ───────────

def test_shell_exec_removed_and_never_executes(monkeypatch):
    app, executed = _build_app(monkeypatch, game_build=True)
    client = TestClient(app)
    admin_headers = {"Authorization": "Bearer admin"}
    resp = client.post("/api/shell/exec", json={"cmd": "id"}, headers=admin_headers)
    assert resp.status_code == 404          # the request returns not-found …
    assert executed["shell"] is False       # … and no command is executed
    assert settings.is_feature_enabled("shell") is False


def test_app_wires_shell_through_the_gate(monkeypatch):
    """Structural guard: app.py must register shell via mount_optional, not unconditionally
    (so the live /api/shell/exec surface is actually neutralized)."""
    app_src = open(os.path.join(FRONTEND_DIR, "app.py"), encoding="utf-8").read()
    assert 'mount_optional(app, "shell", setup_shell_routes())' in app_src
    assert "app.include_router(setup_shell_routes" not in app_src


# ── Scenario: no front-end memory, RAG, or skills in chat context ────────────

def test_game_build_injects_no_front_end_memory_rag_or_skills(monkeypatch):
    _set_game_build(monkeypatch, True)
    src = settings.front_end_context_sources()
    assert src == {"memory": False, "rag": False, "skills": False, "web": False}
    # web_fetch / document_editor / rag default OFF under the game build (DoD).
    for cap in ("web_fetch", "document_editor", "rag", "memory", "deep_research"):
        assert settings.is_feature_enabled(cap) is False, cap


def test_chat_helpers_gates_context_through_the_single_seam():
    """Structural guard: the chat context assembly routes its memory/RAG/skills/web flags
    through front_end_context_sources (the engine moment prompt stays the only framing)."""
    src = open(os.path.join(FRONTEND_DIR, "routes/chat_helpers.py"), encoding="utf-8").read()
    assert "front_end_context_sources(" in src
    for key in ('_fe_src["memory"]', '_fe_src["skills"]', '_fe_src["rag"]', '_fe_src["web"]'):
        assert key in src, key


# ── Scenario: the game build is a single switch ──────────────────────────────

def test_single_switch_flips_keep_and_drop_sets(monkeypatch):
    # Switch ON: every keep-set capability on, every drop-set vertical off.
    _set_game_build(monkeypatch, True)
    for cap in settings.GAME_KEEP_SET:
        assert settings.is_feature_enabled(cap) is True, cap
    for vert in settings.GAME_DROP_SET:
        assert settings.is_feature_enabled(vert) is False, vert

    # Switch OFF: the inherited workspace verticals are reachable again.
    _set_game_build(monkeypatch, False)
    # No saved overrides → inherited verticals default reachable in full-workspace mode.
    for vert in ("shell", "email", "calendar", "contacts", "notes", "tasks", "compare"):
        assert settings.is_feature_enabled(vert, features={}) is True, vert


def test_default_is_game_build_on(monkeypatch):
    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)
    monkeypatch.delenv("BBAI_GAME_BUILD", raising=False)
    assert settings.game_build_enabled() is True
    assert settings.is_feature_enabled("shell") is False  # drop-set off by default


# ── Scenario: voice is kept but off by default ───────────────────────────────

def test_voice_off_by_default_and_restorable(monkeypatch):
    _set_game_build(monkeypatch, True)
    assert settings.DEFAULT_FEATURES["voice"] is False
    assert settings.is_feature_enabled("voice", features={}) is False
    # Enabling its flag restores it (even under the game build — voice is the exception).
    assert settings.is_feature_enabled("voice", features={"voice": True}) is True


# ── Scenario: the engine MCP agent backend survives the prune ────────────────

def test_engine_mcp_agent_backend_survives(monkeypatch):
    _set_game_build(monkeypatch, True)
    assert settings.is_feature_enabled("engine_mcp") is True
    assert settings.is_feature_enabled("agent") is True
    # The engine bridge + MCP routes are never gated (not in the drop-set).
    for cap in ("engine_mcp", "agent", "chat"):
        assert cap not in settings.GAME_DROP_SET
    app_src = open(os.path.join(FRONTEND_DIR, "app.py"), encoding="utf-8").read()
    # The engine bridge and MCP routes mount unconditionally (keep-set linchpin).
    assert "setup_orwell_routes()" in app_src
    assert "app.include_router(setup_mcp_routes(mcp_manager))" in app_src


# ── Scenario: the Settings surface is pruned to the keep-set ─────────────────

def test_settings_tabs_pruned_to_keep_set():
    css = open(os.path.join(FRONTEND_DIR, "static/css/game-trim.css"), encoding="utf-8").read()
    index = open(os.path.join(FRONTEND_DIR, "static/index.html"), encoding="utf-8").read()
    # Dropped-vertical tabs are hidden.
    for tab in ("email", "integrations", "reminders"):
        assert f'[data-settings-tab="{tab}"]' in css, tab
    # Keep-set tabs are declared and NOT hidden by the trim.
    for tab in ("services", "ai", "search", "appearance", "account", "tools", "users"):
        assert f'data-settings-tab="{tab}"' in index, tab
        assert f'[data-settings-tab="{tab}"]' not in css, tab


# ── Scenario: per-user isolation & the Vault Wall are unaffected ─────────────

def test_no_parallel_front_end_memory_to_rival_engine_vault(monkeypatch):
    """The prune removes the front-end's own memory/RAG/skills, so the only memory is the
    engine's per-user, Vault-walled soul store — nothing in a kept surface can surface
    hidden engine state or another user's game."""
    _set_game_build(monkeypatch, True)
    src = settings.front_end_context_sources()
    assert not any(src.values())  # no front-end store feeds chat context
    for vert in ("memory", "rag", "skills"):
        assert settings.is_feature_enabled(vert) is False, vert
