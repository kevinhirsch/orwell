"""#1614 — the portrait route must RESOLVE-OR-FAIL-FAST, never hang.

Serving a stored houseguest portrait (GET /api/orwell/portrait/{id}) is local per-user
disk I/O, but a busy portrait generation/backfill lane can saturate the disk and starve the
read for many seconds. Because the browser holds a per-host connection slot on each pending
<img>, ONE hung portrait response starves EVERY portrait surface at once (cast window, room
strip, rail, chat faces). The route therefore runs the blocking resolve OFF the event loop
under a bounded timeout and, on timeout / not-found / error, returns the same fast "no
portrait" 404 the not-found path already serves so the browser releases the slot and the FE
(monogram-first; PR #1613) degrades to the monogram.

Name-agnostic (roles only); the portrait-file resolver is monkeypatched. Covers:
  • a ready portrait still streams normally (happy path preserved)
  • a genuine miss returns a fast, cache-safe (no-store) 404
  • a HUNG resolve fails fast well within the sleep budget (the #1614 guarantee)
  • a resolve that raises fails fast to the same 404 (defensive)
"""

import importlib
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

orwell_portraits = importlib.import_module("src.orwell_portraits")
orwell_routes = importlib.import_module("routes.orwell_routes")


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(orwell_routes.setup_orwell_routes())
    return TestClient(app, raise_server_exceptions=False)


def test_ready_portrait_streams_normally(client, monkeypatch, tmp_path):
    """The happy path is untouched: a resolvable portrait streams as image/png with the
    long-lived private cache header."""
    png = tmp_path / "npc_1.png"
    png.write_bytes(b"\x89PNG\r\n\x1a\nFAKE-PORTRAIT-BYTES")
    monkeypatch.setattr(orwell_portraits, "portrait_file", lambda user, hid: png)

    r = client.get("/api/orwell/portrait/npc:1?v=abcd")

    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content == b"\x89PNG\r\n\x1a\nFAKE-PORTRAIT-BYTES"
    assert "max-age=86400" in r.headers.get("cache-control", "")


def test_missing_portrait_returns_fast_cache_safe_404(client, monkeypatch):
    """A genuine miss (no stored file) returns the fast 404 — now cache-safe (no-store) so a
    portrait that lands moments later isn't shadowed by a cached 404."""
    monkeypatch.setattr(orwell_portraits, "portrait_file", lambda user, hid: None)

    r = client.get("/api/orwell/portrait/npc:7")

    assert r.status_code == 404
    assert r.json() == {"error": "no portrait"}
    assert r.headers.get("cache-control") == "no-store"


def test_hung_resolve_fails_fast_within_budget(client, monkeypatch):
    """The #1614 guarantee: a resolve that BLOCKS for far longer than the timeout does not
    hang the response — the route returns the fast 404 at the timeout, releasing the browser's
    per-host image slot instead of holding it for the full block."""
    # A tight timeout so the test is quick; the block is an order of magnitude longer, so a
    # route that (incorrectly) waited for the resolve would take ~BLOCK seconds.
    monkeypatch.setattr(orwell_routes, "_PORTRAIT_RESOLVE_TIMEOUT_S", 0.25)

    BLOCK = 3.0

    def _hung(user, hid):
        time.sleep(BLOCK)  # emulates a disk-saturated resolve; runs in the threadpool worker
        return "/never/reached.png"

    monkeypatch.setattr(orwell_portraits, "portrait_file", _hung)

    started = time.monotonic()
    r = client.get("/api/orwell/portrait/npc:3")
    elapsed = time.monotonic() - started

    # Fails fast: back well before the block would have completed.
    assert elapsed < BLOCK - 0.5, f"portrait GET hung for {elapsed:.2f}s (block was {BLOCK}s)"
    assert r.status_code == 404
    assert r.json() == {"error": "no portrait"}
    assert r.headers.get("cache-control") == "no-store"


def test_resolve_error_fails_fast(client, monkeypatch):
    """A resolver blip (raise) must fail fast to the same 404, never 500 or hang."""
    def _boom(user, hid):
        raise OSError("disk gone")

    monkeypatch.setattr(orwell_portraits, "portrait_file", _boom)

    r = client.get("/api/orwell/portrait/npc:2")

    assert r.status_code == 404
    assert r.json() == {"error": "no portrait"}
    assert r.headers.get("cache-control") == "no-store"
