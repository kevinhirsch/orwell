"""Issue 3 — ChromaDB / ToolIndex log spam is quieted.

When ChromaDB isn't running the RAG ToolIndex couldn't initialize, and the singleton retried every
30s — logging `ToolIndex init failed … ChromaDB is not reachable` on EVERY tick, firehosing the log.

The fix:
  • under the game build with NO ChromaDB configured, the RAG index is unneeded → it logs ONE quiet
    note and DISABLES the retry loop (no probing forever);
  • when ChromaDB IS configured, the retry loop stays, but the unavailability logs ONCE per outage
    (not on every 30s retry), and a recovery re-arms the next-outage log.

No real ChromaDB / embeddings — ToolIndex construction is monkeypatched to fail/succeed.
"""
import logging

import pytest

import src.tool_index as ti

LOGGER = "src.tool_index"


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    # A clean singleton + a known env (no ChromaDB configured) per test.
    ti.reset_tool_index()
    monkeypatch.delenv("CHROMADB_HOST", raising=False)
    monkeypatch.delenv("CHROMADB_PORT", raising=False)
    yield
    ti.reset_tool_index()


def _make_toolindex_fail(monkeypatch, exc=None):
    """Make constructing the RAG index raise (as a missing ChromaDB does)."""
    err = exc or RuntimeError("ChromaDB is not reachable at localhost:8100")

    class _Boom:
        def __init__(self):
            raise err

    monkeypatch.setattr(ti, "ToolIndex", _Boom)


# --- game build, no ChromaDB: disabled after ONE quiet note -------------------------------------

def test_game_build_no_chromadb_disables_after_one_note(monkeypatch, caplog):
    # Game build on (default) + no ChromaDB configured ⇒ the RAG index is unneeded.
    # _toolindex_wanted reads settings.game_build_enabled — patch that symbol.
    import src.settings as settings
    monkeypatch.setattr(settings, "game_build_enabled", lambda: True)
    _make_toolindex_fail(monkeypatch)

    with caplog.at_level(logging.INFO, logger=LOGGER):
        for _ in range(20):  # simulate 20 ticks
            assert ti.get_tool_index() is None
    notes = [r for r in caplog.records if "ToolIndex disabled" in r.getMessage()]
    assert len(notes) == 1, "the unconfigured game-build index logs its disable EXACTLY once"
    # No `init failed` spam (it never even attempted construction).
    assert not any("init failed" in r.getMessage() for r in caplog.records)


# --- ChromaDB configured: retry stays, but logs once per outage --------------------------------

def test_configured_chromadb_logs_failure_once_per_outage(monkeypatch, caplog):
    monkeypatch.setenv("CHROMADB_HOST", "localhost")  # explicitly configured ⇒ RAG is wanted
    import src.settings as settings
    monkeypatch.setattr(settings, "game_build_enabled", lambda: True)
    _make_toolindex_fail(monkeypatch)

    # Defeat the 30s retry throttle so each call genuinely attempts construction.
    monkeypatch.setattr(ti, "_RETRY_INTERVAL", 0.0)

    with caplog.at_level(logging.WARNING, logger=LOGGER):
        for _ in range(20):
            assert ti.get_tool_index() is None
    fails = [r for r in caplog.records if "ToolIndex init failed" in r.getMessage()]
    assert len(fails) == 1, "a sustained ChromaDB outage logs init-failed ONCE, not every retry"


def test_recovery_rearms_the_next_outage_log(monkeypatch, caplog):
    monkeypatch.setenv("CHROMADB_HOST", "localhost")
    import src.settings as settings
    monkeypatch.setattr(settings, "game_build_enabled", lambda: True)
    monkeypatch.setattr(ti, "_RETRY_INTERVAL", 0.0)

    # Outage first: one failure logs.
    _make_toolindex_fail(monkeypatch)
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        ti.get_tool_index()
        ti.get_tool_index()  # suppressed (same outage)
    assert len([r for r in caplog.records if "ToolIndex init failed" in r.getMessage()]) == 1

    # ChromaDB comes up: a healthy index clears the warned flag.
    class _Ok:
        healthy = True

        def __init__(self):
            pass

        def index_builtin_tools(self):
            pass

    monkeypatch.setattr(ti, "ToolIndex", _Ok)
    assert ti.get_tool_index() is not None

    # A NEW outage logs again (never silent).
    caplog.clear()
    ti.reset_tool_index()  # drop the healthy singleton so the next call re-attempts
    monkeypatch.setenv("CHROMADB_HOST", "localhost")
    monkeypatch.setattr(ti, "_RETRY_INTERVAL", 0.0)
    _make_toolindex_fail(monkeypatch)
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        ti.get_tool_index()
    assert len([r for r in caplog.records if "ToolIndex init failed" in r.getMessage()]) == 1


# --- full workspace build (game build off): RAG still attempted even without ChromaDB ----------

def test_full_workspace_build_still_attempts_without_chromadb(monkeypatch, caplog):
    import src.settings as settings
    monkeypatch.setattr(settings, "game_build_enabled", lambda: False)  # full workspace
    monkeypatch.setattr(ti, "_RETRY_INTERVAL", 0.0)
    _make_toolindex_fail(monkeypatch)
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        for _ in range(5):
            assert ti.get_tool_index() is None
    # It ATTEMPTS (init-failed appears), and is NOT disabled with the "disabled" note.
    assert any("ToolIndex init failed" in r.getMessage() for r in caplog.records)
    assert not any("ToolIndex disabled" in r.getMessage() for r in caplog.records)
