"""Issue #636 — the game build permanently drops inherited-workspace subsystems.

The Orwell FE is vendored from a larger workspace. In the GAME build
(`ORWELL_GAME_BUILD` on, the default) three inherited subsystems have no role in the
Big Brother game loop and must NOT be wired:

  * the built-in RAG / Memory / Email MCP servers (only `image_gen` survives — feature 0051),
  * the optional Playwright/browser NPX MCP server, and
  * the ChromaDB RAG ToolIndex (never even constructed/attempted).

The FULL workspace (`ORWELL_GAME_BUILD=0`) keeps all of them. These are source/behaviour
pins; they need no network or engine.
"""

import importlib
import inspect

import pytest

bm = importlib.import_module("src.builtin_mcp")


# ── Built-in MCP servers: only image_gen in the game build ──────────────────────────────

def test_game_build_registers_only_image_gen(monkeypatch):
    monkeypatch.delenv("BBAI_GAME_BUILD", raising=False)
    monkeypatch.setenv("ORWELL_GAME_BUILD", "1")  # the product default
    servers = bm._builtin_servers_for_build()
    assert set(servers) == {"image_gen"}, servers
    # the inherited verticals are explicitly NOT connected
    for dropped in ("memory", "rag", "email"):
        assert dropped not in servers


def test_default_is_game_build_only_image_gen(monkeypatch):
    monkeypatch.delenv("ORWELL_GAME_BUILD", raising=False)
    monkeypatch.delenv("BBAI_GAME_BUILD", raising=False)
    assert set(bm._builtin_servers_for_build()) == {"image_gen"}


def test_full_workspace_registers_all_builtin_servers(monkeypatch):
    monkeypatch.delenv("BBAI_GAME_BUILD", raising=False)
    monkeypatch.setenv("ORWELL_GAME_BUILD", "0")  # full workspace for debugging
    servers = bm._builtin_servers_for_build()
    assert set(servers) == {"image_gen", "memory", "rag", "email"}, servers


def test_image_gen_is_always_kept(monkeypatch):
    # image_gen must survive regardless of build (portraits/headshots — feature 0051).
    for val in ("1", "0"):
        monkeypatch.delenv("BBAI_GAME_BUILD", raising=False)
        monkeypatch.setenv("ORWELL_GAME_BUILD", val)
        assert "image_gen" in bm._builtin_servers_for_build()


def test_reconnect_lookup_union_still_resolves_every_builtin():
    # The crash-reconnect path (McpManager._reconnect_builtin) looks definitions up in the full
    # union, so a connected server can still be reconnected by id.
    assert set(bm._BUILTIN_SERVERS) == {"image_gen", "memory", "rag", "email"}


# ── Browser (Playwright NPX) MCP: never started in the game build ───────────────────────

def test_game_build_does_not_start_browser_mcp(monkeypatch):
    monkeypatch.delenv("BBAI_GAME_BUILD", raising=False)
    monkeypatch.setenv("ORWELL_GAME_BUILD", "1")
    assert bm._npx_servers_enabled() is False


# ── ChromaDB RAG ToolIndex: never wired/constructed in the game build ───────────────────

def test_toolindex_not_wanted_in_game_build_without_chromadb(monkeypatch):
    monkeypatch.delenv("BBAI_GAME_BUILD", raising=False)
    monkeypatch.setenv("ORWELL_GAME_BUILD", "1")
    monkeypatch.delenv("CHROMADB_HOST", raising=False)
    monkeypatch.delenv("CHROMADB_PORT", raising=False)
    ti = importlib.import_module("src.tool_index")
    assert ti._toolindex_wanted() is False


def test_get_tool_index_does_not_construct_in_game_build(monkeypatch):
    """get_tool_index() returns None WITHOUT ever constructing ToolIndex (no ChromaDB attempt)."""
    monkeypatch.delenv("BBAI_GAME_BUILD", raising=False)
    monkeypatch.setenv("ORWELL_GAME_BUILD", "1")
    monkeypatch.delenv("CHROMADB_HOST", raising=False)
    monkeypatch.delenv("CHROMADB_PORT", raising=False)
    ti = importlib.import_module("src.tool_index")
    ti.reset_tool_index()
    constructed = {"n": 0}
    orig_init = ti.ToolIndex.__init__

    def _spy(self, *a, **k):  # pragma: no cover - must never run
        constructed["n"] += 1
        return orig_init(self, *a, **k)

    monkeypatch.setattr(ti.ToolIndex, "__init__", _spy)
    assert ti.get_tool_index() is None
    assert constructed["n"] == 0, "ToolIndex was constructed in the game build"
    ti.reset_tool_index()


def test_full_workspace_still_wants_the_toolindex(monkeypatch):
    monkeypatch.delenv("BBAI_GAME_BUILD", raising=False)
    monkeypatch.setenv("ORWELL_GAME_BUILD", "0")
    monkeypatch.delenv("CHROMADB_HOST", raising=False)
    monkeypatch.delenv("CHROMADB_PORT", raising=False)
    ti = importlib.import_module("src.tool_index")
    assert ti._toolindex_wanted() is True


def test_app_skips_toolindex_warmup_in_game_build():
    """Source pin: app startup only schedules the RAG warmup when the ToolIndex is wanted."""
    import app as app_module
    src = inspect.getsource(app_module)
    assert "_toolindex_warmup_wanted()" in src
    assert "if _toolindex_warmup_wanted():" in src
