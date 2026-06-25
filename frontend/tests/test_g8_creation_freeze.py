"""Lane G8 — casting finalization must never read as a false outage.

USER REPORT: while the engine "filed away" the casting interview (createCharacter —
its heaviest call: sandbox mint + 16-cast generation + soul seeding through the
synchronous embedding bridge, ADR 0004), the front-end's health probe stalled and the
banner flashed red "engine unavailable", then recovered. The engine half (chunked soul
seeding) is fixed in TS (tests/integration/creationFreeze.test.ts); THIS file proves
the front-end half:

  1. orwell_engine exposes a module-level createCharacter-in-flight marker
     (`creating_in_flight()`), set for exactly the duration of the call (errors included);
  2. engine_health_detail() / GET /api/orwell/health carry `busy: "creating"` while it runs
     — even when the probe itself times out (the moment the false red used to fire);
  3. the banner JS renders the in-fiction AMBER holding line while busy, and never the
     red "engine unavailable" for a probe failure that occurs while busy (source-pinned).
"""

import asyncio
import importlib
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_engine = importlib.import_module("src.orwell_engine")
orwell_routes = importlib.import_module("routes.orwell_routes")

FRONTEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATUS_JS = os.path.join(FRONTEND, "static", "js", "orwellEngineStatus.js")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# --- 1. the in-flight marker wraps exactly the createCharacter call --------------------

def test_creating_in_flight_is_true_during_and_false_after(monkeypatch):
    observed = {}

    async def fake_call(name, args=None, user=None, timeout=None):
        assert name == "createCharacter"
        observed["during"] = orwell_engine.creating_in_flight()
        return {"started": True}

    monkeypatch.setattr(orwell_engine, "_call", fake_call)
    assert orwell_engine.creating_in_flight() is False
    res = _run(orwell_engine.create_character("P", user="u"))
    assert res == {"started": True}
    assert observed["during"] is True  # busy for exactly the duration of the call
    assert orwell_engine.creating_in_flight() is False


def test_creating_in_flight_clears_even_when_the_engine_call_fails(monkeypatch):
    async def broken_call(name, args=None, user=None, timeout=None):
        assert orwell_engine.creating_in_flight() is True
        raise RuntimeError("engine timeout")

    monkeypatch.setattr(orwell_engine, "_call", broken_call)
    with pytest.raises(RuntimeError):
        _run(orwell_engine.create_character("P", user="u"))
    assert orwell_engine.creating_in_flight() is False  # a failed create never wedges "busy"


def test_concurrent_creates_keep_busy_until_the_last_one_lands(monkeypatch):
    release = asyncio.Event()

    async def slow_call(name, args=None, user=None, timeout=None):
        await release.wait()
        return {"started": True}

    monkeypatch.setattr(orwell_engine, "_call", slow_call)

    async def scenario():
        t1 = asyncio.ensure_future(orwell_engine.create_character("A", user="u1"))
        t2 = asyncio.ensure_future(orwell_engine.create_character("B", user="u2"))
        await asyncio.sleep(0)  # let both enter the in-flight section
        assert orwell_engine.creating_in_flight() is True
        release.set()
        await asyncio.gather(t1, t2)
        assert orwell_engine.creating_in_flight() is False

    _run(scenario())


# --- 2. health carries busy:"creating" — including when the probe itself fails ---------

class _TimeoutClient:
    """A shared-client stand-in whose /health GET times out — the exact moment the
    false red banner used to fire (the engine loop pinned by the seeding batch)."""

    async def get(self, url, timeout=None):
        raise TimeoutError("health probe timed out")


def test_health_detail_reports_busy_creating_while_in_flight(monkeypatch):
    monkeypatch.setattr(orwell_engine, "_shared_client", lambda: _TimeoutClient())
    monkeypatch.setattr(orwell_engine, "_CREATING_IN_FLIGHT", 1)
    detail = _run(orwell_engine.engine_health_detail())
    assert detail["ok"] is False  # the probe honestly failed…
    assert detail["busy"] == "creating"  # …but health says WHY: casting is finalizing


def test_health_detail_has_no_busy_marker_when_idle(monkeypatch):
    monkeypatch.setattr(orwell_engine, "_shared_client", lambda: _TimeoutClient())
    monkeypatch.setattr(orwell_engine, "_CREATING_IN_FLIGHT", 0)
    detail = _run(orwell_engine.engine_health_detail())
    assert detail["ok"] is False
    assert "busy" not in detail  # an idle outage stays an honest outage (red is correct then)


def test_api_orwell_health_route_relays_busy(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "false")

    async def fake_detail():
        return {"ok": False, "engineUrl": "http://e", "error": "ReadTimeout: 5s", "busy": "creating"}

    monkeypatch.setattr(orwell_engine, "engine_health_detail", fake_detail)
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    body = TestClient(app).get("/api/orwell/health").json()
    assert body["engine"] is False
    assert body["busy"] == "creating"  # the banner's signal rides the existing health poll


# --- 3. the banner renders the holding state, never red-while-busy (source pin) --------

def _status_js() -> str:
    with open(STATUS_JS, encoding="utf-8") as f:
        return f.read()


def test_banner_defines_the_in_fiction_holding_state():
    js = _status_js()
    assert 'd.busy === "creating"' in js, "the banner must read the health poll's busy marker"
    # The holding line is AMBER (degraded) and in-fiction — never the red outage chrome.
    # #764: titles carry NO baked-in glyph — the icon is the OrwellNotice kit's severity-derived
    # monochrome glyph (.on-icon), so the holding title is plain text driven by severity "degraded".
    assert 'show("degraded", "Production is building the house…"' in js
    assert "Casting is being finalized" in js


def test_banner_never_shows_red_for_failures_while_busy():
    js = _status_js()
    # Both failure branches (engine unreachable AND a recent tool error) must short-circuit
    # to the holding state while busy — before any show("down", …) can fire.
    assert js.count("if (busy) { showHolding(); return; }") >= 2, (
        "both the unreachable branch and the lastError branch must hold in-fiction while busy"
    )
    unreachable_branch = js.index("if (!d || !d.engine)")
    busy_guard = js.index("if (busy) { showHolding(); return; }")
    red = js.index('show("down", "Big Brother engine unavailable.", reason')  # #764: de-glyphed title
    assert unreachable_branch < busy_guard < red, (
        "the busy guard must run before the red banner inside the unreachable branch"
    )
