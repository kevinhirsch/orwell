"""Lane G31 — the game build doesn't load the optional browser (Playwright) MCP.

The inherited workspace registers an NPX `@playwright/mcp` browser MCP server. On a fresh
deploy that package isn't in the npx cache, so startup logged a WARNING ("Browser is not
available …") and skipped it. A Big Brother sim has no use for a browser tool, so the game
build doesn't register the optional NPX servers at all — no warning, no Playwright dependency.
The full workspace (ORWELL_GAME_BUILD=0) still offers it.
"""

import importlib
import os

import pytest

bm = importlib.import_module("src.builtin_mcp")


def test_game_build_skips_the_npx_browser_server(monkeypatch):
    monkeypatch.delenv("BBAI_GAME_BUILD", raising=False)
    monkeypatch.setenv("ORWELL_GAME_BUILD", "1")          # the product default
    assert bm._npx_servers_enabled() is False


def test_full_workspace_still_offers_the_browser_server(monkeypatch):
    monkeypatch.delenv("BBAI_GAME_BUILD", raising=False)
    monkeypatch.setenv("ORWELL_GAME_BUILD", "0")          # full workspace for debugging
    assert bm._npx_servers_enabled() is True


def test_default_is_game_build_no_browser(monkeypatch):
    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)
    monkeypatch.delenv("BBAI_GAME_BUILD", raising=False)
    assert bm._npx_servers_enabled() is False             # default ON ⇒ no browser MCP


def test_registration_gates_the_npx_task_on_the_helper():
    """Source pin: the npx server task is created only when _npx_servers_enabled()."""
    src = bm.__loader__.get_source("src.builtin_mcp") if hasattr(bm, "__loader__") else None
    if src is None:
        import inspect
        src = inspect.getsource(bm)
    assert "if _npx_servers_enabled():" in src
    assert "asyncio.create_task(_start_npx_servers())" in src
    # the browser server is still DEFINED (the full workspace uses it)
    assert "builtin_browser" in src and "@playwright/mcp" in src
