"""WS turn-on plumbing (gate #1299) — the two server-side fixes that make the
WebSocket Phase-1 transport UPGRADE-CAPABLE and FLIPPABLE-BY-ENV while it stays
DORMANT by default (ORWELL_WS_TRANSPORT off).

Roles only — no houseguest/player names.

  BLOCKER 1 — a WebSocket protocol library is installed, so uvicorn can answer the
              /api/ws/session upgrade instead of 404 "No supported WebSocket library
              detected". (Pinned via requirements.txt/.lock — `websockets`.)
  BLOCKER 3 — app.py emits body[data-ws-transport="1"] ONLY when ws_transport_enabled()
              is true (ORWELL_WS_TRANSPORT truthy). Unset ⇒ attr ABSENT ⇒ byte-identical
              page ⇒ WS stays dormant on the existing SSE/poll stack.
"""

import os

import pytest

from src.settings import ws_transport_enabled

FRONTEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ═══════════════════════════════════════════════════════════════════════════
# BLOCKER 1 — a WebSocket library is present (uvicorn auto-detects it)
# ═══════════════════════════════════════════════════════════════════════════

def test_a_websocket_library_imports():
    """uvicorn ships no WS impl by default; the explicit `websockets` pin restores
    the upgrade path. If this import fails, /api/ws/session answers 404."""
    import websockets  # noqa: F401  — presence is the whole assertion

    assert websockets.__version__


def test_websockets_is_pinned_in_both_requirement_files():
    """requirements.txt is human intent; requirements.lock.txt is what deploy installs.
    A fresh box installs the LOCK — the pin must live there too or the bug returns."""
    with open(os.path.join(FRONTEND_DIR, "requirements.txt"), encoding="utf-8") as f:
        req = f.read()
    with open(os.path.join(FRONTEND_DIR, "requirements.lock.txt"), encoding="utf-8") as f:
        lock = f.read()
    # Pin EXACTLY in both files so CI == prod (the lock is what deploy installs) and the
    # intent file can't drift to a different version — a bare/range pin would let the two
    # diverge, the CI-vs-prod hazard the requirements.txt header warns about.
    assert "\nwebsockets==16.0\n" in req, "websockets not pinned to ==16.0 in requirements.txt"
    assert "\nwebsockets==16.0\n" in lock, "websockets not pinned to ==16.0 in requirements.lock.txt"


# ═══════════════════════════════════════════════════════════════════════════
# BLOCKER 3a — the env flag helper: DEFAULT ON (turned on 2026-07-10); an
# explicit off/0/false/no is the rollback lever back to the SSE/poll stack.
# ═══════════════════════════════════════════════════════════════════════════

def test_ws_transport_default_on(monkeypatch):
    monkeypatch.delenv("ORWELL_WS_TRANSPORT", raising=False)
    assert ws_transport_enabled() is True


@pytest.mark.parametrize("val", ["1", "true", "TRUE", "yes", "on", " On "])
def test_ws_transport_truthy_values_enable(monkeypatch, val):
    monkeypatch.setenv("ORWELL_WS_TRANSPORT", val)
    assert ws_transport_enabled() is True


@pytest.mark.parametrize("val", ["0", "false", "no", "off", "", "nope"])
def test_ws_transport_explicit_falsey_values_disable(monkeypatch, val):
    # The rollback lever: an explicit non-truthy value forces OFF even though the
    # default is now ON.
    monkeypatch.setenv("ORWELL_WS_TRANSPORT", val)
    assert ws_transport_enabled() is False


# ═══════════════════════════════════════════════════════════════════════════
# BLOCKER 3b — the served page: attr ABSENT by default, PRESENT when flipped on
# ═══════════════════════════════════════════════════════════════════════════

class _StubRequest:
    """Minimal stand-in for a Starlette Request — the serve helper only reads
    request.state.csp_nonce."""

    class _State:
        csp_nonce = ""

    state = _State()


def _render_index(monkeypatch, *, ws_on: bool) -> str:
    # Game build ON (product default) so the injection block runs at all.
    monkeypatch.setenv("ORWELL_GAME_BUILD", "1")
    if ws_on:
        monkeypatch.setenv("ORWELL_WS_TRANSPORT", "1")
    else:
        # Default is now ON, so "off" means an EXPLICIT non-truthy value (the rollback lever).
        monkeypatch.setenv("ORWELL_WS_TRANSPORT", "0")
    from app import _serve_html_with_nonce, BASE_DIR
    from src.app_helpers import abs_join

    resp = _serve_html_with_nonce(_StubRequest(), abs_join(BASE_DIR, "static/index.html"))
    return resp.body.decode("utf-8")


def test_ws_transport_attr_absent_when_explicitly_off(monkeypatch):
    html = _render_index(monkeypatch, ws_on=False)  # explicit ORWELL_WS_TRANSPORT=0
    assert "data-ws-transport" not in html
    # sanity: the game-build attr IS still emitted — proves we're in the injected path
    assert 'data-game-build="1"' in html


def test_ws_transport_attr_present_when_env_unset(monkeypatch):
    # Default is now ON: an unset env emits the ws hook so the client attempts the upgrade.
    monkeypatch.setenv("ORWELL_GAME_BUILD", "1")
    monkeypatch.delenv("ORWELL_WS_TRANSPORT", raising=False)
    from app import _serve_html_with_nonce, BASE_DIR
    from src.app_helpers import abs_join
    html = _serve_html_with_nonce(_StubRequest(), abs_join(BASE_DIR, "static/index.html")).body.decode("utf-8")
    assert 'data-ws-transport="1"' in html


def test_ws_transport_attr_present_when_env_set(monkeypatch):
    html = _render_index(monkeypatch, ws_on=True)
    assert 'data-ws-transport="1"' in html
    assert 'data-game-build="1"' in html


def test_ws_transport_attr_off_matches_on_but_for_the_attr(monkeypatch):
    """Rollback (explicit off) carries NO ws hook, so the client (orwellWs.js _flagOn)
    never attempts the upgrade — and the ONLY difference from the on output is that one
    injected body attribute."""
    off = _render_index(monkeypatch, ws_on=False)
    on = _render_index(monkeypatch, ws_on=True)
    assert off.replace("<body", '<body data-ws-transport="1"', 1) == on
